/**
 * End-to-end smoke test for Module 9.7 — analytics emergency map
 * endpoint.
 *
 * Locks:
 *   - GET /api/analytics/emergency-map returns all active
 *     activations in the moderator's scope (HIERARCHY via
 *     descendantAreaIds, CIRCLE included).
 *   - Admin sees the global picture.
 *   - Non-mod/admin → 403.
 *   - Response shape is `publicActivation()` per row (no email /
 *     phone / password anywhere).
 *
 * Coverage:
 *   1. Seed: 2 districts, 2 unions (one under each district).
 *      2 owners in different districts, 1 mod in district A, 1 mod
 *      in district B, 1 admin.
 *   2. Auth gate: no token → 401. Volunteer → 403. Owner → 403.
 *   3. HIERARCHY activation in district A's UNION:
 *      - Mod A sees it.
 *      - Mod B does NOT see it (different scope).
 *   4. CIRCLE activation (unscoped to mod, includes CIRCLE always):
 *      - Mod B sees the CIRCLE activation even though it is OUT of
 *        B's district (CIRCLE is global by design — see plan).
 *      - Mod A also sees the CIRCLE.
 *   5. Admin sees both.
 *   6. Deactivated activations are excluded.
 *   7. Privacy: every payload has no email/phone/password leak.
 *
 * Run: `node smoke-tests/9.7-analytics-emergency-map.test.js`
 * from `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_97_${Date.now()}_${Math.random()
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

function http_(method, urlPath, { token } = {}) {
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
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
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState === 1) {
    try { await mongoose.connection.dropDatabase(); } catch {}
    await mongoose.disconnect();
  }
}

async function run() {
  section('1. seed 2 districts + 2 unions + users');
  const distA = await Area.create({
    country: 'BD', level: 'DISTRICT', name: 'DistA-97', parentId: null,
  });
  const distB = await Area.create({
    country: 'BD', level: 'DISTRICT', name: 'DistB-97', parentId: null,
  });
  const unionA = await Area.create({
    country: 'BD', level: 'UNION', name: 'UN-A-97', parentId: distA._id,
  });
  const unionB = await Area.create({
    country: 'BD', level: 'UNION', name: 'UN-B-97', parentId: distB._id,
  });

  const modA = await User.create({
    name: 'Mod A', email: 'ma-97@example.com', phone: '+8801730000091',
    password: 'long-enough-password', role: 'MODERATOR', isActive: true,
    areaId: distA._id,
  });
  const modB = await User.create({
    name: 'Mod B', email: 'mb-97@example.com', phone: '+8801730000092',
    password: 'long-enough-password', role: 'MODERATOR', isActive: true,
    areaId: distB._id,
  });
  const admin = await User.create({
    name: 'Admin 97', email: 'ad-97@example.com', phone: '+8801730000093',
    password: 'long-enough-password', role: 'ADMIN', isActive: true,
  });
  const owner = await User.create({
    name: 'Owner 97', email: 'o-97@example.com', phone: '+8801730000094',
    password: 'long-enough-password', role: 'OWNER', isActive: true,
    areaId: unionA._id,
  });
  const vol = await User.create({
    name: 'Vol 97', email: 'v-97@example.com', phone: '+8801730000095',
    password: 'long-enough-password', role: 'VOLUNTEER', isVerified: true,
    isActive: true, areaId: unionA._id,
  });
  const modATok = signJwt({ id: modA._id.toString(), role: 'MODERATOR' });
  const modBTok = signJwt({ id: modB._id.toString(), role: 'MODERATOR' });
  const adminTok = signJwt({ id: admin._id.toString(), role: 'ADMIN' });
  const ownerTok = signJwt({ id: owner._id.toString(), role: 'OWNER' });
  const volTok = signJwt({ id: vol._id.toString(), role: 'VOLUNTEER' });

  section('2. auth/role gate');
  {
    const r = await http_('GET', '/api/analytics/emergency-map');
    assert(r.status === 401, '  no token → 401');
  }
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: ownerTok });
    assert(r.status === 403, '  OWNER → 403');
  }
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: volTok });
    assert(r.status === 403, '  VOLUNTEER → 403');
  }

  section('3. HIERARCHY activation in district A UNION');
  const hierA = await EmergencyActivation.create({
    rootAreaId: unionA._id,
    level: 'UNION',
    scope: 'HIERARCHY',
    descendantAreaIds: [unionA._id],
    message: 'flood A',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });

  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: modATok });
    assert(r.status === 200, '  Mod A GET → 200');
    const arr = r.body.data.activations;
    assert(arr.some((a) => a.id === hierA._id.toString()), '  Mod A sees HIERARCHY A');
  }
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: modBTok });
    assert(r.status === 200, '  Mod B GET → 200');
    const arr = r.body.data.activations;
    assert(!arr.some((a) => a.id === hierA._id.toString()), '  Mod B does NOT see HIERARCHY A (different district)');
  }

  section('4. CIRCLE activation (global for mods by design)');
  const circ = await EmergencyActivation.create({
    rootAreaId: unionB._id,
    level: 'UNION',
    scope: 'CIRCLE',
    center: { type: 'Point', coordinates: [91.0, 24.0] },
    radiusMeters: 3000,
    descendantAreaIds: [],
    message: 'local circle',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  {
    const rA = await http_('GET', '/api/analytics/emergency-map', { token: modATok });
    const rB = await http_('GET', '/api/analytics/emergency-map', { token: modBTok });
    assert(
      rA.body.data.activations.some((a) => a.id === circ._id.toString()),
      '  Mod A sees CIRCLE'
    );
    assert(
      rB.body.data.activations.some((a) => a.id === circ._id.toString()),
      '  Mod B sees CIRCLE (global)'
    );
  }

  section('5. admin sees everything');
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: adminTok });
    assert(r.status === 200, '  Admin GET → 200');
    const ids = r.body.data.activations.map((a) => a.id);
    assert(ids.includes(hierA._id.toString()), '  Admin sees HIERARCHY A');
    assert(ids.includes(circ._id.toString()), '  Admin sees CIRCLE');
  }

  section('6. shape — CIRCLE row carries center + radius; HIERARCHY does not');
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: adminTok });
    const cir = r.body.data.activations.find((a) => a.id === circ._id.toString());
    assert(cir.scope === 'CIRCLE', '  CIRCLE row.scope=CIRCLE');
    assert(Array.isArray(cir.center) && cir.center[0] === 91.0 && cir.center[1] === 24.0, '  CIRCLE row.center is [lng,lat]');
    assert(cir.radiusMeters === 3000, '  CIRCLE row.radiusMeters=3000');
    const hier = r.body.data.activations.find((a) => a.id === hierA._id.toString());
    assert(hier.scope === 'HIERARCHY', '  HIERARCHY row.scope=HIERARCHY');
    assert(hier.center === null, '  HIERARCHY row.center=null');
    assert(hier.radiusMeters === null, '  HIERARCHY row.radiusMeters=null');
    assert(Array.isArray(hier.descendantAreaIds) && hier.descendantAreaIds.length === 1, '  HIERARCHY row.descendantAreaIds populated');
  }

  section('7. deactivate → excluded from map');
  await EmergencyActivation.findByIdAndUpdate(hierA._id, { isActive: false });
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: adminTok });
    const ids = r.body.data.activations.map((a) => a.id);
    assert(!ids.includes(hierA._id.toString()), '  deactivated HIERARCHY excluded');
    assert(ids.includes(circ._id.toString()), '  CIRCLE still present');
  }

  section('8. privacy');
  {
    const r = await http_('GET', '/api/analytics/emergency-map', { token: adminTok });
    assert(!hasContactLeak(r.body), '  no contact leak anywhere');
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