/**
 * End-to-end smoke test for Module 6.2 — Volunteer Verification.
 *
 * Locks the moderator-side verification action:
 *   - POST /api/moderator/verify-volunteer/:userId
 *
 * Coverage:
 *   1. Seed: 2 areas (in-area + out-of-area), 4 volunteers (in-area
 *      verified, in-area unverified, out-of-area, no-area), 4
 *      moderators (in-area, out-of-area, no-area), 1 admin, plus a
 *      non-VOLUNTEER user (Alice owner) to assert the role gate.
 *   2. Auth gates: 401 without token; 403 for OWNER, VOLUNTEER
 *      tokens on the verify action.
 *   3. Happy path: ModInArea verifies in-area unverified volunteer →
 *      200, response has publicUserDirectory shape (id + name +
 *      role + isVerified=true + isActive + areaId + createdAt +
 *      updatedAt), NO email/phone/password.
 *   4. Idempotency: a second POST on an already-verified user is a
 *      no-op 200 — the response still has isVerified=true.
 *   5. Role gate: trying to verify an OWNER returns 400 ("Only users
 *      with the VOLUNTEER role can be verified...").
 *   6. Cross-area 403: ModInArea trying to verify the out-of-area
 *      volunteer returns 403.
 *   7. No-area 403: ModNoArea trying to verify any volunteer returns
 *      403 ("You must be assigned to an area to verify volunteers").
 *   8. Admin cross-scope: ADMIN verifies the out-of-area volunteer
 *      (admin is global); returns 200, isVerified=true.
 *   9. Not-found 404: bogus ObjectId → 404.
 *  10. Validator strictness: malformed :userId (non-ObjectId) → 400;
 *      unknown body key → 400; moderatorNote > 1000 chars → 400;
 *      moderatorNote with valid length accepted.
 *  11. Privacy regression: NO contact leak on either happy-path or
 *      idempotent response (hasContactLeak returns false).
 *
 * Run: `node smoke-tests/6.2-volunteer-verification.test.js` from
 * `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_62_${Date.now()}_${Math.random()
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
  const r = await mongoose.connection.db.collection('areas').insertOne({
    country: 'Bangladesh',
    level,
    name,
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return r.insertedId;
}

async function run() {
  await start();

  // ── 1. Seed ─────────────────────────────────────────────────────────
  section('1. seed users + areas');
  const inAreaId = await seedArea({ name: 'Test Union 62 In' });
  const outAreaId = await seedArea({ name: 'Test Union 62 Out' });
  assert(inAreaId && outAreaId, '2 areas seeded (in-area + out-of-area)');

  // Alice is an OWNER — used to assert the role gate (verify expects
  // a VOLUNTEER target).
  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 62',
    email: 'alice.owner62@example.com',
    phone: '+15555560101',
    role: 'OWNER',
    areaId: inAreaId,
  });

  // In-area unverified volunteer — the primary target.
  const { doc: unverifiedVol, token: unverifiedVolToken } = await seedUser({
    name: 'Ivy Volunteer 62',
    email: 'ivy.vol62@example.com',
    phone: '+15555560201',
    role: 'VOLUNTEER',
    isVerified: false,
    areaId: inAreaId,
  });

  // In-area already-verified volunteer — for idempotency test.
  const { doc: verifiedVol, token: verifiedVolToken } = await seedUser({
    name: 'Vera Volunteer 62',
    email: 'vera.vol62@example.com',
    phone: '+15555560202',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });

  // Out-of-area verified volunteer — for cross-area 403 + admin bypass.
  const { doc: outVol, token: outVolToken } = await seedUser({
    name: 'OutOfArea Volunteer 62',
    email: 'outvol62@example.com',
    phone: '+15555560203',
    role: 'VOLUNTEER',
    isVerified: false,
    areaId: outAreaId,
  });

  const { doc: modInArea, token: modInToken } = await seedUser({
    name: 'Mod InArea 62',
    email: 'mod.inarea62@example.com',
    phone: '+15555560301',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modOutArea, token: modOutToken } = await seedUser({
    name: 'Mod OutOfArea 62',
    email: 'mod.outarea62@example.com',
    phone: '+15555560302',
    role: 'MODERATOR',
    areaId: outAreaId,
  });
  const { doc: modNoArea, token: modNoToken } = await seedUser({
    name: 'Mod NoArea 62',
    email: 'mod.noarea62@example.com',
    phone: '+15555560303',
    role: 'MODERATOR',
    areaId: null,
  });
  const { doc: admin, token: adminToken } = await seedUser({
    name: 'Admin 62',
    email: 'admin62@example.com',
    phone: '+15555560401',
    role: 'ADMIN',
    areaId: null,
  });

  assert(unverifiedVol && verifiedVol && outVol, '3 volunteers seeded');
  assert(
    modInArea && modOutArea && modNoArea && admin,
    '3 moderators + 1 admin seeded'
  );
  assert(alice.role === 'OWNER', 'alice seeded as OWNER (role-gate target)');

  // ── 2. Auth gates ───────────────────────────────────────────────────
  section('2. auth gates');

  const noToken = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`
  );
  assert(noToken.status === 401, 'POST without token → 401');

  const ownerAttempt = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: aliceToken }
  );
  assert(ownerAttempt.status === 403, 'POST with OWNER token → 403');

  const volunteerAttempt = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: unverifiedVolToken }
  );
  assert(volunteerAttempt.status === 403, 'POST with VOLUNTEER token → 403');

  // ── 3. Happy path ───────────────────────────────────────────────────
  section('3. happy path — ModInArea verifies in-area unverified volunteer');

  const happy = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken }
  );
  assert(happy.status === 200, 'POST returns 200');
  assert(happy.body?.success === true, 'response.success === true');
  assert(
    happy.body?.message === 'Volunteer verified',
    'response.message === "Volunteer verified"'
  );

  const happyUser = happy.body?.data?.user;
  assert(happyUser, 'response.data.user present');
  assert(happyUser.id, 'response.data.user.id present');
  assert(
    happyUser.name === 'Ivy Volunteer 62',
    'response.data.user.name === "Ivy Volunteer 62"'
  );
  assert(
    happyUser.role === 'VOLUNTEER',
    'response.data.user.role === "VOLUNTEER"'
  );
  assert(
    happyUser.isVerified === true,
    'response.data.user.isVerified === true (was false, now true)'
  );
  assert(
    happyUser.isActive === true,
    'response.data.user.isActive === true'
  );
  assert(
    happyUser.areaId === inAreaId.toString(),
    'response.data.user.areaId matches in-area'
  );
  assert(
    happyUser.createdAt && happyUser.updatedAt,
    'response.data.user has createdAt + updatedAt'
  );
  assert(!happyUser.password, 'response.data.user has NO password');
  assert(
    !hasContactLeak(happyUser),
    'response.data.user has NO email/phone/password leak'
  );

  // Verify the DB was actually updated.
  const dbUser = await User.findById(unverifiedVol._id);
  assert(
    dbUser.isVerified === true,
    'DB: User.isVerified persisted as true'
  );

  // ── 4. Idempotency ──────────────────────────────────────────────────
  section('4. idempotency — second POST on already-verified is a no-op');

  const second = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${verifiedVol._id.toString()}`,
    { token: modInToken }
  );
  assert(second.status === 200, 'second POST on already-verified → 200');
  assert(
    second.body?.data?.user?.isVerified === true,
    'second POST response still has isVerified=true'
  );
  assert(
    !hasContactLeak(second.body),
    'second POST response has NO email/phone/password leak'
  );

  // The same user was already verified before the POST. Check that
  // updatedAt did NOT move forward (no-op).
  const before = verifiedVol.updatedAt;
  // Re-trigger verify on the same user, then check updatedAt didn't
  // bump. (We need to compare after a small wait because mongoose
  // would otherwise write on save.)
  await new Promise((r) => setTimeout(r, 50));
  await http_(
    'POST',
    `/api/moderator/verify-volunteer/${verifiedVol._id.toString()}`,
    { token: modInToken }
  );
  const after = await User.findById(verifiedVol._id);
  assert(
    after.updatedAt.getTime() === before.getTime(),
    'idempotent: no DB write (updatedAt unchanged)'
  );

  // ── 5. Role gate ────────────────────────────────────────────────────
  section('5. role gate — verifying a non-VOLUNTEER is rejected');

  const roleGate = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${alice._id.toString()}`,
    { token: modInToken }
  );
  assert(roleGate.status === 400, 'verifying OWNER → 400');
  assert(
    typeof roleGate.body?.message === 'string' &&
      roleGate.body.message.toLowerCase().includes('volunteer'),
    '400 message mentions VOLUNTEER role'
  );
  assert(
    !hasContactLeak(roleGate.body),
    '400 error body has NO email/phone/password leak'
  );

  // ── 6. Cross-area 403 ──────────────────────────────────────────────
  section('6. cross-area 403 — ModInArea cannot verify out-of-area volunteer');

  const crossArea = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${outVol._id.toString()}`,
    { token: modInToken }
  );
  assert(crossArea.status === 403, 'cross-area POST → 403');
  assert(
    typeof crossArea.body?.message === 'string' &&
      crossArea.body.message.toLowerCase().includes('area'),
    '403 message mentions "area"'
  );

  // Out-of-area volunteer should remain unverified.
  const outDb = await User.findById(outVol._id);
  assert(
    outDb.isVerified === false,
    'cross-area attempt did NOT persist (outVol still unverified)'
  );

  // ── 7. No-area 403 ──────────────────────────────────────────────────
  section('7. no-area 403 — ModNoArea cannot verify anyone');

  const noAreaAttempt = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modNoToken }
  );
  assert(noAreaAttempt.status === 403, 'no-area POST → 403');
  assert(
    typeof noAreaAttempt.body?.message === 'string' &&
      noAreaAttempt.body.message
        .toLowerCase()
        .includes('assigned to an area'),
    '403 message mentions "assigned to an area"'
  );

  // ── 8. Admin cross-scope bypass ────────────────────────────────────
  section('8. admin cross-scope — ADMIN verifies out-of-area volunteer');

  const adminVerify = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${outVol._id.toString()}`,
    { token: adminToken }
  );
  assert(adminVerify.status === 200, 'ADMIN verifying out-of-area → 200');
  assert(
    adminVerify.body?.data?.user?.isVerified === true,
    'ADMIN verify response has isVerified=true'
  );
  assert(
    !hasContactLeak(adminVerify.body),
    'ADMIN verify response has NO email/phone/password leak'
  );

  const outDbAdmin = await User.findById(outVol._id);
  assert(
    outDbAdmin.isVerified === true,
    'DB: outVol.isVerified persisted as true after admin verify'
  );

  // ── 9. Not-found 404 ───────────────────────────────────────────────
  section('9. not-found 404 — bogus ObjectId returns 404');

  // Use a valid-looking but non-existent ObjectId.
  const bogusId = '507f1f77bcf86cd799439011';
  const notFound = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${bogusId}`,
    { token: modInToken }
  );
  assert(notFound.status === 404, 'bogus ObjectId → 404');

  // ── 10. Validator strictness ────────────────────────────────────────
  section('10. validator strictness');

  // Malformed :userId (non-ObjectId) → 400 (params regex).
  const badId = await http_(
    'POST',
    `/api/moderator/verify-volunteer/not-an-objectid`,
    { token: modInToken }
  );
  assert(badId.status === 400, 'malformed :userId → 400');

  // Unknown body key → 400 (strict mode).
  const unknownKey = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken, body: { foo: 'bar' } }
  );
  assert(unknownKey.status === 400, 'unknown body key → 400');

  // moderatorNote > 1000 chars → 400.
  const tooLong = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken, body: { moderatorNote: 'x'.repeat(1001) } }
  );
  assert(tooLong.status === 400, 'moderatorNote > 1000 chars → 400');

  // moderatorNote at the boundary (1000 chars) is accepted (200).
  const okNote = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken, body: { moderatorNote: 'y'.repeat(1000) } }
  );
  assert(okNote.status === 200, 'moderatorNote at 1000 chars accepted → 200');

  // moderatorNote with valid short string accepted.
  const shortNote = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken, body: { moderatorNote: 'looks good' } }
  );
  assert(
    shortNote.status === 200,
    'moderatorNote with valid short string accepted → 200'
  );

  // ── 11. Privacy regression ──────────────────────────────────────────
  section('11. privacy regression — full body never leaks contact info');

  const finalCheck = await http_(
    'POST',
    `/api/moderator/verify-volunteer/${unverifiedVol._id.toString()}`,
    { token: modInToken }
  );
  assert(
    !hasContactLeak(finalCheck.body),
    'final POST response has NO email/phone/password leak anywhere'
  );

  await stop();
  console.log('\nALL ASSERTIONS PASSED');
}

run().catch(async (err) => {
  console.error('\nFATAL:', err);
  await stop();
  process.exit(1);
});
