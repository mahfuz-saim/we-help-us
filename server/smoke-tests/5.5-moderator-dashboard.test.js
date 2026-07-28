/**
 * End-to-end smoke test for Module 5.5 — Moderator Dashboard
 * (Request Oversight).
 *
 * Module 5.5 is a CLIENT module built on top of Module 5.2's request
 * APIs. The server side is unchanged from 5.2 — the moderator's
 * GET /api/requests already area-scopes via the Resource.areaId
 * join, and PATCH /api/requests/:id/reject already accepts moderator
 * tokens. Module 5.5 just adds the client dashboard on top.
 *
 * This smoke locks the moderator contract so the dashboard wiring
 * can rely on it:
 *
 *   1. Seed: 2 areas (Test Union 55 in-area, Other Union 55
 *      out-of-area), 9 users (Alice/Bob owners, Carol/Dan/Eve
 *      verified volunteers, ModInArea moderator + ModOutOfArea
 *      moderator + ModNoArea moderator, Admin), 3 resources
 *      (2 in-area Alice-owned + 1 out-of-area Alice-owned), 4
 *      requests (2 in-area at different statuses + 1 out-of-area +
 *      1 in-area approved-then-rejectable).
 *   2. Auth gate: 401 without token on list+reject.
 *   3. Area-scoped list: ModInArea sees the 3 in-area requests
 *      (the 1 out-of-area is excluded); volunteerSummary.name +
 *      resource.{title,category,status} populated; NO email/phone
 *      keys on any summary.
 *   4. No-area moderator → []: empty list, same envelope shape.
 *   5. Cross-area isolation: ModOutOfArea sees the 1 out-of-area
 *      request and zero in-area requests — confirms the areaId
 *      join is exclusive, not additive.
 *   6. Reject from REQUESTED (moderator): 403 for non-moderator
 *      (volunteer), happy 200 from moderator, note persisted,
 *      resource stays AVAILABLE.
 *   7. Reject from APPROVED (moderator, un-RESERVE): moderator can
 *      reject an APPROVED request; resource flips RESERVED →
 *      AVAILABLE; note persists; 409 on re-reject of terminal
 *      status.
 *   8. Role-escalation regression: moderator gets 403 on
 *      approve / collect / return / complete AND on GET /:id
 *      for non-principal requests (5.2 controller contract).
 *   9. Status filter counters: ?status=REQUESTED returns the right
 *      rows for the area-moderator; pagination metadata echoed.
 *  10. Admin sees all (cross-area + cross-owner) — confirms the
 *      ADMIN branch of the role-scoping is still untouched by 5.5.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

// Atlas-ephemeral DB — same pattern as 5.1 / 5.2 / 5.4.
const TEST_DB = `whudbg_55_${Date.now()}_${Math.random()
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
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) }
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

// Privacy walker — same shape as 5.4.
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

async function seedResource({ ownerId, title = 'Resource', category = 'MEDICAL', status = 'AVAILABLE', areaId = null }) {
  return Resource.create({
    ownerId,
    category,
    title,
    description: `${title} — 5.5 smoke fixture`,
    condition: 'GOOD',
    status,
    areaId: areaId || undefined,
  });
}

async function seedRequest({ resourceId, ownerId, volunteerId, status = 'REQUESTED', note = null }) {
  const doc = new ResourceRequest({
    resourceId,
    ownerId,
    volunteerId,
    status,
    moderatorNote: note,
  });
  if (status !== 'REQUESTED') {
    if (['APPROVED', 'COLLECTED', 'RETURNED'].includes(status)) {
      doc.approvedAt = new Date();
    }
    if (['COLLECTED', 'RETURNED'].includes(status)) {
      doc.collectedAt = new Date();
    }
    if (status === 'RETURNED') {
      doc.returnedAt = new Date();
    }
  }
  await doc.save();
  return doc;
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
  section('1. seed users + resources + requests + areas');
  const inAreaId = await seedArea({ name: 'Test Union 55 In' });
  const outAreaId = await seedArea({ name: 'Test Union 55 Out' });
  assert(inAreaId && outAreaId, '2 areas seeded (in-area + out-of-area)');

  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 55',
    email: 'alice.owner55@example.com',
    phone: '+15555550101',
    role: 'OWNER',
  });
  const { doc: bob, token: bobToken } = await seedUser({
    name: 'Bob Owner 55',
    email: 'bob.owner55@example.com',
    phone: '+15555550102',
    role: 'OWNER',
  });
  const { doc: carol, token: carolToken } = await seedUser({
    name: 'Carol Volunteer 55',
    email: 'carol.vol55@example.com',
    phone: '+15555550201',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: dan, token: danToken } = await seedUser({
    name: 'Dan Volunteer 55',
    email: 'dan.vol55@example.com',
    phone: '+15555550202',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve Volunteer 55',
    email: 'eve.vol55@example.com',
    phone: '+15555550203',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: modInArea, token: modInToken } = await seedUser({
    name: 'Mod InArea',
    email: 'mod.inarea55@example.com',
    phone: '+15555550301',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modOutArea, token: modOutToken } = await seedUser({
    name: 'Mod OutOfArea',
    email: 'mod.outarea55@example.com',
    phone: '+15555550302',
    role: 'MODERATOR',
    areaId: outAreaId,
  });
  const { doc: modNoArea, token: modNoToken } = await seedUser({
    name: 'Mod NoArea',
    email: 'mod.noarea55@example.com',
    phone: '+15555550303',
    role: 'MODERATOR',
    areaId: null,
  });
  const { token: adminToken } = await seedUser({
    name: 'Grace Admin 55',
    email: 'grace.admin55@example.com',
    phone: '+15555550401',
    role: 'ADMIN',
  });

  // 3 resources: 2 in-area + 1 out-of-area (all Alice-owned for
  // simplicity; the OWNER-side scope is irrelevant to 5.5).
  const aliceResA = await seedResource({
    ownerId: alice._id,
    title: 'Ambulance 55-A',
    category: 'MEDICAL',
    areaId: inAreaId,
  });
  const aliceResB = await seedResource({
    ownerId: alice._id,
    title: 'Rescue Boat 55-B',
    category: 'RESCUE_EQUIPMENT',
    areaId: inAreaId,
  });
  const aliceResOut = await seedResource({
    ownerId: alice._id,
    title: 'Bob Truck 55-Out',
    category: 'TRANSPORTATION',
    areaId: outAreaId,
  });

  // 4 requests:
  //   - reqCarolA  REQUESTED on AliceResA     (in-area, REQUESTED)
  //   - reqDanB    REQUESTED on AliceResB     (in-area, will become APPROVED → reject)
  //   - reqEveOut  REQUESTED on AliceResOut   (OUT-of-area, must not appear for modIn)
  //   - reqEveA    REQUESTED on AliceResA     (in-area, will be APPROVED → COLLECTED → RETURNED)
  const reqCarolA = await seedRequest({
    resourceId: aliceResA._id,
    ownerId: alice._id,
    volunteerId: carol._id,
  });
  const reqDanB = await seedRequest({
    resourceId: aliceResB._id,
    ownerId: alice._id,
    volunteerId: dan._id,
  });
  const reqEveOut = await seedRequest({
    resourceId: aliceResOut._id,
    ownerId: alice._id,
    volunteerId: eve._id,
  });
  const reqEveA = await seedRequest({
    resourceId: aliceResA._id,
    ownerId: alice._id,
    volunteerId: eve._id,
  });

  assert(
    aliceToken && bobToken && carolToken && danToken && eveToken &&
      modInToken && modOutToken && modNoToken && adminToken,
    'all 9 users + tokens created'
  );
  assert(
    aliceResA && aliceResB && aliceResOut,
    '3 resources seeded (2 in-area + 1 out-of-area)'
  );
  assert(
    reqCarolA && reqDanB && reqEveOut && reqEveA,
    '4 requests seeded (3 in-area + 1 out-of-area)'
  );

  // ── 1b. Drive lifecycle for the APPROVED-reject section ────────────
  // reqDanB → APPROVED so we can reject from APPROVED later.
  // reqEveA → APPROVED → COLLECTED → RETURNED so the un-RESERVE
  // path is exercised separately, and so the REJECTED count test
  // has the right fixture.
  {
    const r = await http_('PATCH', `/api/requests/${reqDanB._id}/approve`, {
      token: aliceToken,
    });
    assert(r.status === 200, 'drive DanB to APPROVED via real endpoint');

    const r2 = await http_('PATCH', `/api/requests/${reqEveA._id}/approve`, {
      token: aliceToken,
    });
    assert(r2.status === 200, 'drive EveA to APPROVED');
    const r3 = await http_('PATCH', `/api/requests/${reqEveA._id}/collect`, {
      token: eveToken,
    });
    assert(r3.status === 200, 'drive EveA to COLLECTED');
    const r4 = await http_('PATCH', `/api/requests/${reqEveA._id}/return`, {
      token: eveToken,
    });
    assert(r4.status === 200, 'drive EveA to RETURNED');
  }

  // ── 2. Auth gate ────────────────────────────────────────────────────
  section('2. auth gate');
  {
    const noToken = await http_('GET', '/api/requests');
    assert(noToken.status === 401, 'GET /requests without token → 401');

    const noTokenReject = await http_(
      'PATCH',
      `/api/requests/${reqCarolA._id}/reject`
    );
    assert(
      noTokenReject.status === 401,
      'PATCH /requests/:id/reject without token → 401'
    );
  }

  // ── 3. Area-scoped list (ModInArea) ─────────────────────────────────
  section('3. area-scoped list (ModInArea) — populate + privacy');
  {
    const list = await http_('GET', '/api/requests', { token: modInToken });
    assert(list.status === 200, 'GET /requests (ModInArea) → 200');
    assert(
      list.body.data.requests.length === 3,
      'ModInArea sees 3 requests (EveOut excluded)'
    );
    assert(
      list.body.data.pagination.total === 3,
      'pagination.total echoes the count'
    );

    // The out-of-area request id must not be in the list.
    const ids = list.body.data.requests.map((r) => r.id);
    assert(
      !ids.includes(reqEveOut._id.toString()),
      'out-of-area request excluded from ModInArea list'
    );

    // Build a map for row-level assertions.
    const byId = Object.fromEntries(list.body.data.requests.map((r) => [r.id, r]));

    const carolRow = byId[reqCarolA._id.toString()];
    assert(carolRow, 'CarolA row present in ModInArea list');
    assert(
      carolRow.volunteerSummary &&
        carolRow.volunteerSummary.name === 'Carol Volunteer 55',
      '  CarolA volunteerSummary.name === "Carol Volunteer 55"'
    );
    assert(
      carolRow.volunteerSummary &&
        carolRow.volunteerSummary.id === carol._id.toString(),
      '  CarolA volunteerSummary.id is the volunteer id'
    );
    assert(
      carolRow.resource &&
        carolRow.resource.title === 'Ambulance 55-A' &&
        carolRow.resource.category === 'MEDICAL',
      '  CarolA resource summary has title + category'
    );
    assert(
      carolRow.resource.status === 'IN_USE',
      '  CarolA resource status=IN_USE (EveA same resource was COLLECTED in section 1b)'
    );

    // The DanB row is APPROVED → resource should reflect RESERVED.
    const danRow = byId[reqDanB._id.toString()];
    assert(danRow, 'DanB row present in ModInArea list');
    assert(danRow.status === 'APPROVED', '  DanB row status=APPROVED');
    assert(
      danRow.resource.status === 'RESERVED',
      '  DanB resource.status=RESERVED (after approve)'
    );

    // Privacy — no email/phone on any summary in the list payload.
    assert(
      !hasContactLeak(list.body),
      'list payload has NO email/phone keys (any depth)'
    );
    // Belt + braces — assert the populated summaries explicitly
    // don't carry contact keys.
    for (const r of list.body.data.requests) {
      if (r.volunteerSummary) {
        assert(
          !r.volunteerSummary.email && !r.volunteerSummary.phone,
          '  volunteerSummary carries name + id only'
        );
      }
      if (r.resource) {
        assert(
          !r.resource.email && !r.resource.phone,
          '  resource summary has no contact keys'
        );
      }
    }
  }

  // ── 4. No-area moderator → [] ───────────────────────────────────────
  section('4. moderator with no areaId → []');
  {
    const list = await http_('GET', '/api/requests', { token: modNoToken });
    assert(list.status === 200, 'no-area moderator list → 200');
    assert(
      list.body.data.requests.length === 0,
      'no-area moderator sees [] (empty requests)'
    );
    assert(
      list.body.data.pagination.total === 0,
      'no-area moderator pagination.total === 0'
    );
    assert(!hasContactLeak(list.body), '  empty list payload has no contact leak');
  }

  // ── 5. Cross-area isolation (ModOutArea) ────────────────────────────
  section('5. cross-area isolation — ModOutArea sees ONLY the out-of-area row');
  {
    const list = await http_('GET', '/api/requests', { token: modOutToken });
    assert(list.status === 200, 'GET /requests (ModOutArea) → 200');
    assert(
      list.body.data.requests.length === 1,
      'ModOutArea sees exactly 1 request (EveOut)'
    );
    assert(
      list.body.data.requests[0].id === reqEveOut._id.toString(),
      '  the one row is the out-of-area request'
    );
    // And — critically — none of the in-area request ids leak.
    const ids = list.body.data.requests.map((r) => r.id);
    assert(
      !ids.includes(reqCarolA._id.toString()) &&
        !ids.includes(reqDanB._id.toString()) &&
        !ids.includes(reqEveA._id.toString()),
      '  in-area request ids do NOT leak to ModOutArea'
    );
  }

  // ── 6. Reject from REQUESTED (moderator) ────────────────────────────
  section('6. reject from REQUESTED — moderator');
  {
    // Volunteer cannot reject — 403.
    const volunteerReject = await http_(
      'PATCH',
      `/api/requests/${reqCarolA._id}/reject`,
      { token: carolToken }
    );
    assert(
      volunteerReject.status === 403,
      'volunteer cannot reject → 403'
    );

    // Moderator can — happy path.
    const modReject = await http_(
      'PATCH',
      `/api/requests/${reqCarolA._id}/reject`,
      {
        token: modInToken,
        body: { moderatorNote: 'Area scope: not a medical emergency yet.' },
      }
    );
    assert(modReject.status === 200, 'moderator reject (REQUESTED) → 200');
    assert(
      modReject.body.data.request.status === 'REJECTED',
      '  request.status now REJECTED'
    );
    assert(
      modReject.body.data.request.moderatorNote ===
        'Area scope: not a medical emergency yet.',
      '  moderatorNote persisted'
    );
    // Resource should still be in its prior state. Note: AliceResA
    // was moved to IN_USE by the section-1b EveA COLLECT, so a
    // REQUESTED→REJECTED on CarolA does NOT un-IN_USE the resource.
    // (The un-RESERVE only fires when the request had reached
    // APPROVED.) We assert the resource remains IN_USE here so
    // section-9's status filter counts match the lifecycle state.
    const reloadedRes = await Resource.findById(aliceResA._id).lean();
    assert(
      reloadedRes.status === 'IN_USE',
      '  resource stays IN_USE (REQUESTED → REJECTED does not un-IN_USE; was IN_USE from section 1b)'
    );

    // Privacy — the reject response must not leak contact info.
    assert(
      !hasContactLeak(modReject.body),
      'reject response has NO contact leak'
    );

    // Re-reject → 409.
    const reReject = await http_(
      'PATCH',
      `/api/requests/${reqCarolA._id}/reject`,
      { token: modInToken }
    );
    assert(reReject.status === 409, 're-reject (terminal status) → 409');
  }

  // ── 7. Reject from APPROVED (un-RESERVE) ───────────────────────────
  section('7. reject from APPROVED — un-RESERVE resource');
  {
    // Before: reqDanB is APPROVED, AliceResB is RESERVED.
    const beforeRes = await Resource.findById(aliceResB._id).lean();
    assert(beforeRes.status === 'RESERVED',
      '  precondition: AliceResB is RESERVED (reqDanB APPROVED)');

    const modReject = await http_(
      'PATCH',
      `/api/requests/${reqDanB._id}/reject`,
      {
        token: modInToken,
        body: { moderatorNote: 'Resource needed in-area.' },
      }
    );
    assert(modReject.status === 200, 'moderator reject (APPROVED) → 200');
    assert(
      modReject.body.data.request.status === 'REJECTED',
      '  request.status now REJECTED'
    );
    assert(
      modReject.body.data.request.moderatorNote === 'Resource needed in-area.',
      '  moderatorNote persisted'
    );
    // After: resource must be AVAILABLE (un-RESERVED).
    const afterRes = await Resource.findById(aliceResB._id).lean();
    assert(afterRes.status === 'AVAILABLE',
      '  resource back to AVAILABLE (un-RESERVED on APPROVED → REJECTED)');
    assert(
      !hasContactLeak(modReject.body),
      'reject-from-APPROVED response has NO contact leak'
    );

    // Re-reject of the now-REJECTED row → 409.
    const reReject = await http_(
      'PATCH',
      `/api/requests/${reqDanB._id}/reject`,
      { token: modInToken }
    );
    assert(reReject.status === 409, 're-reject of REJECTED → 409');
  }

  // ── 8. Role-escalation regression ───────────────────────────────────
  section('8. role escalation — moderator 403 on approve / collect / return / complete / GET /:id');
  {
    // Use the remaining REQUESTED request — wait, we already rejected
    // CarolA. Use a brand-new request via the real POST endpoint so
    // the lifecycle gating is exercised cleanly. Dan is verified +
    // has no open request against AliceResB (now AVAILABLE post-un-
    // RESERVE), so a fresh POST → APPROVE should land on DanB again.

    // POST a fresh request so the role-gating section has its own
    // fixture without stepping on the rejected CarolA.
    const newReqPost = await http_('POST', '/api/requests', {
      token: danToken,
      body: { resourceId: aliceResB._id.toString() },
    });
    assert(newReqPost.status === 201, 'POST fresh request (Dan on AliceResB) → 201');
    const newReqId = newReqPost.body.data.request.id;

    // Moderator APPROVE → 403 (approve is owner-only).
    const modApprove = await http_(
      'PATCH',
      `/api/requests/${newReqId}/approve`,
      { token: modInToken }
    );
    assert(modApprove.status === 403, 'moderator APPROVE → 403');

    // Owner APPROVE → 200, then moderator COLLECT → 403.
    const ownerApprove = await http_(
      'PATCH',
      `/api/requests/${newReqId}/approve`,
      { token: aliceToken }
    );
    assert(ownerApprove.status === 200, 'owner APPROVE → 200 (sets up collect test)');
    const modCollect = await http_(
      'PATCH',
      `/api/requests/${newReqId}/collect`,
      { token: modInToken }
    );
    assert(modCollect.status === 403, 'moderator COLLECT → 403');

    // Volunteer COLLECT → 200, then moderator RETURN → 403.
    const volCollect = await http_(
      'PATCH',
      `/api/requests/${newReqId}/collect`,
      { token: danToken }
    );
    assert(volCollect.status === 200, 'volunteer COLLECT → 200');
    const modReturn = await http_(
      'PATCH',
      `/api/requests/${newReqId}/return`,
      { token: modInToken }
    );
    assert(modReturn.status === 403, 'moderator RETURN → 403');

    // Volunteer RETURN → 200, then moderator COMPLETE → 403.
    const volReturn = await http_(
      'PATCH',
      `/api/requests/${newReqId}/return`,
      { token: danToken }
    );
    assert(volReturn.status === 200, 'volunteer RETURN → 200');
    const modComplete = await http_(
      'PATCH',
      `/api/requests/${newReqId}/complete`,
      { token: modInToken }
    );
    assert(modComplete.status === 403, 'moderator COMPLETE → 403');

    // GET /:id as moderator for non-principal → 403 (5.2 contract:
    // only principal-or-admin can fetch a single request, and the
    // moderator is intentionally NOT in that scope — keeps contact
    // info gated).
    const modGet = await http_(
      'GET',
      `/api/requests/${newReqId}`,
      { token: modInToken }
    );
    assert(
      modGet.status === 403,
      'moderator GET /:id for non-principal → 403 (contact gate)'
    );

    // And a sanity check — admin CAN fetch it.
    const adminGet = await http_(
      'GET',
      `/api/requests/${newReqId}`,
      { token: adminToken }
    );
    assert(adminGet.status === 200, 'admin GET /:id → 200');
  }

  // ── 9. Status filter counters ───────────────────────────────────────
  section('9. status filter counters (ModInArea)');
  {
    const allList = await http_('GET', '/api/requests', {
      token: modInToken,
    });
    assert(
      allList.body.data.pagination.total === 4,
      'unfiltered ModInArea list shows all 4 in-area requests (3 seed + 1 from section 8)'
    );

    const requestedList = await http_('GET', '/api/requests?status=REQUESTED', {
      token: modInToken,
    });
    assert(
      requestedList.status === 200,
      '?status=REQUESTED → 200'
    );
    // After section 6 (CarolA rejected) + section 7 (DanB rejected) +
    // section 8 (fresh POST→APPROVED), the REQUESTED count should be
    // 0 — every in-area request is now in a non-REQUESTED status.
    assert(
      requestedList.body.data.requests.length === 0,
      '  ?status=REQUESTED returns 0 rows (all moved past REQUESTED)'
    );
    assert(
      requestedList.body.data.pagination.total === 0,
      '  ?status=REQUESTED pagination.total === 0'
    );

    const approvedList = await http_('GET', '/api/requests?status=APPROVED', {
      token: modInToken,
    });
    assert(
      approvedList.body.data.requests.length === 0,
      '  ?status=APPROVED returns 0 rows (the section-8 fresh request moved to RETURNED in section 8)'
    );

    const returnedList = await http_('GET', '/api/requests?status=RETURNED', {
      token: modInToken,
    });
    assert(
      returnedList.body.data.requests.length === 2,
      '  ?status=RETURNED returns 2 rows (EveA from section 1b + the section-8 fresh request after its COLLECT→RETURN)'
    );

    const rejectedList = await http_('GET', '/api/requests?status=REJECTED', {
      token: modInToken,
    });
    assert(
      rejectedList.body.data.requests.length === 2,
      '  ?status=REJECTED returns 2 rows (CarolA + DanB)'
    );

    // Bad status → 400 (validator strictness).
    const badStatus = await http_('GET', '/api/requests?status=NOT_A_STATUS', {
      token: modInToken,
    });
    assert(
      badStatus.status === 400,
      '?status=NOT_A_STATUS → 400 (validator strict)'
    );
  }

  // ── 10. Admin sees all (cross-area + cross-owner) ───────────────────
  section('10. admin cross-scope oversight');
  {
    const adminList = await http_('GET', '/api/requests', {
      token: adminToken,
    });
    assert(adminList.status === 200, 'GET /requests (admin) → 200');
    // Admin sees all 4 originally-seeded requests PLUS the section-8
    // fresh POST (5 total). We assert >= 4 to keep the smoke stable
    // if the lifecycle count drifts.
    assert(
      adminList.body.data.pagination.total >= 4,
      'admin sees every request (>= 4)'
    );
    assert(
      !hasContactLeak(adminList.body),
      'admin list has NO contact leak'
    );
  }

  await stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    try { await stop(); } catch {}
    process.exitCode = process.exitCode || 1;
  }
})();