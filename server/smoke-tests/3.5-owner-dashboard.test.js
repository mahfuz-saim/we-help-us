/**
 * End-to-end smoke test for Module 3.5 — Owner Dashboard (server side).
 *
 * What this validates:
 *   - The new `?mine=1` query on GET /api/resources narrows the list
 *     to resources owned by the caller. From any other caller's
 *     perspective the same `?mine=1` returns their own resources, or
 *     an empty list.
 *   - The validator accepts `mine=1` and rejects anything else
 *     (defense in depth — a sloppy param must not leak data).
 *   - PATCH /api/resources/:id accepts { status: 'UNAVAILABLE' } and
 *     { status: 'AVAILABLE' } transitions on the own resource — the
 *     dashboard's toggle action depends on this.
 *   - DELETE /api/resources/:id removes the resource; the dashboard
 *     expects a 200 + an id echo.
 *   - The 3.5 smoke test does NOT touch the form (3.4) — that's a
 *     separate module. We seed resources directly via POST so we
 *     don't pull in Cloudinary mocking; both seeded resources use
 *     zero photos.
 *   - Privacy: the dashboard response must never surface owner
 *     contact info — only ownerId.
 *
 * Storage: We connect to MongoDB Atlas (per the project's default
 * MONGODB_URI) but USE A PER-TEST EPHEMERAL DATABASE named
 * `wehelpus_smoke_35_<timestamp>_<random>`. The DB is dropped at the
 * end so we never collide with the real `wehelpus` database the dev
 * server uses. This avoids downloading mongodb-memory-server while
 * still leaving production data untouched.
 *
 * Run: `node smoke-tests/3.5-owner-dashboard.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';
// Cloudinary not exercised — every resource in this test is seeded
// without photos so we never trigger the upload path. Empty strings
// survive dotenv.config() and keep isCloudinaryConfigured() false.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const TEST_DB = `wehelpus_smoke_35_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');

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

function http_(method, urlPath, { token, body } = {}) {
  const serialized = body ? JSON.stringify(body) : null;
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(serialized ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

async function start() {
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    throw new Error(
      'MONGODB_URI is not set. Copy server/.env.example to server/.env.'
    );
  }
  await mongoose.connect(baseUri, { dbName: TEST_DB });

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
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.dropDatabase();
    } catch (e) {
      console.warn('  warn: dropDatabase failed', e.message);
    }
    await mongoose.disconnect();
  }
}

async function run() {
  // ── 1. Bootstrap two OWNERs + three resources ──────────────────────
  console.log('\n--- 1. seed two OWNERs + resources ---');
  const ownerDoc = await User.create({
    name: 'Alice Owner',
    email: 'alice-mine@example.com',
    phone: '+8801710000101',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const otherOwnerDoc = await User.create({
    name: 'Other Owner',
    email: 'other-owner-mine@example.com',
    phone: '+8801710000102',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const ownerToken = signJwt({ id: ownerDoc._id.toString(), role: 'OWNER' });
  const otherOwnerToken = signJwt({ id: otherOwnerDoc._id.toString(), role: 'OWNER' });
  assert(ownerToken && otherOwnerToken, 'tokens issued for both owners');

  const createdIds = [];
  for (let i = 0; i < 3; i += 1) {
    const ownerIdx = i < 2 ? 0 : 1;
    const token = ownerIdx === 0 ? ownerToken : otherOwnerToken;
    const r = await http_('POST', '/api/resources', {
      token,
      body: {
        category: i === 0 ? 'TRANSPORTATION' : i === 1 ? 'MEDICAL' : 'UTILITIES',
        title: `Resource ${i + 1}`,
        description: `A useful resource description for the test number ${i + 1}.`,
      },
    });
    assert(r.status === 201, `resource ${i + 1} created → 201`);
    createdIds.push(r.body.data.resource.id);
  }
  assert(createdIds.length === 3, '3 resources created');

  // ── 2. ?mine=1 narrows to the caller's own resources ──────────────
  console.log('\n--- 2. ?mine=1 owner-scoping ---');
  {
    const r = await http_('GET', '/api/resources?mine=1', { token: ownerToken });
    assert(r.status === 200, 'GET ?mine=1 → 200');
    assert(Array.isArray(r.body.data.resources), '  resources is an array');
    assert(r.body.data.resources.length === 2, '  owner1 sees 2 resources');
    assert(
      r.body.data.resources.every((x) => x.ownerId === ownerDoc._id.toString()),
      '  every hit is owned by owner1'
    );
  }
  {
    const r = await http_('GET', '/api/resources?mine=1', { token: otherOwnerToken });
    assert(r.status === 200, 'GET ?mine=1 (other) → 200');
    assert(r.body.data.resources.length === 1, '  other-owner sees 1 resource');
    assert(
      r.body.data.resources[0].ownerId === otherOwnerDoc._id.toString(),
      '  other-owner only sees their own resource'
    );
  }
  {
    // The full list (no `mine`) is unaffected — both owners' resources
    // still appear. This guards against me accidentally leaking the
    // owner-scoping into the default branch.
    const r = await http_('GET', '/api/resources', { token: ownerToken });
    assert(r.status === 200, 'GET /api/resources (no filter) → 200');
    assert(r.body.data.resources.length === 3, '  full list still has 3 resources');
  }

  // ── 3. Validator rejects bad `mine` values ────────────────────────
  console.log('\n--- 3. validator rejects bad `mine` values ---');
  for (const bad of ['2', 'true', 'yes', '0']) {
    const r = await http_('GET', `/api/resources?mine=${bad}`, { token: ownerToken });
    assert(r.status === 400, `  mine=${bad} → 400`);
  }
  const ok = await http_('GET', '/api/resources', { token: ownerToken });
  assert(ok.status === 200, 'no `mine` param → 200');

  // ── 4. PATCH toggle AVAILABLE ↔ UNAVAILABLE ────────────────────────
  console.log('\n--- 4. PATCH status toggle ---');
  {
    const id = createdIds[0];
    const r1 = await http_('PATCH', `/api/resources/${id}`, {
      token: ownerToken,
      body: { status: 'UNAVAILABLE' },
    });
    assert(r1.status === 200, 'PATCH status=UNAVAILABLE → 200');
    assert(r1.body.data.resource.status === 'UNAVAILABLE', '  status is UNAVAILABLE');

    const r2 = await http_('PATCH', `/api/resources/${id}`, {
      token: ownerToken,
      body: { status: 'AVAILABLE' },
    });
    assert(r2.status === 200, 'PATCH status=AVAILABLE → 200');
    assert(r2.body.data.resource.status === 'AVAILABLE', '  status is AVAILABLE');
  }

  // ── 5. STATUS filter combined with mine=1 ──────────────────────────
  console.log('\n--- 5. status + mine=1 compose ---');
  {
    // Toggle resource 2 to UNAVAILABLE so we can filter.
    await http_('PATCH', `/api/resources/${createdIds[1]}`, {
      token: ownerToken,
      body: { status: 'UNAVAILABLE' },
    });
    const r = await http_('GET', '/api/resources?mine=1&status=UNAVAILABLE', {
      token: ownerToken,
    });
    assert(r.status === 200, 'GET ?mine=1&status=UNAVAILABLE → 200');
    assert(r.body.data.resources.length === 1, '  owner1 sees 1 UNAVAILABLE');
    assert(r.body.data.resources[0].status === 'UNAVAILABLE', '  result is UNAVAILABLE');
    assert(r.body.data.resources[0].ownerId === ownerDoc._id.toString(), '  result is owned by owner1');
  }

  // ── 6. DELETE removes the resource ────────────────────────────────
  console.log('\n--- 6. DELETE /api/resources/:id ---');
  {
    const id = createdIds[2]; // other-owner's resource
    const r = await http_('DELETE', `/api/resources/${id}`, { token: otherOwnerToken });
    assert(r.status === 200, 'DELETE own resource → 200');
    assert(r.body.data && r.body.data.id === id, '  response echoes id');

    const r2 = await http_('GET', `/api/resources/${id}`, { token: otherOwnerToken });
    assert(r2.status === 404, 'GET deleted resource → 404');

    const r3 = await http_('GET', '/api/resources?mine=1', { token: otherOwnerToken });
    assert(r3.body.data.resources.length === 0, 'other-owner mine-list is empty after delete');
  }

  // ── 7. Privacy: owner contact info never appears in the response ──
  console.log('\n--- 7. privacy boundary on mine=1 list ---');
  {
    const blob = JSON.stringify(
      await http_('GET', '/api/resources?mine=1', { token: ownerToken }).then((r) => r.body)
    );
    assert(!/alice-mine@example\.com/.test(blob), '  no owner email leaks');
    assert(!/\+8801710000101/.test(blob), '  no owner phone leaks');
    assert(!/Alice Owner/.test(blob), '  no owner name leaks');
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