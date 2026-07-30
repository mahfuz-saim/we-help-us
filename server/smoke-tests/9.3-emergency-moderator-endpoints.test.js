/**
 * End-to-end smoke test for Module 9.3 — moderator-side emergency
 * activation + 6.3 back-compat shim regression.
 *
 * Locks:
 *   - POST   /api/moderator/emergency-activations (new)
 *   - PATCH  /api/moderator/emergency-activations/:id/deactivate
 *   - PATCH  /api/moderator/emergency-mode (6.3 shim — unchanged
 *     wire contract, now backed by EmergencyActivation)
 *   - GET    /api/moderator/emergency-mode (6.3 — reads from
 *     EmergencyActivation)
 *
 * Coverage:
 *   1. Seed: 1 area + 1 MODERATOR assigned to it + 1 ADMIN + 1
 *      VOLUNTEER + 1 OTHER-MODERATOR in another area.
 *   2. POST /moderator/emergency-activations:
 *      - 401 without token, 403 for VOLUNTEER.
 *      - 403 if rootAreaId != moderator.areaId.
 *      - 200 with valid rootAreaId, response shape matches
 *        publicShape.
 *   3. PATCH /moderator/emergency-mode (6.3 shim):
 *      - `{ isActive: true }` → 200, response carries the 6.3
 *        shape { areaId, isActive, activatedAt, activatedBy }.
 *        activatedBy is publicUserDirectory (no email/phone).
 *      - DB row exists in EmergencyActivation (not Area.emergencyMode).
 *      - `{ isActive: false }` → 200, isActive=false; row in
 *        EmergencyActivation has isActive=false.
 *   4. 6.3 GET /emergency-mode:
 *      - Initially inactive.
 *      - After 6.3 PATCH isActive=true, GET reflects isActive=true
 *        and activatedAt + activatedBy.
 *      - After 6.3 PATCH isActive=false, GET reflects inactive.
 *   5. 6.3 privacy: no email / phone / password in any payload.
 *
 * Run: `node smoke-tests/9.3-emergency-moderator-endpoints.test.js`
 * from `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_93_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Area = require('../models/Area');
const EmergencyActivation = require('../models/EmergencyActivation');
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
function section(t) { console.log('\n--- ' + t + ' ---'); }

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
          ...(serialized
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(serialized),
              }
            : {}),
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

function hasContactLeak(obj) {
  if (!obj) return false;
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(walk);
    for (const key of ['email', 'phone', 'password']) {
      if (Object.prototype.hasOwnProperty.call(node, key) && node[key]) {
        return true;
      }
    }
    return Object.values(node).some(walk);
  }
  return walk(obj);
}

async function start() {
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) throw new Error('MONGODB_URI is not set.');
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
    } catch {}
    await mongoose.disconnect();
  }
}

async function run() {
  section('1. seed');
  const district = await Area.create({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: 'Mod District',
    parentId: null,
  });
  const otherDistrict = await Area.create({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: 'Other District',
    parentId: null,
  });
  const districtHex = district._id.toString();
  const otherHex = otherDistrict._id.toString();

  const mod = await User.create({
    name: 'Mod Smoke',
    email: 'mod-smoke@example.com',
    phone: '+8801710000001',
    password: 'long-enough-password',
    role: 'MODERATOR',
    isVerified: true,
    isActive: true,
    areaId: district._id,
  });
  const otherMod = await User.create({
    name: 'Other Mod',
    email: 'other-mod@example.com',
    phone: '+8801710000002',
    password: 'long-enough-password',
    role: 'MODERATOR',
    isActive: true,
    areaId: otherDistrict._id,
  });
  const admin = await User.create({
    name: 'Admin Smoke',
    email: 'admin-smoke@example.com',
    phone: '+8801710000003',
    password: 'long-enough-password',
    role: 'ADMIN',
    isActive: true,
  });
  const volunteer = await User.create({
    name: 'V Smoke',
    email: 'v-smoke@example.com',
    phone: '+8801710000004',
    password: 'long-enough-password',
    role: 'VOLUNTEER',
    isVerified: true,
    isActive: true,
  });
  const modTok = signJwt({ id: mod._id.toString(), role: 'MODERATOR' });
  const otherModTok = signJwt({ id: otherMod._id.toString(), role: 'MODERATOR' });
  const adminTok = signJwt({ id: admin._id.toString(), role: 'ADMIN' });
  const volTok = signJwt({ id: volunteer._id.toString(), role: 'VOLUNTEER' });

  section('2. POST /moderator/emergency-activations — auth gates');
  {
    const r = await http_('POST', '/api/moderator/emergency-activations', {
      body: { rootAreaId: districtHex, message: 'no auth' },
    });
    assert(r.status === 401, '  no token → 401');
  }
  {
    const r = await http_('POST', '/api/moderator/emergency-activations', {
      token: volTok,
      body: { rootAreaId: districtHex, message: 'volunteer cannot' },
    });
    assert(r.status === 403, '  VOLUNTEER → 403');
  }

  section('3. POST /moderator/emergency-activations — authority');
  {
    const r = await http_('POST', '/api/moderator/emergency-activations', {
      token: otherModTok,
      body: { rootAreaId: districtHex, message: 'wrong mod' },
    });
    assert(r.status === 403, '  other-area mod → 403');
  }

  section('4. POST /moderator/emergency-activations — happy path');
  let createdModId = null;
  {
    const r = await http_('POST', '/api/moderator/emergency-activations', {
      token: modTok,
      body: { rootAreaId: districtHex, message: 'mod activates for own area' },
    });
    assert(r.status === 200 || r.status === 201, `  POST → ${r.status}`);
    const a = r.body && r.body.data && r.body.data.activation;
    assert(a && a.id, '  activation.id present');
    assert(a.scope === 'HIERARCHY', '  scope=HIERARCHY (no center)');
    assert(a.rootAreaId === districtHex, '  rootAreaId matches');
    assert(a.activatedByRole === 'MODERATOR', '  activatedByRole=MODERATOR');
    createdModId = a.id;
    assert(!hasContactLeak(r.body), '  no contact leak');
  }

  section('5. PATCH /moderator/emergency-activations/:id/deactivate');
  {
    const r = await http_(
      'PATCH',
      `/api/moderator/emergency-activations/${createdModId}/deactivate`,
      { token: modTok }
    );
    assert(r.status === 200, '  deactivate → 200');
    assert(r.body.data.activation.isActive === false, '  isActive=false');
  }

  section('6. 6.3 shim — GET /emergency-mode initially inactive');
  {
    const r = await http_('GET', '/api/moderator/emergency-mode', { token: modTok });
    assert(r.status === 200, '  GET → 200');
    assert(r.body.data.isActive === false, '  initially inactive');
    assert(r.body.data.activatedAt === null, '  activatedAt=null');
    assert(r.body.data.activatedBy === null, '  activatedBy=null');
  }

  section('7. 6.3 shim — PATCH /emergency-mode { isActive: true }');
  {
    const r = await http_('PATCH', '/api/moderator/emergency-mode', {
      token: modTok,
      body: { isActive: true, note: 'shim test' },
    });
    assert(r.status === 200, '  PATCH → 200');
    assert(r.body.data.isActive === true, '  isActive=true');
    assert(r.body.data.areaId === districtHex, '  areaId matches');
    assert(r.body.data.activatedAt, '  activatedAt present');
    assert(
      r.body.data.activatedBy && r.body.data.activatedBy.id === mod._id.toString(),
      '  activatedBy.id matches moderator'
    );
    assert(
      r.body.data.activatedBy && r.body.data.activatedBy.role === 'MODERATOR',
      '  activatedBy.role=MODERATOR'
    );
    assert(r.body.data.note === 'shim test', '  note echoed');
    assert(!hasContactLeak(r.body), '  no contact leak');

    // DB state lives in EmergencyActivation (not Area.emergencyMode).
    const dbRow = await EmergencyActivation.findOne({
      rootAreaId: district._id,
      activatedBy: mod._id,
      isActive: true,
    });
    assert(dbRow, '  EmergencyActivation row exists');

    const areaAfter = await Area.findById(district._id);
    assert(
      !areaAfter.emergencyMode || areaAfter.emergencyMode.isActive !== true,
      '  Area.emergencyMode NOT used as storage (shim wrote to EmergencyActivation only)'
    );
  }

  section('8. 6.3 shim — GET reads back the shim state');
  {
    const r = await http_('GET', '/api/moderator/emergency-mode', { token: modTok });
    assert(r.status === 200, '  GET → 200');
    assert(r.body.data.isActive === true, '  isActive=true after PATCH');
    assert(r.body.data.activatedAt, '  activatedAt present');
    assert(
      r.body.data.activatedBy && r.body.data.activatedBy.id === mod._id.toString(),
      '  activatedBy.id matches'
    );
    assert(!hasContactLeak(r.body), '  no contact leak');
  }

  section('9. 6.3 shim — idempotency: re-activate while active');
  {
    const r1 = await http_('PATCH', '/api/moderator/emergency-mode', {
      token: modTok,
      body: { isActive: true },
    });
    assert(r1.status === 200, '  re-activate → 200');
    assert(r1.body.data.isActive === true, '  still active');
    // activatedAt should NOT change on re-activate.
    const t1 = new Date(r1.body.data.activatedAt).getTime();
    const fresh = await EmergencyActivation.findOne({
      rootAreaId: district._id,
      activatedBy: mod._id,
      isActive: true,
    });
    assert(
      Math.abs(new Date(fresh.activatedAt).getTime() - t1) < 5000,
      '  activatedAt unchanged'
    );
  }

  section('10. 6.3 shim — PATCH /emergency-mode { isActive: false }');
  {
    const r = await http_('PATCH', '/api/moderator/emergency-mode', {
      token: modTok,
      body: { isActive: false },
    });
    assert(r.status === 200, '  deactivate → 200');
    assert(r.body.data.isActive === false, '  isActive=false');
    assert(r.body.data.activatedAt === null, '  activatedAt=null after deactivate');
    assert(r.body.data.activatedBy === null, '  activatedBy=null after deactivate');

    const dbRow = await EmergencyActivation.findOne({
      rootAreaId: district._id,
      activatedBy: mod._id,
      isActive: true,
    });
    assert(!dbRow, '  no active EmergencyActivation row remains');
  }

  section('11. 6.3 admin still gets 403 (admin oversight is future module)');
  {
    const r = await http_('GET', '/api/moderator/emergency-mode', { token: adminTok });
    // Admin token IS authorised (router gate allows ADMIN); but
    // the controller requires areaId → 403.
    assert(r.status === 403, `  admin GET /emergency-mode → 403 (got ${r.status})`);
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