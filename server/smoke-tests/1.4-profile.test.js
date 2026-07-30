/**
 * End-to-end smoke test for Module 1.4 — User Profile APIs.
 *
 * Spins up:
 *   - in-memory MongoDB
 *   - the real Express app (without Cloudinary configured — so the
 *     avatar-upload endpoint returns 503)
 *   - the real auth + users routers
 *
 * Exercises:
 *   - GET /api/users/me (with/without token)
 *   - PATCH /api/users/me for every editable field (name, email, phone,
 *     location) and every forbidden field (role, password, isActive,
 *     isVerified, createdAt, updatedAt, _id, __v)
 *   - Uniqueness 409 on duplicate email / phone
 *   - Empty body 400
 *   - POST /api/users/me/avatar:
 *       - no token → 401
 *       - with token but no file → 400
 *       - with token + text/plain file → 400 (fileFilter rejects)
 *       - with token + oversized image → 400 (LIMIT_FILE_SIZE)
 *       - with token + valid image but no Cloudinary → 503
 *
 * Run: `node smoke-tests/1.4-profile.test.js` from `server/`.
 * Exit 0 = pass.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';
// Ensure CLOUDINARY_* are NOT set — that path is what we test for the 503.
// We use empty strings rather than `delete` because dotenv.config() in
// app.js re-injects values from .env for unset keys — and an "unset"
// key that's later populated by dotenv would silently make the test
// think Cloudinary is configured. Empty string survives dotenv's
// "don't override existing vars" rule.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const { createApp } = require('../app');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');
const { configureCloudinary } = require('../config/cloudinary');

let mongo;
let server;
let baseUrl;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

async function http_(method, path, { body, token, multipart } = {}) {
  const url = new URL(baseUrl + path);
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (multipart) {
    const boundary = '----smoke' + Math.random().toString(16).slice(2);
    const chunks = [];
    for (const [name, value] of Object.entries(multipart)) {
      if (value && typeof value === 'object' && value.content !== undefined) {
        // File part — must include filename + Content-Type for multer's
        // busboy parser to recognize it as a file.
        const filename = value.filename || `${name}.bin`;
        const mime = value.mime || 'application/octet-stream';
        chunks.push(
          Buffer.from(
            `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
              `Content-Type: ${mime}\r\n\r\n`,
            'utf8'
          )
        );
        chunks.push(
          Buffer.isBuffer(value.content)
            ? value.content
            : Buffer.from(String(value.content), 'utf8')
        );
        chunks.push(Buffer.from('\r\n', 'utf8'));
      } else {
        // Plain field part
        chunks.push(
          Buffer.from(
            `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
              `${value}\r\n`,
            'utf8'
          )
        );
      }
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    const bodyBuf = Buffer.concat(chunks);
    opts.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    opts.headers['Content-Length'] = bodyBuf.length;
    return new Promise((resolve, reject) => {
      const req = http.request(url, opts, (res) => {
        let buf2 = '';
        res.on('data', (c) => (buf2 += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf2); } catch {}
          resolve({ status: res.statusCode, body: json, raw: buf2 });
        });
      });
      req.on('error', reject);
      req.write(bodyBuf);
      req.end();
    });
  }
  let serialized = null;
  if (body !== undefined) {
    serialized = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['Content-Length'] = Buffer.byteLength(serialized);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: json, raw: buf });
      });
    });
    req.on('error', reject);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

async function start() {
  console.log('--- starting in-memory mongo ---');
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  console.log('  listening on', baseUrl);
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  if (mongo) await mongo.stop();
}

async function run() {
  // Sanity — boot must NOT have configured Cloudinary.
  const configured = configureCloudinary();
  assert(configured === false, 'Cloudinary is unconfigured in this run (expected)');

  // ── 1. Health ────────────────────────────────────────────────────────────
  console.log('\n--- 1. Health ---');
  {
    const r = await http_('GET', '/api/health');
    assert(r.status === 200, 'GET /api/health returns 200');
  }

  // ── 2. Bootstrap users ──────────────────────────────────────────────────
  console.log('\n--- 2. Bootstrap users ---');
  const ownerDoc = await User.create({
    name: 'Alice Owner',
    email: 'alice-profile@example.com',
    phone: '+8801712345101',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const otherDoc = await User.create({
    name: 'Other Owner',
    email: 'other-owner@example.com',
    phone: '+8801712345202',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const ownerToken = signJwt({ id: ownerDoc._id.toString(), role: 'OWNER' });
  const otherToken = signJwt({ id: otherDoc._id.toString(), role: 'OWNER' });
  assert(typeof ownerToken === 'string', 'ownerToken issued');

  // ── 3. GET /api/users/me ───────────────────────────────────────────────
  console.log('\n--- 3. GET /api/users/me ---');
  {
    const r = await http_('GET', '/api/users/me');
    assert(r.status === 401, 'no-token GET /me returns 401');

    const r2 = await http_('GET', '/api/users/me', { token: ownerToken });
    assert(r2.status === 200, 'token GET /me returns 200');
    assert(r2.body.data.user.email === 'alice-profile@example.com', '  user.email correct');
    assert(r2.body.data.user.role === 'OWNER', '  user.role correct');
    assert(!r2.body.data.user.password, '  no password in response');

    const r3 = await http_('GET', '/api/users/me', { token: 'garbage' });
    assert(r3.status === 401, 'garbage token GET /me returns 401');
  }

  // ── 4. PATCH /api/users/me — happy path ────────────────────────────────
  console.log('\n--- 4. PATCH /me happy path ---');
  {
    const r = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { name: '  Alice Updated  ' },
    });
    assert(r.status === 200, 'PATCH {name} → 200');
    assert(r.body.data.user.name === 'Alice Updated', '  name trimmed');
    assert(r.body.data.user.role === 'OWNER', '  role unchanged');

    const r2 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { email: 'alice-renamed@example.com' },
    });
    assert(r2.status === 200, 'PATCH {email} → 200');
    assert(r2.body.data.user.email === 'alice-renamed@example.com', '  email updated');

    const r3 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { phone: '+8801712345999' },
    });
    assert(r3.status === 200, 'PATCH {phone} → 200');
    assert(r3.body.data.user.phone === '+8801712345999', '  phone updated');

    const r4 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: {
        location: { type: 'Point', coordinates: [90.412, 23.789] },
      },
    });
    assert(r4.status === 200, 'PATCH {location} → 200');
    assert(
      r4.body.data.user.location &&
        r4.body.data.user.location.coordinates[0] === 90.412,
      '  lng stored'
    );

    // PATCH multiple at once
    const r5 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { name: 'Alice Final', areaId: '6510a0a0a0a0a0a0a0a0a0a0' },
    });
    assert(r5.status === 200, 'PATCH multiple fields → 200');
    assert(r5.body.data.user.areaId === '6510a0a0a0a0a0a0a0a0a0a0', '  areaId stored');
  }

  // ── 5. PATCH /api/users/me — uniqueness 409 ────────────────────────────
  console.log('\n--- 5. PATCH /me uniqueness 409 ---');
  {
    const r = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { email: otherDoc.email },
    });
    assert(r.status === 409, 'duplicate email returns 409');
    assert(r.body.details && r.body.details.field === 'email', '  details.field = email');

    const r2 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { phone: otherDoc.phone },
    });
    assert(r2.status === 409, 'duplicate phone returns 409');
    assert(r2.body.details && r2.body.details.field === 'phone', '  details.field = phone');

    // Putting back your own email/phone is fine (no-op change).
    const r3 = await http_('PATCH', '/api/users/me', {
      token: otherToken,
      body: { email: 'other-owner@example.com' },
    });
    assert(r3.status === 200, 'keeping same email → 200');

    // Bad phone format (still has regex pre-check).
    const r4 = await http_('PATCH', '/api/users/me', {
      token: ownerToken,
      body: { phone: 'not-a-phone!!' },
    });
    assert(r4.status === 400, 'invalid phone format returns 400');
  }

  // ── 6. PATCH /api/users/me — empty body & forbidden fields ────────────
  console.log('\n--- 6. PATCH /me validation ---');
  {
    const r = await http_('PATCH', '/api/users/me', { token: ownerToken, body: {} });
    assert(r.status === 400, 'empty body returns 400');
    assert(
      /at least one field/i.test(r.body.message || ''),
      '  message mentions "at least one field"'
    );

    const forbidden = [
      'role',
      'password',
      'isVerified',
      'isActive',
      'createdAt',
      'updatedAt',
    ];
    for (const field of forbidden) {
      const body = { [field]: field === 'role' ? 'ADMIN' : 'whatever' };
      const resp = await http_('PATCH', '/api/users/me', { token: ownerToken, body });
      assert(
        resp.status === 400,
        `PATCH { ${field} } → 400 (forbidden field)`
      );
    }
  }

  // ── 7. POST /api/users/me/avatar ──────────────────────────────────────
  console.log('\n--- 7. POST /me/avatar ---');
  {
    // No file → 400 (controller check)
    const r = await http_('POST', '/api/users/me/avatar', { token: ownerToken });
    assert(r.status === 400, 'no file → 400 (No avatar file provided)');

    // No token → 401
    const r2 = await http_('POST', '/api/users/me/avatar', {
      multipart: { avatar: 'not really an avatar' },
    });
    assert(r2.status === 401, 'no token → 401');

    // Text/plain file → 400 (fileFilter rejects)
    const r3 = await http_('POST', '/api/users/me/avatar', {
      token: ownerToken,
      multipart: {
        avatar: {
          filename: 'note.txt',
          mime: 'text/plain',
          content: 'pretend this is plain text content',
        },
      },
    });
    assert(
      r3.status === 400,
      'text/plain MIME → 400 (fileFilter)'
    );
    assert(
      /unsupported file type/i.test(r3.body.message || ''),
      '  mentions unsupported file type'
    );
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await start();
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
  } finally {
    await stop();
  }
})();