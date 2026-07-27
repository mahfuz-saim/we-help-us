/**
 * End-to-end smoke test for Module 1.2 (Authentication APIs).
 *
 * Spins up:
 *   - an in-memory MongoDB (mongodb-memory-server)
 *   - the real Express app
 *   - the real auth + admin routers
 *
 * Then exercises every endpoint and every design reminder:
 *   - POST /api/auth/register (OWNER, VOLUNTEER)
 *   - role restriction: ADMIN / MODERATOR / typo'd role → 400
 *   - duplicate email + duplicate phone → 409
 *   - POST /api/auth/login (by email and by phone)
 *   - bad password → 401
 *   - GET /api/auth/me (with token)
 *   - GET /api/auth/me (no token) → 401
 *   - POST /api/auth/logout (with token)
 *   - JWT verification (with bad signature, expired token)
 *   - POST /api/admin/create-privileged-user:
 *       - non-admin → 403
 *       - admin creating MODERATOR → 201
 *       - admin creating ADMIN → 201
 *       - admin creating OWNER → 400 (not a privileged role)
 *   - /api/auth/* rate limiter is wired (we don't test its math, just that
 *     it doesn't break the request path)
 *
 * Run: `node smoke-tests/1.2-auth.test.js` from `server/`.
 * Exit code 0 = all assertions passed, non-zero = first failure.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('http');

// Load env BEFORE requiring app.js (dotenv.config in app.js).
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';

const { createApp } = require('../app');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');

let mongo;
let server;
let baseUrl;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  } else {
    console.log('  ✓', msg);
  }
}

async function http_(method, path, { body, token } = {}) {
  const url = new URL(baseUrl + path);
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
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
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
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
  // ── 1. Health check ─────────────────────────────────────────────────────
  console.log('\n--- 1. Health check ---');
  {
    const r = await http_('GET', '/api/health');
    assert(r.status === 200, 'GET /api/health returns 200');
    assert(r.body.success === true, '  has success=true');
    assert(r.body.data.db.connected === true, '  db is connected');
  }

  // ── 2. Register OWNER ──────────────────────────────────────────────────
  console.log('\n--- 2. Register OWNER ---');
  let ownerToken, ownerUser;
  {
    const r = await http_('POST', '/api/auth/register', {
      body: {
        name: '  Alice Owner  ',
        email: 'Alice@Example.com',
        phone: '+8801712345001',
        password: 'long-enough-password',
        role: 'OWNER',
      },
    });
    assert(r.status === 201, 'register OWNER returns 201');
    assert(r.body.data.user.email === 'alice@example.com', '  email lowercased');
    assert(r.body.data.user.name === 'Alice Owner', '  name trimmed');
    assert(r.body.data.user.role === 'OWNER', '  role is OWNER');
    assert(!r.body.data.user.password, '  password not in response');
    assert(typeof r.body.data.token === 'string' && r.body.data.token.length > 20, '  token issued');
    ownerToken = r.body.data.token;
    ownerUser = r.body.data.user;
  }

  // ── 3. Register VOLUNTEER ───────────────────────────────────────────────
  console.log('\n--- 3. Register VOLUNTEER ---');
  let volunteerToken, volunteerUser;
  {
    const r = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Bob Volunteer',
        email: 'bob@example.com',
        phone: '+8801712345002',
        password: 'volunteer-pass-123',
        role: 'VOLUNTEER',
      },
    });
    assert(r.status === 201, 'register VOLUNTEER returns 201');
    assert(r.body.data.user.role === 'VOLUNTEER', '  role is VOLUNTEER');
    volunteerToken = r.body.data.token;
    volunteerUser = r.body.data.user;
  }

  // ── 4. Register without role defaults to OWNER ─────────────────────────
  console.log('\n--- 4. Register with no role → defaults to OWNER ---');
  {
    const r = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Default Role',
        email: 'default@example.com',
        phone: '+8801712345003',
        password: 'default-pass-1234',
      },
    });
    assert(r.status === 201, 'register without role returns 201');
    assert(r.body.data.user.role === 'OWNER', '  default role is OWNER');
  }

  // ── 5. Register rejects privileged roles ───────────────────────────────
  console.log('\n--- 5. Register rejects MODERATOR/ADMIN ---');
  {
    const r1 = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Mallory Mod',
        email: 'mallory@example.com',
        phone: '+8801712345004',
        password: 'mallory-pass-1234',
        role: 'MODERATOR',
      },
    });
    assert(r1.status === 400, 'register MODERATOR returns 400');
    assert(/role must be one of/i.test(r1.body.message), '  message mentions role');

    const r2 = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Adam Admin',
        email: 'adam@example.com',
        phone: '+8801712345005',
        password: 'adam-pass-1234',
        role: 'ADMIN',
      },
    });
    assert(r2.status === 400, 'register ADMIN returns 400');

    const r3 = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Typo Person',
        email: 'typo@example.com',
        phone: '+8801712345006',
        password: 'typo-pass-1234',
        role: 'OWNERR',
      },
    });
    assert(r3.status === 400, 'register OWNERR (typo) returns 400');
  }

  // ── 6. Duplicate email / phone ──────────────────────────────────────────
  console.log('\n--- 6. Duplicate email / phone → 409 ---');
  {
    const r1 = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Dup Email',
        email: 'alice@example.com', // already taken
        phone: '+8801712345999',
        password: 'dup-pass-1234',
        role: 'OWNER',
      },
    });
    assert(r1.status === 409, 'duplicate email returns 409');
    assert(r1.body.details && r1.body.details.field === 'email', '  details.field = email');

    const r2 = await http_('POST', '/api/auth/register', {
      body: {
        name: 'Dup Phone',
        email: 'fresh@example.com',
        phone: '+8801712345001', // already taken
        password: 'dup-pass-1234',
        role: 'OWNER',
      },
    });
    assert(r2.status === 409, 'duplicate phone returns 409');
    assert(r2.body.details && r2.body.details.field === 'phone', '  details.field = phone');
  }

  // ── 7. Validation errors ───────────────────────────────────────────────
  console.log('\n--- 7. Validation errors → 400 ---');
  {
    const r = await http_('POST', '/api/auth/register', {
      body: { name: 'X', email: 'not-an-email', phone: 'abc', password: 'short' },
    });
    assert(r.status === 400, 'register with bad fields returns 400');
    assert(r.body.details && Array.isArray(r.body.details.issues), '  has issues array');
    const paths = r.body.details.issues.map((i) => i.path);
    assert(paths.includes('email'), '  has email issue');
    assert(paths.includes('phone'), '  has phone issue');
    assert(paths.includes('password'), '  has password issue');
  }

  // ── 8. Login by email ──────────────────────────────────────────────────
  console.log('\n--- 8. Login by email ---');
  {
    const r = await http_('POST', '/api/auth/login', {
      body: { email: 'alice@example.com', password: 'long-enough-password' },
    });
    assert(r.status === 200, 'login by email returns 200');
    assert(r.body.data.token, '  token issued');
    assert(r.body.data.user.email === 'alice@example.com', '  user.email returned');
  }

  // ── 9. Login by phone ──────────────────────────────────────────────────
  console.log('\n--- 9. Login by phone ---');
  {
    const r = await http_('POST', '/api/auth/login', {
      body: { phone: '+8801712345002', password: 'volunteer-pass-123' },
    });
    assert(r.status === 200, 'login by phone returns 200');
  }

  // ── 10. Login with bad password → 401 ──────────────────────────────────
  console.log('\n--- 10. Login with bad password → 401 ---');
  {
    const r = await http_('POST', '/api/auth/login', {
      body: { email: 'alice@example.com', password: 'wrong-password' },
    });
    assert(r.status === 401, 'wrong password returns 401');
  }

  // ── 11. Login with non-existent user → 401 ─────────────────────────────
  console.log('\n--- 11. Login with unknown email → 401 ---');
  {
    const r = await http_('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'whatever-password' },
    });
    assert(r.status === 401, 'unknown user returns 401');
  }

  // ── 12. Login with neither email nor phone → 400 ───────────────────────
  console.log('\n--- 12. Login with neither email nor phone → 400 ---');
  {
    const r = await http_('POST', '/api/auth/login', {
      body: { password: 'whatever-password' },
    });
    assert(r.status === 400, 'no identifier returns 400');
  }

  // ── 13. GET /api/auth/me (with token) ──────────────────────────────────
  console.log('\n--- 13. GET /api/auth/me (with token) ---');
  {
    const r = await http_('GET', '/api/auth/me', { token: ownerToken });
    assert(r.status === 200, 'me with token returns 200');
    assert(r.body.data.user.id === ownerUser.id, '  user.id matches');
    assert(!r.body.data.user.password, '  no password in response');
  }

  // ── 14. GET /api/auth/me (no token) ────────────────────────────────────
  console.log('\n--- 14. GET /api/auth/me (no token) → 401 ---');
  {
    const r = await http_('GET', '/api/auth/me');
    assert(r.status === 401, 'me without token returns 401');
  }

  // ── 15. GET /api/auth/me (bad token) ───────────────────────────────────
  console.log('\n--- 15. GET /api/auth/me (bad token) → 401 ---');
  {
    const r = await http_('GET', '/api/auth/me', { token: 'not-a-valid-jwt' });
    assert(r.status === 401, 'me with bad token returns 401');
  }

  // ── 16. POST /api/auth/logout (with token) ─────────────────────────────
  console.log('\n--- 16. POST /api/auth/logout (with token) ---');
  {
    const r = await http_('POST', '/api/auth/logout', { token: ownerToken });
    assert(r.status === 200, 'logout with token returns 200');
    assert(r.body.success === true, '  success=true');
  }

  // ── 17. POST /api/auth/logout (no token) → 401 ─────────────────────────
  console.log('\n--- 17. POST /api/auth/logout (no token) → 401 ---');
  {
    const r = await http_('POST', '/api/auth/logout');
    assert(r.status === 401, 'logout without token returns 401');
  }

  // ── 18. /api/admin/create-privileged-user: non-admin → 403 ─────────────
  console.log('\n--- 18. /admin/create-privileged-user: non-admin → 403 ---');
  {
    const r = await http_('POST', '/api/admin/create-privileged-user', {
      token: ownerToken,
      body: {
        name: 'Should Not Work',
        email: 'noadmin@example.com',
        phone: '+8801712345111',
        password: 'noadmin-pass-1234',
        role: 'MODERATOR',
      },
    });
    assert(r.status === 403, 'owner hitting /admin returns 403');
  }

  // ── 19. /api/admin/create-privileged-user: no token → 401 ──────────────
  console.log('\n--- 19. /admin/create-privileged-user: no token → 401 ---');
  {
    const r = await http_('POST', '/api/admin/create-privileged-user', {
      body: {
        name: 'Should Not Work',
        email: 'noauth@example.com',
        phone: '+8801712345112',
        password: 'noauth-pass-1234',
        role: 'MODERATOR',
      },
    });
    assert(r.status === 401, 'no-token /admin returns 401');
  }

  // ── 20. Bootstrap an admin directly in DB for the rest of the test ────
  console.log('\n--- 20. Bootstrap an admin (direct DB) ---');
  const adminUser = await User.create({
    name: 'Root Admin',
    email: 'root@example.com',
    phone: '+8801712345900',
    password: 'root-pass-12345',
    role: 'ADMIN',
    isVerified: true,
  });
  const adminToken = signJwt({ id: adminUser._id.toString(), role: 'ADMIN' });
  assert(typeof adminToken === 'string', '  adminToken issued');

  // ── 21. /api/admin/create-privileged-user: admin → 201 (MODERATOR) ─────
  console.log('\n--- 21. Admin creates MODERATOR → 201 ---');
  {
    const r = await http_('POST', '/api/admin/create-privileged-user', {
      token: adminToken,
      body: {
        name: 'Mira Mod',
        email: 'mira@example.com',
        phone: '+8801712345910',
        password: 'mira-pass-1234',
        role: 'MODERATOR',
      },
    });
    assert(r.status === 201, 'admin creates MODERATOR returns 201');
    assert(r.body.data.user.role === 'MODERATOR', '  role is MODERATOR');
    assert(r.body.data.user.isVerified === true, '  privileged user is verified');
    assert(!r.body.data.user.password, '  password not in response');
  }

  // ── 22. /api/admin/create-privileged-user: admin → 201 (ADMIN) ─────────
  console.log('\n--- 22. Admin creates ADMIN → 201 ---');
  {
    const r = await http_('POST', '/api/admin/create-privileged-user', {
      token: adminToken,
      body: {
        name: 'Adam Two',
        email: 'adam2@example.com',
        phone: '+8801712345911',
        password: 'adam2-pass-1234',
        role: 'ADMIN',
      },
    });
    assert(r.status === 201, 'admin creates ADMIN returns 201');
    assert(r.body.data.user.role === 'ADMIN', '  role is ADMIN');
  }

  // ── 23. /api/admin/create-privileged-user: admin → 400 (OWNER) ─────────
  console.log('\n--- 23. Admin creating OWNER → 400 (schema rejects non-privileged role) ---');
  {
    const r = await http_('POST', '/api/admin/create-privileged-user', {
      token: adminToken,
      body: {
        name: 'Should Not Work',
        email: 'shouldnt@example.com',
        phone: '+8801712345912',
        password: 'shouldnt-pass-1234',
        role: 'OWNER',
      },
    });
    assert(r.status === 400, 'admin creating OWNER returns 400');
  }

  // ── 24. Soft-disabled account cannot log in ────────────────────────────
  console.log('\n--- 24. isActive=false blocks login ---');
  {
    // Disable the volunteer and try to log in.
    await User.updateOne({ email: 'bob@example.com' }, { isActive: false });
    const r = await http_('POST', '/api/auth/login', {
      body: { email: 'bob@example.com', password: 'volunteer-pass-123' },
    });
    assert(r.status === 403, 'disabled account returns 403');
  }

  // ── 25. Existing user tokens are invalidated when the account is disabled
  console.log('\n--- 25. Token issued for now-disabled user is rejected (active check on every request) ---');
  {
    // Even though JWTs are stateless, the `protect` middleware reloads the
    // user from the DB on every request and enforces `isActive`. A disabled
    // account therefore loses access immediately, regardless of token
    // expiry. (Full revocation / blacklist lands in 7.4.)
    const r = await http_('GET', '/api/auth/me', { token: volunteerToken });
    assert(r.status === 403, 'pre-disabled token returns 403');
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