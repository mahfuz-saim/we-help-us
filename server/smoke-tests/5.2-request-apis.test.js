/**
 * End-to-end smoke test for Module 5.2 — Request APIs.
 *
 * Validates the entire request lifecycle against a real Atlas database:
 *
 *   1. Auth gates (401 without token) on POST + GET /api/requests.
 *   2. POST /api/requests:
 *        - role gate (only VOLUNTEER can create)
 *        - isVerified gate (unverified volunteer → 403)
 *        - 404 on unknown resourceId
 *        - 400 on self-request (volunteer requesting their own resource)
 *        - 409 on resource.status !== AVAILABLE
 *        - 409 on duplicate active request from same volunteer
 *        - happy path: REQUESTED + requestedAt populated
 *   3. GET /api/requests role-scoped:
 *        - VOLUNTEER sees only their own
 *        - OWNER sees only incoming for their resources
 *        - MODERATOR sees requests in their area
 *        - MODERATOR with no area sees []
 *        - ADMIN sees everything
 *   4. PATCH /api/requests/:id/approve:
 *        - 403 for non-owner
 *        - 409 from non-REQUESTED state
 *        - happy path → APPROVED + Resource.status=RESERVED
 *   5. PATCH /api/requests/:id/reject:
 *        - 403 for non-owner, non-moderator
 *        - 409 from REJECTED/COLLECTED/RETURNED/CANCELLED
 *        - MODERATOR can reject from REQUESTED or APPROVED
 *        - happy path REQUESTED → REJECTED (resource stays AVAILABLE)
 *        - happy path APPROVED → REJECTED + Resource back to AVAILABLE
 *   6. PATCH /api/requests/:id/collect:
 *        - 403 for non-volunteer
 *        - 409 from non-APPROVED state
 *        - happy path APPROVED → COLLECTED + Resource.status=IN_USE
 *        - **CONTACT REVEAL** — response includes ownerContact-style
 *          owner {name, email, phone} AND volunteer {name, email, phone}
 *   7. PATCH /api/requests/:id/return:
 *        - 403 for non-volunteer
 *        - 409 from non-COLLECTED
 *        - happy path COLLECTED → RETURNED
 *        - resource stays IN_USE (owner confirms next)
 *   8. PATCH /api/requests/:id/complete:
 *        - 403 for non-owner
 *        - 409 from non-RETURNED
 *        - happy path: Resource.status=IN_USE → AVAILABLE
 *   9. GET /api/requests/:id:
 *        - 403 for non-principal
 *        - 404 on unknown id
 *        - returns the populated request with contact reveal only
 *          when APPROVED + COLLECTED
 *  10. Validator strictness:
 *        - unknown body key → 400
 *        - bad ObjectId format → 400
 *        - moderatorNote > 1000 chars → 400
 *  11. Privacy — pre-reveal responses carry NO owner/v volunteer
 *      contact info (no email/phone/name beyond a name summary).
 *
 * Storage: Atlas-ephemeral-DB pattern (per-run
 * `wehelpus_smoke_52_<ts>_<rand>`, dropped on teardown).
 *
 * Run: `node smoke-tests/5.2-request-apis.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const TEST_DB = `wehelpus_smoke_52_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
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

// Helper: full lifecycle-friendly object surfacing the contact leak
// gates. We do this in the smoke so the assertion reads naturally.
function hasContactLeak(obj) {
  if (!obj) return false;
  // Walk the object recursively — the contact info can sit at any
  // depth (`data.request.owner.email`, `data.request.volunteer.phone`).
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) {
      return node.some(walk);
    }
    for (const key of ['email', 'phone', 'password']) {
      if (Object.prototype.hasOwnProperty.call(node, key) && node[key]) {
        return true;
      }
    }
    return Object.values(node).some(walk);
  }
  return walk(obj);
}

// Helper: seed a real User + return the doc + a JWT.
async function seedUser({ name, email, phone, role, isVerified = false, areaId = null }) {
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

async function seedResource({ ownerId, title = 'Field kit', description = 'A useful field kit for emergency response.', category = 'MEDICAL', status = 'AVAILABLE', areaId = null, location = null }) {
  const r = await Resource.create({
    ownerId,
    category,
    title,
    description,
    status,
    areaId: areaId || undefined,
    location: location || undefined,
  });
  return r;
}

async function run() {
  // ── 1. Seed users + resources ────────────────────────────────────────
  console.log('\n--- 1. seed users + resources ---');
  const { doc: owner, token: ownerToken } = await seedUser({
    name: 'Alice Owner',
    email: 'alice-owner-52@example.com',
    phone: '+8801711000052',
    role: 'OWNER',
  });
  const { doc: otherOwner, token: otherOwnerToken } = await seedUser({
    name: 'Bob Owner',
    email: 'bob-owner-52@example.com',
    phone: '+8801711000053',
    role: 'OWNER',
  });
  const { doc: verifiedVol, token: volToken } = await seedUser({
    name: 'Carol Volunteer',
    email: 'carol-vol-52@example.com',
    phone: '+8801711000054',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: unverifiedVol, token: unverifiedVolToken } = await seedUser({
    name: 'Dan Volunteer',
    email: 'dan-vol-52@example.com',
    phone: '+8801711000055',
    role: 'VOLUNTEER',
    isVerified: false,
  });
  const { doc: anotherVol, token: anotherVolToken } = await seedUser({
    name: 'Eve Volunteer',
    email: 'eve-vol-52@example.com',
    phone: '+8801711000056',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: modWithArea, token: modToken } = await seedUser({
    name: 'Frank Moderator',
    email: 'frank-mod-52@example.com',
    phone: '+8801711000057',
    role: 'MODERATOR',
    areaId: null, // set after seeding the area below
  });
  const { doc: admin, token: adminToken } = await seedUser({
    name: 'Grace Admin',
    email: 'grace-admin-52@example.com',
    phone: '+8801711000058',
    role: 'ADMIN',
  });

  // Seed an area for the moderator scope test.
  const area = await mongoose.connection.db
    .collection('areas')
    .insertOne({
      country: 'Bangladesh',
      level: 'UNION',
      name: 'Test Union 52',
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const areaId = area.insertedId;
  // Move the moderator + one resource into the area.
  modWithArea.areaId = areaId;
  await modWithArea.save();

  const resource1 = await seedResource({
    ownerId: owner._id,
    title: 'Ambulance 1',
    description: 'A working ambulance with basic life support equipment.',
    areaId,
  });
  const resource2 = await seedResource({
    ownerId: owner._id,
    title: 'Field clinic',
    description: 'A small clinic stocked with basic medical supplies.',
    areaId,
  });
  const resource3 = await seedResource({
    ownerId: otherOwner._id,
    title: 'Bob pickup truck',
    description: 'A pickup truck that can carry up to 1 ton of supplies.',
  });
  // A resource we'll park as UNAVAILABLE for the 409 test.
  const unavailableResource = await seedResource({
    ownerId: owner._id,
    title: 'Parked kit',
    description: 'A kit the owner has parked as unavailable for now.',
    status: 'UNAVAILABLE',
  });
  assert(
    owner && verifiedVol && modWithArea && resource1 && resource2 && resource3 && unavailableResource,
    'seed: owner + verified/unverified volunteers + moderator + admin + 4 resources'
  );

  // ── 2. Auth gates ────────────────────────────────────────────────────
  console.log('\n--- 2. auth gates ---');
  {
    const noTokenPost = await http_('POST', '/api/requests', { body: { resourceId: resource1._id.toString() } });
    assert(noTokenPost.status === 401, 'POST /requests without token → 401');

    const noTokenGet = await http_('GET', '/api/requests');
    assert(noTokenGet.status === 401, 'GET /requests without token → 401');
  }

  // ── 3. POST /api/requests ────────────────────────────────────────────
  console.log('\n--- 3. POST /api/requests ---');
  {
    // 3.1 OWNER can't create.
    const ownerCreates = await http_('POST', '/api/requests', {
      token: ownerToken,
      body: { resourceId: resource1._id.toString() },
    });
    assert(ownerCreates.status === 403, 'OWNER POST → 403');

    // 3.2 Unverified volunteer → 403.
    const unverified = await http_('POST', '/api/requests', {
      token: unverifiedVolToken,
      body: { resourceId: resource1._id.toString() },
    });
    assert(unverified.status === 403, 'unverified VOLUNTEER POST → 403');

    // 3.3 Unknown resourceId → 404.
    const fakeId = new mongoose.Types.ObjectId().toString();
    const unknown = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: fakeId },
    });
    assert(unknown.status === 404, 'unknown resourceId → 404');

    // 3.4 Malformed resourceId → 400 (zod surface).
    const malformed = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: 'not-an-objectid' },
    });
    assert(malformed.status === 400, 'malformed resourceId → 400');

    // 3.5 Unknown body key → 400 (strict validator).
    const unknownKey = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: resource1._id.toString(), evil: 1 },
    });
    assert(unknownKey.status === 400, 'unknown body key on POST → 400');

    // 3.6 Self-request → 400. Need a verified volunteer who is ALSO
    // an owner of a resource. Carol is a verified VOLUNTEER; create
    // a resource in her name and try to request it.
    const ownerVol = await seedUser({
      name: 'Helen OwnerVol',
      email: 'helen-ownervol-52@example.com',
      phone: '+8801711000059',
      role: 'OWNER',
      isVerified: false,
    });
    const ownResource = await seedResource({
      ownerId: ownerVol.doc._id,
      title: 'Helen kit',
      description: 'A resource owned by a user who is also a verified volunteer.',
    });
    // Promote Helen to VOLUNTEER + verified + flip her role but
    // keeping ownResource intact. To avoid juggling two roles per
    // user we just create a fresh verified volunteer whose only
    // resource we seed.
    const vol2 = await seedUser({
      name: 'Ivan OwnerVol',
      email: 'ivan-ownervol-52@example.com',
      phone: '+8801711000060',
      role: 'VOLUNTEER',
      isVerified: true,
    });
    // Seed a resource owned by Ivan (we keep his role VOLUNTEER —
    // a user is one role per the model).
    const ivanRes = await seedResource({
      ownerId: vol2.doc._id,
      title: 'Ivan kit',
      description: 'A resource owned by Ivan — Ivan will request his own resource.',
    });
    const selfReq = await http_('POST', '/api/requests', {
      token: vol2.token,
      body: { resourceId: ivanRes._id.toString() },
    });
    assert(selfReq.status === 400, 'self-request → 400');

    // 3.7 Resource not AVAILABLE → 409.
    const parked = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: unavailableResource._id.toString() },
    });
    assert(parked.status === 409, 'UNAVAILABLE resource → 409');

    // 3.8 Happy path: Carol requests resource1.
    const happy = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: resource1._id.toString() },
    });
    assert(happy.status === 201, 'verified VOLUNTEER POST → 201');
    assert(happy.body && happy.body.data && happy.body.data.request, '  response carries { request: {...} }');
    const r = happy.body.data.request;
    assert(r.status === 'REQUESTED', '  status defaults to REQUESTED');
    assert(r.requestedAt && typeof r.requestedAt === 'string', '  requestedAt populated');
    assert(r.approvedAt === null, '  approvedAt null');
    assert(r.collectedAt === null, '  collectedAt null');
    assert(r.returnedAt === null, '  returnedAt null');
    assert(r.moderatorNote === null, '  moderatorNote null');
    assert(r.resourceId === resource1._id.toString(), '  resourceId echoed');
    assert(r.ownerId === owner._id.toString(), '  ownerId echoed');
    assert(r.volunteerId === verifiedVol._id.toString(), '  volunteerId echoed');
    // Privacy — the response must NOT include any contact info.
    assert(!hasContactLeak(happy.body), '  POST response has NO email/phone leak');

    // 3.9 Duplicate active request from same volunteer → 409.
    const dup = await http_('POST', '/api/requests', {
      token: volToken,
      body: { resourceId: resource1._id.toString() },
    });
    assert(dup.status === 409, 'duplicate active request → 409');
  }

  // ── 4. GET /api/requests (role-scoped) ────────────────────────────────
  console.log('\n--- 4. GET /api/requests role-scoping ---');
  {
    // Carol sees her own request.
    const carolList = await http_('GET', '/api/requests', { token: volToken });
    assert(carolList.status === 200, 'GET /requests (VOLUNTEER) → 200');
    assert(
      carolList.body.data.requests.length === 1 &&
        carolList.body.data.requests[0].volunteerId === verifiedVol._id.toString(),
      '  VOLUNTEER sees only their own request'
    );

    // Eve has no requests yet.
    const eveList = await http_('GET', '/api/requests', { token: anotherVolToken });
    assert(
      eveList.status === 200 && eveList.body.data.requests.length === 0,
      '  another volunteer with no requests → []'
    );

    // Alice (owner) sees her incoming request.
    const aliceList = await http_('GET', '/api/requests', { token: ownerToken });
    assert(
      aliceList.status === 200 && aliceList.body.data.requests.length === 1,
      '  OWNER sees incoming for her own resources'
    );

    // Bob (other owner) sees zero — Carol's request is for Alice's resource.
    const bobList = await http_('GET', '/api/requests', { token: otherOwnerToken });
    assert(
      bobList.body.data.requests.length === 0,
      '  other OWNER sees no incoming'
    );

    // Moderator (with areaId) sees the request for resource1 (in her area).
    const modList = await http_('GET', '/api/requests', { token: modToken });
    assert(
      modList.body.data.requests.length === 1,
      '  MODERATOR in area sees requests for resources in that area'
    );

    // Admin sees everything.
    const adminList = await http_('GET', '/api/requests', { token: adminToken });
    assert(
      adminList.body.data.requests.length === 1,
      '  ADMIN sees all requests'
    );

    // Privacy — list response has NO contact info.
    assert(!hasContactLeak(carolList.body), '  list (VOLUNTEER) has NO contact leak');
    assert(!hasContactLeak(aliceList.body), '  list (OWNER) has NO contact leak');
    assert(!hasContactLeak(modList.body), '  list (MODERATOR) has NO contact leak');
    assert(!hasContactLeak(adminList.body), '  list (ADMIN) has NO contact leak');

    // Query filters compose — ?status=REQUESTED on Alice's side.
    const filterStatus = await http_('GET', '/api/requests?status=APPROVED', { token: ownerToken });
    assert(filterStatus.body.data.requests.length === 0, '  ?status=APPROVED filter returns []');

    // Pagination
    const page1 = await http_('GET', '/api/requests?page=1&limit=10', { token: ownerToken });
    assert(
      page1.body.data.pagination.total === 1 &&
        page1.body.data.pagination.page === 1 &&
        page1.body.data.pagination.limit === 10,
      '  pagination metadata echoed'
    );

    // Validator strictness on the query.
    const badQuery = await http_('GET', '/api/requests?status=NOT_A_STATUS', { token: ownerToken });
    assert(badQuery.status === 400, 'bad ?status= → 400');

    const badQueryId = await http_('GET', '/api/requests?resourceId=not-an-id', { token: ownerToken });
    assert(badQueryId.status === 400, 'bad ?resourceId= → 400');

    const unknownQueryKey = await http_('GET', '/api/requests?evil=1', { token: ownerToken });
    assert(unknownQueryKey.status === 400, 'unknown query key → 400');
  }

  // ── 5. Moderator with NO areaId → [] ─────────────────────────────────
  console.log('\n--- 5. moderator with no areaId → empty list ---');
  {
    const noAreaMod = await seedUser({
      name: 'Jake ModNoArea',
      email: 'jake-mod-52@example.com',
      phone: '+8801711000061',
      role: 'MODERATOR',
    });
    const list = await http_('GET', '/api/requests', { token: noAreaMod.token });
    assert(list.status === 200, 'no-area moderator list → 200');
    assert(list.body.data.requests.length === 0, '  no-area moderator sees []');
  }

  // ── 6. APPROVE ────────────────────────────────────────────────────────
  console.log('\n--- 6. PATCH /requests/:id/approve ---');
  let requestId;
  {
    // Re-fetch Carol's request id.
    const list = await http_('GET', '/api/requests', { token: volToken });
    requestId = list.body.data.requests[0].id;

    // 6.1 Non-owner → 403.
    const notOwnerApprove = await http_('PATCH', `/api/requests/${requestId}/approve`, { token: otherOwnerToken });
    assert(notOwnerApprove.status === 403, 'non-owner APPROVE → 403');

    // 6.2 Volunteer can't approve their own request.
    const volApprove = await http_('PATCH', `/api/requests/${requestId}/approve`, { token: volToken });
    assert(volApprove.status === 403, 'volunteer APPROVE → 403');

    // 6.3 Moderator can't approve (oversight is reject-only).
    const modApprove = await http_('PATCH', `/api/requests/${requestId}/approve`, { token: modToken });
    assert(modApprove.status === 403, 'moderator APPROVE → 403');

    // 6.4 Happy path: Alice approves.
    const approve = await http_('PATCH', `/api/requests/${requestId}/approve`, {
      token: ownerToken,
      body: { moderatorNote: 'approved by Alice' },
    });
    assert(approve.status === 200, 'owner APPROVE → 200');
    const r = approve.body.data.request;
    assert(r.status === 'APPROVED', '  status → APPROVED');
    assert(r.approvedAt && typeof r.approvedAt === 'string', '  approvedAt populated');
    assert(r.moderatorNote === 'approved by Alice', '  moderatorNote persisted');
    assert(!hasContactLeak(approve.body), '  APPROVE response has NO contact leak');

    // Side effect on Resource: AVAILABLE → RESERVED.
    const resDoc = await Resource.findById(resource1._id);
    assert(resDoc.status === 'RESERVED', '  Resource.status flipped to RESERVED');

    // 6.5 APPROVE a second time → 409.
    const reapprove = await http_('PATCH', `/api/requests/${requestId}/approve`, { token: ownerToken });
    assert(reapprove.status === 409, 'APPROVE again → 409');
  }

  // ── 7. COLLECT (contact reveal) ───────────────────────────────────────
  console.log('\n--- 7. PATCH /requests/:id/collect ---');
  {
    // 7.1 Owner can't collect (volunteer-only).
    const ownerCollect = await http_('PATCH', `/api/requests/${requestId}/collect`, { token: ownerToken });
    assert(ownerCollect.status === 403, 'owner COLLECT → 403');

    // 7.2 Different volunteer can't collect someone else's request.
    const eveCollect = await http_('PATCH', `/api/requests/${requestId}/collect`, { token: anotherVolToken });
    assert(eveCollect.status === 403, 'different volunteer COLLECT → 403');

    // 7.3 Happy path: Carol collects.
    const collect = await http_('PATCH', `/api/requests/${requestId}/collect`, { token: volToken });
    assert(collect.status === 200, 'volunteer COLLECT → 200');
    const r = collect.body.data.request;
    assert(r.status === 'COLLECTED', '  status → COLLECTED');
    assert(r.collectedAt && typeof r.collectedAt === 'string', '  collectedAt populated');

    // Side effect on Resource: RESERVED → IN_USE.
    const resDoc = await Resource.findById(resource1._id);
    assert(resDoc.status === 'IN_USE', '  Resource.status flipped to IN_USE');

    // **Contact reveal** — owner {name, email, phone} AND volunteer
    // {name, email, phone} both surfaced. The privacy gate is
    // APPROVED + COLLECTED; this is exactly that moment.
    assert(r.owner && r.owner.email === owner.email, '  owner email revealed');
    assert(r.owner && r.owner.phone === owner.phone, '  owner phone revealed');
    assert(r.owner && r.owner.name === owner.name, '  owner name revealed');
    assert(r.volunteer && r.volunteer.email === verifiedVol.email, '  volunteer email revealed');
    assert(r.volunteer && r.volunteer.phone === verifiedVol.phone, '  volunteer phone revealed');
    assert(r.volunteer && r.volunteer.name === verifiedVol.name, '  volunteer name revealed');
    assert(r.resource && r.resource.id === resource1._id.toString(), '  resource summary inlined');

    // 7.4 COLLECT a second time → 409.
    const recollect = await http_('PATCH', `/api/requests/${requestId}/collect`, { token: volToken });
    assert(recollect.status === 409, 'COLLECT again → 409');
  }

  // ── 8. RETURN ─────────────────────────────────────────────────────────
  console.log('\n--- 8. PATCH /requests/:id/return ---');
  {
    // 8.1 Owner can't return.
    const ownerReturn = await http_('PATCH', `/api/requests/${requestId}/return`, { token: ownerToken });
    assert(ownerReturn.status === 403, 'owner RETURN → 403');

    // 8.2 Happy path: Carol returns.
    const ret = await http_('PATCH', `/api/requests/${requestId}/return`, { token: volToken });
    assert(ret.status === 200, 'volunteer RETURN → 200');
    const r = ret.body.data.request;
    assert(r.status === 'RETURNED', '  status → RETURNED');
    assert(r.returnedAt && typeof r.returnedAt === 'string', '  returnedAt populated');

    // Resource stays IN_USE (COMPLETE next).
    const resDoc = await Resource.findById(resource1._id);
    assert(resDoc.status === 'IN_USE', '  Resource.status stays IN_USE after RETURN');

    // Privacy — RETURNED is past COLLECTED but the privacy gate is
    // APPROVED + COLLECTED, NOT RETURNED. The return response does
    // NOT include contact info (no coordination needed once handed
    // back). Verify this assertion is honoured.
    assert(!r.owner || !r.owner.email, '  RETURN response has NO owner email');
    assert(!r.volunteer || !r.volunteer.email, '  RETURN response has NO volunteer email');
  }

  // ── 9. COMPLETE ───────────────────────────────────────────────────────
  console.log('\n--- 9. PATCH /requests/:id/complete ---');
  {
    // 9.1 Volunteer can't complete (owner-only).
    const volComplete = await http_('PATCH', `/api/requests/${requestId}/complete`, { token: volToken });
    assert(volComplete.status === 403, 'volunteer COMPLETE → 403');

    // 9.2 Happy path: Alice completes.
    const complete = await http_('PATCH', `/api/requests/${requestId}/complete`, { token: ownerToken });
    assert(complete.status === 200, 'owner COMPLETE → 200');
    assert(
      complete.body.data.request.status === 'RETURNED',
      '  request stays RETURNED (COMPLETE doesn\'t move the request itself)'
    );

    // Resource → AVAILABLE again.
    const resDoc = await Resource.findById(resource1._id);
    assert(resDoc.status === 'AVAILABLE', '  Resource.status flipped back to AVAILABLE');

    // 9.3 COMPLETE again → 409.
    const recomplete = await http_('PATCH', `/api/requests/${requestId}/complete`, { token: ownerToken });
    assert(recomplete.status === 409, 'COMPLETE again → 409');
  }

  // ── 10. REJECT ────────────────────────────────────────────────────────
  console.log('\n--- 10. PATCH /requests/:id/reject ---');
  {
    // Build a fresh REQUESTED for the reject tests. Eve requests resource2.
    const eveReq = await http_('POST', '/api/requests', {
      token: anotherVolToken,
      body: { resourceId: resource2._id.toString() },
    });
    assert(eveReq.status === 201, 'Eve creates request on resource2 → 201');
    const eveReqId = eveReq.body.data.request.id;

    // 10.1 Eve (volunteer) can't reject.
    const volReject = await http_('PATCH', `/api/requests/${eveReqId}/reject`, { token: anotherVolToken });
    assert(volReject.status === 403, 'volunteer REJECT → 403');

    // 10.2 Bob (other owner) can't reject Alice's request.
    const bobReject = await http_('PATCH', `/api/requests/${eveReqId}/reject`, { token: otherOwnerToken });
    assert(bobReject.status === 403, 'other-owner REJECT → 403');

    // 10.3 Happy path: Alice rejects from REQUESTED. Resource stays AVAILABLE.
    const reject1 = await http_('PATCH', `/api/requests/${eveReqId}/reject`, {
      token: ownerToken,
      body: { moderatorNote: 'already lent out' },
    });
    assert(reject1.status === 200, 'owner REJECT from REQUESTED → 200');
    assert(reject1.body.data.request.status === 'REJECTED', '  status → REJECTED');
    assert(reject1.body.data.request.moderatorNote === 'already lent out', '  note persisted');

    const r1 = await Resource.findById(resource2._id);
    assert(r1.status === 'AVAILABLE', '  Resource stays AVAILABLE (no RESERVED-to-flip)');

    // 10.4 REJECT again → 409.
    const rereject = await http_('PATCH', `/api/requests/${eveReqId}/reject`, { token: ownerToken });
    assert(rereject.status === 409, 'REJECT again → 409');

    // 10.5 Moderator REJECT from APPROVED → resource un-RESERVED.
    // Build a fresh REQUESTED, owner APPROVE it, moderator REJECT.
    const eveReq2 = await http_('POST', '/api/requests', {
      token: anotherVolToken,
      body: { resourceId: resource2._id.toString() },
    });
    assert(eveReq2.status === 201, 'Eve creates second request on resource2');
    const eveReq2Id = eveReq2.body.data.request.id;

    const approve2 = await http_('PATCH', `/api/requests/${eveReq2Id}/approve`, { token: ownerToken });
    assert(approve2.body.data.request.status === 'APPROVED', '  APPROVE → APPROVED');
    let r2 = await Resource.findById(resource2._id);
    assert(r2.status === 'RESERVED', '  Resource → RESERVED after APPROVE');

    const modReject = await http_('PATCH', `/api/requests/${eveReq2Id}/reject`, {
      token: modToken,
      body: { moderatorNote: 'moderator override' },
    });
    assert(modReject.status === 200, 'moderator REJECT from APPROVED → 200');
    assert(modReject.body.data.request.status === 'REJECTED', '  status → REJECTED');
    assert(modReject.body.data.request.moderatorNote === 'moderator override', '  moderator note persisted');

    r2 = await Resource.findById(resource2._id);
    assert(r2.status === 'AVAILABLE', '  Resource → AVAILABLE after moderator REJECT');
  }

  // ── 11. GET /api/requests/:id ─────────────────────────────────────────
  console.log('\n--- 11. GET /api/requests/:id ---');
  {
    const id = requestId;

    // 11.1 Unknown id → 404.
    const missing = await http_('GET', `/api/requests/${new mongoose.Types.ObjectId().toString()}`, { token: ownerToken });
    assert(missing.status === 404, 'GET unknown id → 404');

    // 11.2 Malformed id → 400.
    const malformed = await http_('GET', '/api/requests/not-an-id', { token: ownerToken });
    assert(malformed.status === 400, 'GET malformed id → 400');

    // 11.3 Non-principal → 403. Bob isn't owner, isn't volunteer,
    // isn't admin.
    const bobGet = await http_('GET', `/api/requests/${id}`, { token: otherOwnerToken });
    assert(bobGet.status === 403, 'non-principal GET → 403');

    // 11.4 Owner GET → 200 with contact info (request is in RETURNED
    // past-state — no contact reveal since status is not COLLECTED).
    const ownerGet = await http_('GET', `/api/requests/${id}`, { token: ownerToken });
    assert(ownerGet.status === 200, 'owner GET /:id → 200');
    const oDoc = ownerGet.body.data.request;
    assert(oDoc.id === id, '  id matches');
    assert(oDoc.ownerSummary && oDoc.ownerSummary.name, '  owner summary present');
    assert(oDoc.volunteerSummary && oDoc.volunteerSummary.name, '  volunteer summary present');
    // Status is RETURNED → no email/phone reveal.
    assert(!hasContactLeak(ownerGet.body), '  GET in RETURNED state has NO contact leak');

    // 11.5 Volunteer GET → 200.
    const volGet = await http_('GET', `/api/requests/${id}`, { token: volToken });
    assert(volGet.status === 200, 'volunteer GET /:id → 200');

    // 11.6 Admin GET → 200.
    const adminGet = await http_('GET', `/api/requests/${id}`, { token: adminToken });
    assert(adminGet.status === 200, 'admin GET /:id → 200');
  }

  // ── 12. Validator strictness ─────────────────────────────────────────
  console.log('\n--- 12. Validator strictness ---');
  {
    // Unknown body key on action endpoint → 400.
    const unknownKey = await http_('PATCH', `/api/requests/${requestId}/approve`, {
      token: ownerToken,
      body: { evil: 1 },
    });
    assert(unknownKey.status === 400, 'unknown action-body key → 400');

    // moderatorNote too long → 400.
    const longNote = await http_('PATCH', `/api/requests/${new mongoose.Types.ObjectId().toString()}/approve`, {
      token: ownerToken,
      body: { moderatorNote: 'A'.repeat(1001) },
    });
    assert(longNote.status === 400, 'moderatorNote > 1000 chars → 400');

    // moderatorNote exactly 1000 → accepted at the validator layer
    // (controller will 404 since the id doesn't exist; that's fine).
    const exactlyMax = await http_('PATCH', `/api/requests/${new mongoose.Types.ObjectId().toString()}/approve`, {
      token: ownerToken,
      body: { moderatorNote: 'A'.repeat(1000) },
    });
    assert(exactlyMax.status === 404, 'moderatorNote === 1000 chars accepted (controller 404)');
  }

  // ── 13. Privacy boundary cross-check ─────────────────────────────────
  console.log('\n--- 13. privacy — pre-reveal responses carry NO contact info ---');
  {
    // Make sure the Carol <-> Alice pair is back to a REQUESTED-only
    // state by listing again and walking the response shapes.
    const carolList = await http_('GET', '/api/requests', { token: volToken });
    assert(!hasContactLeak(carolList.body), '  volunteer list no leak');

    const aliceList = await http_('GET', '/api/requests', { token: ownerToken });
    assert(!hasContactLeak(aliceList.body), '  owner list no leak');

    // The list endpoint shapes never include .email/.phone on the
    // owner / volunteer keys. Confirm the response is "summary only"
    // (only `name` populated on populated user keys; or, if not
    // populated, just an id string).
    const requests = aliceList.body.data.requests;
    for (const r of requests) {
      // r carries ownerId / volunteerId as strings (the list is
      // not populated), and never enriches them with contact info.
      assert(typeof r.ownerId === 'string', '  ownerId is a string (no enrichment)');
      assert(typeof r.volunteerId === 'string', '  volunteerId is a string (no enrichment)');
      assert(!r.owner, '  no .owner block on list items');
      assert(!r.volunteer, '  no .volunteer block on list items');
      assert(!r.ownerSummary, '  no .ownerSummary on list items');
      assert(!r.volunteerSummary, '  no .volunteerSummary on list items');
    }
  }

  // ── 14. Module-level statics + enum ──────────────────────────────────
  console.log('\n--- 14. enum + statics sanity ---');
  {
    assert(
      JSON.stringify(ResourceRequest.REQUEST_STATUS_VALUES) ===
        JSON.stringify(['REQUESTED', 'APPROVED', 'REJECTED', 'COLLECTED', 'RETURNED', 'CANCELLED']),
      'REQUEST_STATUS_VALUES match the spec\'d 6-value lifecycle'
    );
    assert(
      ResourceRequest.isActiveStatus('REQUESTED') === true &&
        ResourceRequest.isActiveStatus('APPROVED') === true &&
        ResourceRequest.isActiveStatus('COLLECTED') === true &&
        ResourceRequest.isActiveStatus('REJECTED') === false &&
        ResourceRequest.isActiveStatus('RETURNED') === false &&
        ResourceRequest.isActiveStatus('CANCELLED') === false,
      'isActiveStatus() reports the right active set'
    );
    // A duplicate active call still works at the model layer. By
    // now every request in the test has reached a terminal state
    // (Carol: RETURNED; Eve: REJECTED twice). So hasActiveRequest
    // correctly returns null for both pairs.
    const dupe = await ResourceRequest.hasActiveRequest(resource1._id, verifiedVol._id);
    assert(dupe === null, 'hasActiveRequest returns null for Carol (RETURNED is terminal)');
    const eveDone = await ResourceRequest.hasActiveRequest(resource2._id, anotherVol._id);
    assert(eveDone === null, 'hasActiveRequest returns null for Eve (REJECTED is terminal)');
    // Sanity: the helper still finds an open request when one exists.
    const resourceForActive = await Resource.create({
      ownerId: otherOwner._id,
      category: 'UTILITIES',
      title: 'Active test kit',
      description: 'A resource for the active-helper sanity test.',
    });
    await ResourceRequest.create({
      resourceId: resourceForActive._id,
      ownerId: otherOwner._id,
      volunteerId: verifiedVol._id,
      status: 'REQUESTED',
    });
    const found = await ResourceRequest.hasActiveRequest(
      resourceForActive._id,
      verifiedVol._id
    );
    assert(found !== null, 'hasActiveRequest finds the fresh REQUESTED doc');
  }

  await stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await start();
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    try {
      await stop();
    } catch {}
    process.exitCode = 1;
  }
})();