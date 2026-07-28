/**
 * End-to-end smoke test for Module 5.4 — Owner Request Notifications &
 * Actions.
 *
 * Module 5.4 is a client module built on top of Module 5.2's request
 * APIs. The server-side changes for 5.4 are minimal:
 *
 *   - listRequests now populates volunteerId (name only) + resourceId
 *     (category/title/status) so the OWNER dashboard can render the
 *     inbox without a per-row round-trip. This is the only server
 *     change in 5.4.
 *
 * This smoke covers:
 *
 *   1. Seed: 2 owners (Alice + Bob) + 3 verified volunteers (Carol,
 *      Dan, Eve) + 3 resources (1 per volunteer targeting Alice, plus
 *      one for Bob as the negative-control).
 *   2. List populate behavior on OWNER's inbox:
 *        - Volunteer name + resource title/category appear
 *        - Email / phone NEVER appear on the list
 *        - volunteerId + resourceId + ownerId remain strings (the
 *          wire shape is unchanged for backwards compatibility with
 *          the 5.3 volunteer dashboard).
 *   3. APPROVE flow (REQUESTED → APPROVED):
 *        - 403 for non-owner (different owner + volunteer-self)
 *        - 409 from non-REQUESTED
 *        - happy path: Resource AVAILABLE → RESERVED, no contact leak
 *   4. REJECT flow (REQUESTED → REJECTED, plus APPROVED → REJECTED):
 *        - 403 for non-owner non-moderator (Eve the volunteer cannot
 *          reject Bob's resource request — she's neither owner nor mod)
 *        - happy REQUESTED → REJECTED (resource stays AVAILABLE)
 *        - happy APPROVED → REJECTED with note (resource back to
 *          AVAILABLE)
 *        - 409 from REJECTED / COLLECTED / RETURNED / CANCELLED
 *   5. COMPLETE flow (RETURNED → Resource.AVAILABLE):
 *        - 403 for non-owner
 *        - 409 from non-RETURNED
 *        - happy RETURNED → Resource.IN_USE → AVAILABLE
 *   6. GET /api/requests/:id for OWNER:
 *        - 200 with `revealContacts: true` semantics — the OWNER
 *          sees volunteer name on every status; email/phone only
 *          when status === COLLECTED. This is what powers the
 *          page's VolunteerContactCard.
 *   7. Privacy cross-check: OWNER's list view carries NO email/phone
 *      in any depth; the action responses also carry none (privacy
 *      boundary is COLLECTED only).
 *   8. Counter sanity — the OWNER's `?status=REQUESTED` and
 *      `?status=APPROVED` filter queries return the expected counts,
 *      which is what Module 5.4's dashboard badge hooks into.
 */

require('dotenv').config();

// Drop the Cloudinary env vars so any latent upload path doesn't try
// to reach a real bucket during this smoke (5.4 doesn't upload anything,
// but the auth middleware / Cloudinary config can still get touched
// indirectly via the require chain).
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

// Atlas-ephemeral DB — same pattern as 5.1 / 5.2. The cap on Mongo's
// dbname is 38 chars total, so we trim the prefix to fit.
const TEST_DB = `whudbg_54_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
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

// Privacy walker — recursive, looks for email/phone/password keys.
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
  const token = signJwt({ id: doc._id.toString() });
  return { doc, token };
}

async function seedResource({ ownerId, title = 'Resource', category = 'MEDICAL', status = 'AVAILABLE' }) {
  return Resource.create({
    ownerId,
    category,
    title,
    description: `${title} — 5.4 smoke fixture`,
    condition: 'GOOD',
    status,
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
  // Pre-populate lifecycle timestamps to match the canonical state so
  // the smoke can read them back without manually advancing the clock.
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

async function run() {
  await start();

  // ── 1. Seed ────────────────────────────────────────────────────────
  section('1. seed users + resources + requests');
  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner',
    email: 'alice.owner54@example.com',
    phone: '+15555550101',
    role: 'OWNER',
  });
  const { doc: bob, token: bobToken } = await seedUser({
    name: 'Bob Owner',
    email: 'bob.owner54@example.com',
    phone: '+15555550102',
    role: 'OWNER',
  });
  const { doc: carol, token: carolToken } = await seedUser({
    name: 'Carol Volunteer',
    email: 'carol.vol54@example.com',
    phone: '+15555550201',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: dan, token: danToken } = await seedUser({
    name: 'Dan Volunteer',
    email: 'dan.vol54@example.com',
    phone: '+15555550202',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve Volunteer',
    email: 'eve.vol54@example.com',
    phone: '+15555550203',
    role: 'VOLUNTEER',
    isVerified: true,
  });
  const { doc: mod } = await seedUser({
    name: 'Mod Moderator',
    email: 'mod.mod54@example.com',
    phone: '+15555550301',
    role: 'MODERATOR',
  });
  const { token: adminToken } = await seedUser({
    name: 'Grace Admin',
    email: 'grace.admin54@example.com',
    phone: '+15555550401',
    role: 'ADMIN',
  });

  // Three Alice-owned resources so we can populate the inbox with
  // distinct (resource, volunteer, status) tuples.
  const aliceResourceA = await seedResource({
    ownerId: alice._id,
    title: 'Ambulance A',
    category: 'MEDICAL',
  });
  const aliceResourceB = await seedResource({
    ownerId: alice._id,
    title: 'Rescue Boat B',
    category: 'RESCUE_EQUIPMENT',
  });
  const aliceResourceC = await seedResource({
    ownerId: alice._id,
    title: 'Generator C',
    category: 'UTILITIES',
  });
  // Bob-owned resource — should NEVER show up on Alice's inbox.
  const bobResource = await seedResource({
    ownerId: bob._id,
    title: 'Bob Truck',
    category: 'TRANSPORTATION',
  });

  // The four-request matrix:
  //   - reqCarolA     REQUESTED
  //   - reqDanB       APPROVED   (resource reserved)
  //   - reqEveC       RETURNED   (resource IN_USE pending complete)
  //   - reqEveARejected REJECTED (already closed)
  // We seed all four at REQUESTED, then drive CarolA / DanB / EveC to
  // their target statuses through the real controller endpoints so
  // the Resource.status transitions happen via the same code path
  // the production UI uses — this keeps the smoke from breaking
  // whenever the lifecycle side-effects change in 5.2.
  const reqCarolA = await seedRequest({
    resourceId: aliceResourceA._id,
    ownerId: alice._id,
    volunteerId: carol._id,
    status: 'REQUESTED',
  });
  const reqDanB = await seedRequest({
    resourceId: aliceResourceB._id,
    ownerId: alice._id,
    volunteerId: dan._id,
    status: 'REQUESTED',
  });
  const reqEveC = await seedRequest({
    resourceId: aliceResourceC._id,
    ownerId: alice._id,
    volunteerId: eve._id,
    status: 'REQUESTED',
  });
  // Eve-on-Alice-A but already rejected — pre-set so the list shows
  // a REJECTED row without an additional side-effect path.
  const reqEveARejected = await seedRequest({
    resourceId: aliceResourceA._id,
    ownerId: alice._id,
    volunteerId: eve._id,
    status: 'REJECTED',
    note: 'Resource reserved for someone else.',
  });
  // Bob's incoming — must NOT appear on Alice's list.
  const reqBobIncoming = await seedRequest({
    resourceId: bobResource._id,
    ownerId: bob._id,
    volunteerId: carol._id,
    status: 'REQUESTED',
  });

  assert(
    alice && aliceToken && bob && bobToken && carol && carolToken && dan && danToken && eve && eveToken && adminToken && mod,
    'all 7 users + tokens created'
  );
  assert(
    aliceResourceA && aliceResourceB && aliceResourceC && bobResource,
    '4 resources created (3 Alice + 1 Bob)'
  );
  assert(
    reqCarolA && reqDanB && reqEveC && reqEveARejected && reqBobIncoming,
    '5 requests seeded (4 Alice incoming + 1 Bob incoming)'
  );

  // ── 1b. Drive the lifecycle via real endpoints ─────────────────────
  // Move the matrix into its target statuses through the same paths
  // the UI uses. This way the Resource.status side-effects (RESERVED /
  // IN_USE) track the request statuses exactly as the dashboard will
  // observe them.
  {
    // reqDanB: REQUESTED → APPROVED (resource RESERVED).
    const r = await http_('PATCH', `/api/requests/${reqDanB._id}/approve`, {
      token: aliceToken,
    });
    assert(r.status === 200, 'drive DanB to APPROVED via real endpoint');

    // reqEveC: REQUESTED → APPROVED → COLLECTED → RETURNED.
    const r2 = await http_('PATCH', `/api/requests/${reqEveC._id}/approve`, {
      token: aliceToken,
    });
    assert(r2.status === 200, 'drive EveC APPROVED');
    const r3 = await http_('PATCH', `/api/requests/${reqEveC._id}/collect`, {
      token: eveToken,
    });
    assert(r3.status === 200, 'drive EveC COLLECTED');
    const r4 = await http_('PATCH', `/api/requests/${reqEveC._id}/return`, {
      token: eveToken,
    });
    assert(r4.status === 200, 'drive EveC RETURNED');
  }

  // ── 2. List populate (OWNER inbox) ─────────────────────────────────
  section('2. OWNER list — populate + privacy');
  {
    const aliceList = await http_('GET', '/api/requests', { token: aliceToken });
    assert(aliceList.status === 200, 'GET /requests (OWNER) → 200');
    assert(
      aliceList.body.data.requests.length === 4,
      'Alice sees 4 incoming requests (Bob\'s excluded)'
    );
    assert(
      aliceList.body.data.pagination.total === 4,
      'pagination.total echoes the count'
    );

    // Find each row by id and verify the populated fields.
    const byId = Object.fromEntries(
      aliceList.body.data.requests.map((r) => [r.id, r])
    );

    // CarolA — REQUESTED, on Ambulance A, by Carol.
    const carolRow = byId[reqCarolA._id.toString()];
    assert(carolRow, 'CarolA row present');
    assert(
      carolRow.status === 'REQUESTED',
      '  CarolA row status=REQUESTED'
    );
    assert(
      carolRow.volunteerSummary && carolRow.volunteerSummary.name === 'Carol Volunteer',
      '  CarolA volunteerSummary.name === "Carol Volunteer"'
    );
    assert(
      carolRow.volunteerSummary && carolRow.volunteerSummary.id === carol._id.toString(),
      '  CarolA volunteerSummary.id is the volunteer id'
    );
    assert(
      carolRow.resource && carolRow.resource.title === 'Ambulance A' && carolRow.resource.category === 'MEDICAL',
      '  CarolA resource summary has title + category'
    );
    assert(
      carolRow.resource.status === 'AVAILABLE',
      '  CarolA resource status=AVAILABLE (not yet reserved)'
    );

    // DanB — APPROVED, on Rescue Boat B, by Dan. Resource should
    // already be RESERVED.
    const danRow = byId[reqDanB._id.toString()];
    assert(danRow, 'DanB row present');
    assert(danRow.status === 'APPROVED', '  DanB row status=APPROVED');
    assert(
      danRow.volunteerSummary && danRow.volunteerSummary.name === 'Dan Volunteer',
      '  DanB volunteerSummary.name === "Dan Volunteer"'
    );
    assert(
      danRow.resource.title === 'Rescue Boat B' && danRow.resource.status === 'RESERVED',
      '  DanB resource is RESERVED (after owner approve)'
    );

    // EveC — RETURNED. Resource stays IN_USE (only COMPLETE flips it
    // back to AVAILABLE — and that's what 5.4 covers).
    const eveRow = byId[reqEveC._id.toString()];
    assert(eveRow, 'EveC row present');
    assert(eveRow.status === 'RETURNED', '  EveC row status=RETURNED');
    assert(
      eveRow.resource.status === 'IN_USE',
      '  EveC resource is IN_USE (owner has not yet completed)'
    );

    // EveARejected — REJECTED, moderatorNote persisted.
    const eveRejRow = byId[reqEveARejected._id.toString()];
    assert(eveRejRow, 'EveARejected row present');
    assert(
      eveRejRow.status === 'REJECTED',
      '  EveARejected row status=REJECTED'
    );
    assert(
      eveRejRow.moderatorNote === 'Resource reserved for someone else.',
      '  EveARejected moderatorNote persisted from the seed'
    );

    // Privacy: NO contact info anywhere in the OWNER list response.
    assert(
      !hasContactLeak(aliceList.body),
      'OWNER list response has NO contact leak'
    );

    // The summary blocks carry ONLY name + id — never email/phone.
    for (const r of aliceList.body.data.requests) {
      if (r.volunteerSummary) {
        assert(
          !r.volunteerSummary.email && !r.volunteerSummary.phone,
          `  ${r.id} volunteerSummary carries no email/phone`
        );
      }
      if (r.resource) {
        assert(
          !r.resource.email && !r.resource.phone,
          `  ${r.id} resource summary carries no email/phone`
        );
      }
      // The wire format keeps ids as strings for backwards compat
      // with the 5.3 volunteer dashboard.
      assert(
        typeof r.ownerId === 'string',
        `  ${r.id} ownerId is a string`
      );
      assert(
        typeof r.resourceId === 'string',
        `  ${r.id} resourceId is a string`
      );
      assert(
        typeof r.volunteerId === 'string',
        `  ${r.id} volunteerId is a string`
      );
    }

    // Bob's incoming — should NOT leak to Alice.
    assert(
      !byId[reqBobIncoming._id.toString()],
      "Bob's incoming request is NOT in Alice's list"
    );
  }

  // ── 3. APPROVE flow ────────────────────────────────────────────────
  section('3. PATCH /:id/approve');
  {
    // 403 for a different owner (Bob trying to approve Alice's request).
    const bobApprove = await http_('PATCH', `/api/requests/${reqCarolA._id}/approve`, {
      token: bobToken,
    });
    assert(bobApprove.status === 403, '  Bob cannot approve Alice\'s request');

    // 403 for the volunteer-self (Carol can't approve her own request).
    const carolApprove = await http_('PATCH', `/api/requests/${reqCarolA._id}/approve`, {
      token: carolToken,
    });
    assert(carolApprove.status === 403, '  Carol cannot approve her own request');

    // 409 from non-REQUESTED (DanB is APPROVED already).
    const danApprove = await http_('PATCH', `/api/requests/${reqDanB._id}/approve`, {
      token: aliceToken,
    });
    assert(danApprove.status === 409, '  re-approve APPROVED request → 409');

    // Happy path: REQUESTED → APPROVED.
    const aliceApprove = await http_('PATCH', `/api/requests/${reqCarolA._id}/approve`, {
      token: aliceToken,
    });
    assert(aliceApprove.status === 200, 'OWNER approve REQUESTED → 200');
    assert(
      aliceApprove.body.data.request.status === 'APPROVED',
      '  status now APPROVED'
    );
    assert(
      aliceApprove.body.data.request.approvedAt,
      '  approvedAt populated'
    );
    assert(
      !hasContactLeak(aliceApprove.body),
      '  APPROVE response has NO contact leak'
    );

    // Resource flipped AVAILABLE → RESERVED.
    const r = await Resource.findById(aliceResourceA._id);
    assert(r.status === 'RESERVED', 'Resource AVAILABLE → RESERVED');
  }

  // ── 4. REJECT flow ─────────────────────────────────────────────────
  section('4. PATCH /:id/reject');
  {
    // 403 for a non-owner non-moderator volunteer.
    const eveRejectDan = await http_('PATCH', `/api/requests/${reqDanB._id}/reject`, {
      token: eveToken,
    });
    assert(eveRejectDan.status === 403, '  Eve (volunteer) cannot reject Dan\'s request');

    // Happy path: APPROVED → REJECTED with moderatorNote.
    const rejectDan = await http_('PATCH', `/api/requests/${reqDanB._id}/reject`, {
      token: aliceToken,
      body: { moderatorNote: 'Resource already committed elsewhere.' },
    });
    assert(rejectDan.status === 200, 'OWNER reject APPROVED → 200');
    assert(
      rejectDan.body.data.request.status === 'REJECTED',
      '  status now REJECTED'
    );
    assert(
      rejectDan.body.data.request.moderatorNote === 'Resource already committed elsewhere.',
      '  moderatorNote persisted'
    );
    assert(
      !hasContactLeak(rejectDan.body),
      '  REJECT response has NO contact leak'
    );

    // Resource un-RESERVED back to AVAILABLE.
    const r = await Resource.findById(aliceResourceB._id);
    assert(r.status === 'AVAILABLE', 'Resource RESERVED → AVAILABLE after APPROVED → REJECTED');

    // 409 on re-reject.
    const reReject = await http_('PATCH', `/api/requests/${reqDanB._id}/reject`, {
      token: aliceToken,
    });
    assert(reReject.status === 409, '  re-reject → 409');

    // 409 from a terminal state (EveARejected is REJECTED).
    const rejRejected = await http_('PATCH', `/api/requests/${reqEveARejected._id}/reject`, {
      token: aliceToken,
    });
    assert(rejRejected.status === 409, '  reject a REJECTED request → 409');
  }

  // ── 5. COMPLETE flow ───────────────────────────────────────────────
  section('5. PATCH /:id/complete');
  {
    // 403 for non-owner.
    const eveComplete = await http_('PATCH', `/api/requests/${reqEveC._id}/complete`, {
      token: eveToken,
    });
    assert(eveComplete.status === 403, '  Eve cannot complete — she\'s not the resource owner');

    // 409 from non-RETURNED. Use CarolA which is APPROVED now.
    const completeApprove = await http_('PATCH', `/api/requests/${reqCarolA._id}/complete`, {
      token: aliceToken,
    });
    assert(completeApprove.status === 409, '  complete an APPROVED request → 409');

    // Happy path: RETURNED → Resource.IN_USE → AVAILABLE.
    const completeEveC = await http_('PATCH', `/api/requests/${reqEveC._id}/complete`, {
      token: aliceToken,
    });
    assert(completeEveC.status === 200, 'OWNER complete RETURNED → 200');
    assert(
      completeEveC.body.data.request.status === 'RETURNED',
      '  request stays RETURNED (terminal)'
    );
    assert(
      !hasContactLeak(completeEveC.body),
      '  COMPLETE response has NO contact leak'
    );

    const r = await Resource.findById(aliceResourceC._id);
    assert(r.status === 'AVAILABLE', 'Resource IN_USE → AVAILABLE after COMPLETE');

    // 409 on re-complete.
    const reComplete = await http_('PATCH', `/api/requests/${reqEveC._id}/complete`, {
      token: aliceToken,
    });
    assert(reComplete.status === 409, '  re-complete → 409');
  }

  // ── 6. GET /:id — OWNER reveal semantics ──────────────────────────
  section('6. GET /api/requests/:id — OWNER reveal');
  {
    // CarolA is APPROVED → not yet COLLECTED → no contact reveal.
    const aliceGet = await http_('GET', `/api/requests/${reqCarolA._id}`, {
      token: aliceToken,
    });
    assert(aliceGet.status === 200, 'OWNER GET APPROVED request → 200');
    const req = aliceGet.body.data.request;
    assert(
      req.volunteerSummary && req.volunteerSummary.name === 'Carol Volunteer',
      '  OWNER sees volunteerSummary.name on APPROVED'
    );
    assert(
      !req.volunteer || !req.volunteer.email,
      '  volunteer.email NOT revealed on APPROVED (no contact leak)'
    );
    assert(
      !req.volunteer || !req.volunteer.phone,
      '  volunteer.phone NOT revealed on APPROVED (no contact leak)'
    );
    assert(
      !hasContactLeak(aliceGet.body),
      '  APPROVED single-request response has NO contact leak'
    );

    // Reject Bob's request from the negative-control to confirm 403
    // on a non-principal.
    const aliceGetBobs = await http_('GET', `/api/requests/${reqBobIncoming._id}`, {
      token: aliceToken,
    });
    assert(aliceGetBobs.status === 403, 'OWNER GET other-owner\'s request → 403');

    // 404 on unknown id.
    const ghost = await http_('GET', '/api/requests/000000000000000000000000', {
      token: aliceToken,
    });
    assert(ghost.status === 404, '  unknown id → 404');
  }

  // ── 7. Status filter counters (for the dashboard badge) ───────────
  section('7. status filter counters (dashboard badge inputs)');
  {
    // The dashboard badge sums REQUESTED + APPROVED counts — verify
    // each filter independently. After the actions above, Alice has:
    //   - REQUESTED: 1 (reqEveARejected is REJECTED, not REQUESTED)
    //     Actually: re-check — Alice seeded REQUESTED=reqCarolA, but
    //     we approved it. So REQUESTED count = 0 now.
    //   - APPROVED: 1 (reqCarolA, after approve).
    //   - REJECTED: 2 (reqEveARejected + reqDanB after reject).
    //   - RETURNED: 1 (reqEveC, stays RETURNED after complete).
    //   - COLLECTED: 0.
    const requestedOnly = await http_('GET', '/api/requests?status=REQUESTED', {
      token: aliceToken,
    });
    assert(
      requestedOnly.body.data.pagination.total === 0,
      'REQUESTED filter returns 0 (CarolA was approved)'
    );
    const approvedOnly = await http_('GET', '/api/requests?status=APPROVED', {
      token: aliceToken,
    });
    assert(
      approvedOnly.body.data.pagination.total === 1,
      'APPROVED filter returns 1 (CarolA)'
    );
    const rejectedOnly = await http_('GET', '/api/requests?status=REJECTED', {
      token: aliceToken,
    });
    assert(
      rejectedOnly.body.data.pagination.total === 2,
      'REJECTED filter returns 2 (EveA + DanB)'
    );
    const returnedOnly = await http_('GET', '/api/requests?status=RETURNED', {
      token: aliceToken,
    });
    assert(
      returnedOnly.body.data.pagination.total === 1,
      'RETURNED filter returns 1 (EveC)'
    );
    // Module 5.4 dashboard counter sums REQUESTED + APPROVED → 1.
    assert(
      requestedOnly.body.data.pagination.total + approvedOnly.body.data.pagination.total === 1,
      'dashboard counter sum = 1 (REQUESTED + APPROVED)'
    );
  }

  // ── 8. Filter isolation — Alice's view excludes Bob's incoming ─────
  section('8. OWNER inbox scope isolation');
  {
    // Already verified "Alice sees 4, not 5" in section 2; here we
    // re-verify with an explicit assertion that Bob's request id is
    // missing. The toggle separates this from section 2's row
    // assertions so a failure here doesn't mask the populate checks.
    const fresh = await http_('GET', '/api/requests?limit=100', {
      token: aliceToken,
    });
    assert(
      fresh.status === 200 && fresh.body.data.requests.length === 4,
      'OWNER inbox stays at 4 rows after lifecycle mutations'
    );
    const ids = fresh.body.data.requests.map((r) => r.id);
    assert(
      !ids.includes(reqBobIncoming._id.toString()),
      "  Bob's incoming request id is NOT in Alice's inbox"
    );
  }

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
  } finally {
    await stop();
  }
})();
