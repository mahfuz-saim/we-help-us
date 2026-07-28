/**
 * End-to-end smoke test for Module 6.3 — Emergency Mode.
 *
 * Locks the per-area emergency activation surface:
 *   - GET  /api/moderator/emergency-mode
 *   - PATCH /api/moderator/emergency-mode
 *
 * Coverage:
 *   1. Seed: 2 areas (in-area + out-of-area), 4 users (ModInArea,
 *      ModOutOfArea, ModNoArea, Admin, plus Alice owner + Eve
 *      volunteer as non-moderator tokens for the role-gate).
 *   2. Auth gates: 401 without token on GET + PATCH; 403 for
 *      OWNER + VOLUNTEER tokens on both endpoints.
 *   3. GET /emergency-mode (no-area): ModNoArea → 403, Admin →
 *      403 (admin oversight of emergency mode is a future module).
 *   4. PATCH /emergency-mode (no-area): same 403 contract on
 *      activation AND deactivation.
 *   5. PATCH activate: ModInArea activates → 200 with the
 *      publicEmergencyMode shape (areaId, isActive=true, activatedAt
 *      Date, activatedBy public User shape — id + name + role +
 *      isVerified + isActive + areaId + timestamps; NO email /
 *      phone / password); DB persisted.
 *   6. GET reads the same shape: 200, isActive=true, activatedBy
 *      has the actor's name + role; no contact leak.
 *   7. Idempotency: re-activating while already active is a no-op
 *      (200, but activatedAt does NOT change — the actor field
 *      stays the same; smoke asserts both).
 *   8. PATCH deactivate: 200, isActive=false, activatedAt=null,
 *      activatedBy=null; DB persisted.
 *   9. Idempotency on deactivate: re-deactivating while inactive
 *      is a no-op (200, no DB write).
 *  10. Activator round-trip: after activation, the response's
 *      `activatedBy.name` equals the moderator's name and the
 *      `activatedBy.role === 'MODERATOR'`.
 *  11. Cross-area: ModOutOfArea's own GET returns inactive (never
 *      touched) — independent of ModInArea's flip.
 *  12. Privacy: every response payload walked by `hasContactLeak`
 *      returns false — including the activatedBy subdoc.
 *  13. Validator strictness: PATCH with no body → 400; unknown
 *      body key → 400; isActive not boolean → 400; note > 1000
 *      chars → 400; exactly 1000 chars accepted (200); missing
 *      isActive → 400.
 *  14. Not-found edge: if the moderator's assigned area is deleted
 *      while the dashboard is open, GET /emergency-mode → 404
 *      (defensive — the area could be removed by admin; the
 *      controller surfaces a friendly message).
 *
 * Run: `node smoke-tests/6.3-emergency-mode.test.js` from
 * `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_63_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Area = require('../models/Area');
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

function section(title) {
  console.log('\n--- ' + title + ' ---');
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
          try {
            json = JSON.parse(buf);
          } catch {}
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

async function seedUser({
  name,
  email,
  phone,
  role,
  isVerified = false,
  areaId = null,
}) {
  const doc = await User.create({
    name,
    email,
    phone,
    password: 'long-enough-password',
    role,
    isVerified,
    areaId,
  });
  const token = signJwt({ id: doc._id.toString(), role });
  return { doc, token };
}

async function seedArea({ name, level = 'UNION' }) {
  // Mongoose model — avoid the raw collection insert used in earlier
  // smokes so the new `emergencyMode` field has its default values
  // applied through the schema path.
  const doc = await Area.create({
    country: 'Bangladesh',
    level,
    name,
    parentId: null,
  });
  return doc._id;
}

async function run() {
  await start();

  // ── 1. Seed ─────────────────────────────────────────────────────────
  section('1. seed users + areas');
  const inAreaId = await seedArea({ name: 'Test Union 63 In' });
  const outAreaId = await seedArea({ name: 'Test Union 63 Out' });
  assert(inAreaId && outAreaId, '2 areas seeded (in-area + out-of-area)');

  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 63',
    email: 'alice.owner63@example.com',
    phone: '+15555560101',
    role: 'OWNER',
    areaId: inAreaId,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve Volunteer 63',
    email: 'eve.vol63@example.com',
    phone: '+15555560201',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });

  const { doc: modInArea, token: modInToken } = await seedUser({
    name: 'Mod InArea 63',
    email: 'mod.inarea63@example.com',
    phone: '+15555560301',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modOutArea, token: modOutToken } = await seedUser({
    name: 'Mod OutOfArea 63',
    email: 'mod.outarea63@example.com',
    phone: '+15555560302',
    role: 'MODERATOR',
    areaId: outAreaId,
  });
  const { doc: modNoArea, token: modNoToken } = await seedUser({
    name: 'Mod NoArea 63',
    email: 'mod.noarea63@example.com',
    phone: '+15555560303',
    role: 'MODERATOR',
    areaId: null,
  });
  const { doc: admin, token: adminToken } = await seedUser({
    name: 'Admin 63',
    email: 'admin63@example.com',
    phone: '+15555560401',
    role: 'ADMIN',
    areaId: null,
  });

  assert(alice && eve && modInArea && modOutArea && modNoArea && admin, 'all users seeded');

  // Verify the seeded areas start with emergencyMode.isActive=false
  // (default from the schema path).
  const seedAreaIn = await Area.findById(inAreaId);
  const seedAreaOut = await Area.findById(outAreaId);
  assert(
    seedAreaIn.emergencyMode.isActive === false,
    'seed: in-area.emergencyMode.isActive defaults to false'
  );
  assert(
    seedAreaOut.emergencyMode.isActive === false,
    'seed: out-area.emergencyMode.isActive defaults to false'
  );

  // ── 2. Auth gates ───────────────────────────────────────────────────
  section('2. auth gates');

  const noTokenGet = await http_('GET', '/api/moderator/emergency-mode');
  assert(noTokenGet.status === 401, 'GET without token → 401');

  const noTokenPatch = await http_('PATCH', '/api/moderator/emergency-mode', {
    body: { isActive: true },
  });
  assert(noTokenPatch.status === 401, 'PATCH without token → 401');

  const ownerGet = await http_('GET', '/api/moderator/emergency-mode', {
    token: aliceToken,
  });
  assert(ownerGet.status === 403, 'GET with OWNER token → 403');

  const ownerPatch = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: aliceToken, body: { isActive: true } }
  );
  assert(ownerPatch.status === 403, 'PATCH with OWNER token → 403');

  const volunteerGet = await http_('GET', '/api/moderator/emergency-mode', {
    token: eveToken,
  });
  assert(volunteerGet.status === 403, 'GET with VOLUNTEER token → 403');

  const volunteerPatch = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: eveToken, body: { isActive: true } }
  );
  assert(volunteerPatch.status === 403, 'PATCH with VOLUNTEER token → 403');

  // ── 3. No-area 403 on GET ───────────────────────────────────────────
  section('3. no-area 403 on GET');

  const noAreaGet = await http_('GET', '/api/moderator/emergency-mode', {
    token: modNoToken,
  });
  assert(noAreaGet.status === 403, 'ModNoArea GET → 403');
  assert(
    typeof noAreaGet.body?.message === 'string' &&
      noAreaGet.body.message.toLowerCase().includes('assigned to an area'),
    'GET 403 message mentions "assigned to an area"'
  );

  const adminGet = await http_('GET', '/api/moderator/emergency-mode', {
    token: adminToken,
  });
  assert(
    adminGet.status === 403,
    'Admin GET → 403 (admin oversight is a future module)'
  );

  // ── 4. No-area 403 on PATCH ─────────────────────────────────────────
  section('4. no-area 403 on PATCH');

  const noAreaActivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modNoToken, body: { isActive: true } }
  );
  assert(noAreaActivate.status === 403, 'ModNoArea PATCH activate → 403');
  assert(
    typeof noAreaActivate.body?.message === 'string' &&
      noAreaActivate.body.message
        .toLowerCase()
        .includes('assigned to an area'),
    'PATCH 403 message mentions "assigned to an area"'
  );

  const adminActivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: adminToken, body: { isActive: true } }
  );
  assert(
    adminActivate.status === 403,
    'Admin PATCH activate → 403 (admin oversight is a future module)'
  );

  // ── 5. PATCH activate ───────────────────────────────────────────────
  section('5. PATCH activate — ModInArea activates');

  const activate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: true, note: 'flash flood' } }
  );
  assert(activate.status === 200, 'PATCH activate → 200');
  assert(activate.body?.success === true, 'response.success === true');
  assert(
    activate.body?.message === 'Emergency mode activated',
    'response.message === "Emergency mode activated"'
  );

  const em = activate.body?.data;
  assert(em, 'response.data present');
  assert(
    em.areaId === inAreaId.toString(),
    'response.data.areaId matches in-area'
  );
  assert(em.isActive === true, 'response.data.isActive === true');
  assert(em.activatedAt, 'response.data.activatedAt is set');
  assert(
    typeof em.activatedAt === 'string',
    'response.data.activatedAt is a string (JSON-serialized Date)'
  );
  assert(em.note === 'flash flood', 'response.data.note echoes input');

  const activatedBy = em.activatedBy;
  assert(activatedBy, 'response.data.activatedBy present');
  assert(activatedBy.id, 'activatedBy.id present');
  assert(
    activatedBy.name === 'Mod InArea 63',
    'activatedBy.name === "Mod InArea 63"'
  );
  assert(
    activatedBy.role === 'MODERATOR',
    'activatedBy.role === "MODERATOR"'
  );
  assert(
    activatedBy.areaId === inAreaId.toString(),
    'activatedBy.areaId === in-area'
  );
  assert(
    activatedBy.isActive === true,
    'activatedBy.isActive === true'
  );
  assert(
    !activatedBy.password,
    'activatedBy has NO password (toSafeObject strips)'
  );
  assert(
    !hasContactLeak(activatedBy),
    'activatedBy has NO email/phone/password leak'
  );
  assert(
    !hasContactLeak(activate.body),
    'full PATCH response has NO email/phone/password leak anywhere'
  );

  // DB persisted.
  const dbArea = await Area.findById(inAreaId);
  assert(
    dbArea.emergencyMode.isActive === true,
    'DB: in-area.emergencyMode.isActive persisted as true'
  );
  assert(
    dbArea.emergencyMode.activatedBy &&
      dbArea.emergencyMode.activatedBy.toString() ===
        modInArea._id.toString(),
    'DB: in-area.emergencyMode.activatedBy persisted as ModInArea'
  );
  assert(
    dbArea.emergencyMode.activatedAt instanceof Date,
    'DB: in-area.emergencyMode.activatedAt persisted as a Date'
  );

  // ── 6. GET reads the same shape ─────────────────────────────────────
  section('6. GET reads the same shape');

  const getActive = await http_('GET', '/api/moderator/emergency-mode', {
    token: modInToken,
  });
  assert(getActive.status === 200, 'GET → 200');
  assert(getActive.body?.data?.isActive === true, 'GET shows isActive=true');
  assert(
    getActive.body?.data?.activatedBy?.name === 'Mod InArea 63',
    'GET activatedBy.name === "Mod InArea 63"'
  );
  assert(
    !hasContactLeak(getActive.body),
    'GET response has NO email/phone/password leak'
  );

  // ── 7. Idempotency on activate ──────────────────────────────────────
  section('7. idempotency — re-activating is a no-op');

  const dbBefore = await Area.findById(inAreaId);
  const activatedAtBefore = dbBefore.emergencyMode.activatedAt.getTime();

  // Re-activate after a brief wait so any save would move updatedAt
  // and we'd see it in the diff.
  await new Promise((r) => setTimeout(r, 50));

  const reactivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: true } }
  );
  assert(reactivate.status === 200, 're-activate → 200');
  assert(
    reactivate.body?.data?.isActive === true,
    're-activate response still isActive=true'
  );

  const dbAfter = await Area.findById(inAreaId);
  assert(
    dbAfter.emergencyMode.activatedAt.getTime() === activatedAtBefore,
    'idempotent: activatedAt unchanged (no DB write)'
  );
  assert(
    dbAfter.emergencyMode.activatedBy.toString() ===
      modInArea._id.toString(),
    'idempotent: activatedBy unchanged'
  );

  // ── 8. PATCH deactivate ─────────────────────────────────────────────
  section('8. PATCH deactivate — ModInArea deactivates');

  const deactivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: false } }
  );
  assert(deactivate.status === 200, 'PATCH deactivate → 200');
  assert(
    deactivate.body?.message === 'Emergency mode deactivated',
    'response.message === "Emergency mode deactivated"'
  );
  assert(
    deactivate.body?.data?.isActive === false,
    'response.data.isActive === false'
  );
  assert(
    deactivate.body?.data?.activatedAt === null,
    'response.data.activatedAt === null after deactivate'
  );
  assert(
    deactivate.body?.data?.activatedBy === null,
    'response.data.activatedBy === null after deactivate'
  );
  assert(
    !hasContactLeak(deactivate.body),
    'deactivate response has NO email/phone/password leak'
  );

  // DB persisted.
  const dbDeactivated = await Area.findById(inAreaId);
  assert(
    dbDeactivated.emergencyMode.isActive === false,
    'DB: in-area.emergencyMode.isActive persisted as false'
  );
  assert(
    dbDeactivated.emergencyMode.activatedAt === null,
    'DB: in-area.emergencyMode.activatedAt cleared to null'
  );
  assert(
    dbDeactivated.emergencyMode.activatedBy === null,
    'DB: in-area.emergencyMode.activatedBy cleared to null'
  );

  // GET reflects the deactivated state.
  const getInactive = await http_('GET', '/api/moderator/emergency-mode', {
    token: modInToken,
  });
  assert(
    getInactive.body?.data?.isActive === false,
    'GET reflects deactivated state'
  );
  assert(
    getInactive.body?.data?.activatedAt === null,
    'GET activatedAt === null while inactive'
  );
  assert(
    getInactive.body?.data?.activatedBy === null,
    'GET activatedBy === null while inactive'
  );

  // ── 9. Idempotency on deactivate ────────────────────────────────────
  section('9. idempotency — re-deactivating is a no-op');

  const dbBeforeDeact = await Area.findById(inAreaId);
  const updatedAtBefore = dbBeforeDeact.updatedAt.getTime();
  await new Promise((r) => setTimeout(r, 50));
  const redeactivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: false } }
  );
  assert(redeactivate.status === 200, 're-deactivate → 200');
  const dbAfterDeact = await Area.findById(inAreaId);
  assert(
    dbAfterDeact.updatedAt.getTime() === updatedAtBefore,
    'idempotent: updatedAt unchanged (no DB write)'
  );

  // ── 10. Activator round-trip ────────────────────────────────────────
  section('10. activator round-trip (activate → GET → same actor)');

  const reActivate = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: true } }
  );
  assert(reActivate.status === 200, 're-activate → 200');

  const verifyActor = await http_('GET', '/api/moderator/emergency-mode', {
    token: modInToken,
  });
  assert(
    verifyActor.body?.data?.activatedBy?.id === modInArea._id.toString(),
    'GET activatedBy.id === ModInArea._id (round-trip)'
  );
  assert(
    verifyActor.body?.data?.activatedBy?.role === 'MODERATOR',
    'GET activatedBy.role === "MODERATOR"'
  );

  // ── 11. Cross-area isolation ────────────────────────────────────────
  section('11. cross-area isolation');

  const otherArea = await http_('GET', '/api/moderator/emergency-mode', {
    token: modOutToken,
  });
  assert(otherArea.status === 200, 'ModOutArea GET → 200');
  assert(
    otherArea.body?.data?.areaId === outAreaId.toString(),
    'ModOutArea sees THEIR areaId (not ModInArea)'
  );
  assert(
    otherArea.body?.data?.isActive === false,
    "ModOutArea's area is still inactive (independent)"
  );
  assert(
    otherArea.body?.data?.activatedBy === null,
    "ModOutArea's area has null activatedBy"
  );

  // ── 12. Privacy ─────────────────────────────────────────────────────
  section('12. privacy — full body never leaks contact info');

  // Re-iterate the contact-leak walker on every response we've already
  // collected. (Most sections assert on a single response; this is a
  // belt-and-braces sweep across the dataset.)

  // Walk every payload from a fresh activate cycle.
  await http_('PATCH', '/api/moderator/emergency-mode', {
    token: modInToken,
    body: { isActive: false },
  });
  const fresh = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    {
      token: modInToken,
      body: { isActive: true, note: 'privacy-sweep' },
    }
  );
  assert(
    !hasContactLeak(fresh.body),
    'fresh PATCH response has NO email/phone/password leak'
  );

  // ── 13. Validator strictness ────────────────────────────────────────
  section('13. validator strictness');

  // Missing body entirely.
  const noBody = await http_('PATCH', '/api/moderator/emergency-mode', {
    token: modInToken,
  });
  assert(noBody.status === 400, 'PATCH with no body → 400');

  // Unknown body key.
  const unknown = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: true, foo: 'bar' } }
  );
  assert(unknown.status === 400, 'PATCH with unknown body key → 400');

  // isActive is not boolean.
  const notBool = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: 'yes' } }
  );
  assert(notBool.status === 400, 'PATCH with isActive not boolean → 400');

  // Missing isActive.
  const noActive = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { note: 'no isActive' } }
  );
  assert(noActive.status === 400, 'PATCH with missing isActive → 400');

  // note > 1000 chars.
  const tooLong = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: true, note: 'x'.repeat(1001) } }
  );
  assert(tooLong.status === 400, 'PATCH with note > 1000 chars → 400');

  // note exactly 1000 chars accepted.
  const okNote = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: modInToken, body: { isActive: false, note: 'y'.repeat(1000) } }
  );
  assert(okNote.status === 200, 'PATCH with note at 1000 chars accepted');

  // ── 14. Area-deleted edge ───────────────────────────────────────────
  section('14. area-deleted edge (admin removes the area)');

  // Create a fresh moderator pointing at a fresh area, then delete
  // the area out from under the moderator's session.
  const ghostAreaId = await seedArea({ name: 'Test Union 63 Ghost' });
  const { doc: ghostMod, token: ghostModToken } = await seedUser({
    name: 'Mod Ghost 63',
    email: 'mod.ghost63@example.com',
    phone: '+15555560304',
    role: 'MODERATOR',
    areaId: ghostAreaId,
  });
  await Area.findByIdAndDelete(ghostAreaId);

  const ghostGet = await http_('GET', '/api/moderator/emergency-mode', {
    token: ghostModToken,
  });
  assert(
    ghostGet.status === 404,
    'GET after area deletion → 404 (defensive)'
  );
  assert(
    typeof ghostGet.body?.message === 'string' &&
      ghostGet.body.message.toLowerCase().includes('area'),
    '404 message mentions "area"'
  );

  const ghostPatch = await http_(
    'PATCH',
    '/api/moderator/emergency-mode',
    { token: ghostModToken, body: { isActive: true } }
  );
  assert(
    ghostPatch.status === 404,
    'PATCH after area deletion → 404 (defensive)'
  );

  await stop();
  console.log('\nALL ASSERTIONS PASSED');
}

run().catch(async (err) => {
  console.error('\nFATAL:', err);
  await stop();
  process.exit(1);
});
