/**
 * End-to-end smoke test for Module 6.1 — Moderator APIs.
 *
 * Locks the read-only oversight surface:
 *   - GET /api/moderator/area-resources
 *   - GET /api/moderator/pending-requests
 *   - GET /api/moderator/volunteers
 *   - GET /api/moderator/owners
 *
 * Coverage:
 *   1. Seed: 2 areas (in-area + out-of-area), 11 users (Alice/Bob
 *      owners, Carol verified / Dan verified / Eve unverified
 *      volunteers, OutOfAreaOwner, OutOfAreaVol, ModInArea,
 *      ModOutOfArea, ModNoArea, Admin), 3 in-area + 2 out-of-area
 *      resources, 2 in-area + 1 out-of-area requests.
 *   2. Auth gates: 401 without token on every endpoint; 403 for
 *      OWNER, VOLUNTEER tokens.
 *   3. GET /area-resources: ModInArea sees 3 in-area, ModOutOfArea
 *      sees 2 out-of-area, ModNoArea sees 0; populated shape
 *      matches publicResource() (NO email/phone/password); filters
 *      (status, category, q) compose correctly.
 *   4. GET /pending-requests: ModInArea sees 1 REQUESTED row,
 *      ModOutOfArea sees 1, ModNoArea sees 0; pagination echoed;
 *      volunteerSummary.name + resource summary populated; NO
 *      contact leak; `?status=APPROVED` rejected by the strict
 *      validator.
 *   5. GET /volunteers: ModInArea sees 2 verified (Carol + Dan)
 *      + Eve (unverified) by default; ModOutOfArea sees 1;
 *      ModNoArea sees 0; ?isVerified=true narrows to verified;
 *      ?isVerified=false narrows to unverified; response has
 *      name + role + id + isVerified + isActive + areaId, NO
 *      email/phone/password.
 *   6. GET /owners: ModInArea sees 2 (Alice + Bob), ModOutOfArea
 *      sees 1, ModNoArea sees 0; same privacy strip.
 *   7. Validator strictness: every endpoint returns 400 on unknown
 *      query key; page/limit regex enforced (non-numeric → 400).
 *   8. Admin cross-scope: ADMIN token can hit every endpoint
 *      without 403; admin sees the global view (no area filter).
 *
 * Run: `node smoke-tests/6.1-moderator-apis.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_61_${Date.now()}_${Math.random()
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
    description: `${title} — 6.1 smoke fixture`,
    condition: 'GOOD',
    status,
    areaId: areaId || undefined,
  });
}

async function seedRequest({ resourceId, ownerId, volunteerId, status = 'REQUESTED' }) {
  const doc = new ResourceRequest({
    resourceId,
    ownerId,
    volunteerId,
    status,
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
  const inAreaId = await seedArea({ name: 'Test Union 61 In' });
  const outAreaId = await seedArea({ name: 'Test Union 61 Out' });
  assert(inAreaId && outAreaId, '2 areas seeded (in-area + out-of-area)');

  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 61',
    email: 'alice.owner61@example.com',
    phone: '+15555560101',
    role: 'OWNER',
    areaId: inAreaId,
  });
  const { doc: bob, token: bobToken } = await seedUser({
    name: 'Bob Owner 61',
    email: 'bob.owner61@example.com',
    phone: '+15555560102',
    role: 'OWNER',
    areaId: inAreaId,
  });
  const { doc: outOwner, token: outOwnerToken } = await seedUser({
    name: 'OutOfArea Owner 61',
    email: 'outowner61@example.com',
    phone: '+15555560103',
    role: 'OWNER',
    areaId: outAreaId,
  });

  const { doc: carol, token: carolToken } = await seedUser({
    name: 'Carol Volunteer 61',
    email: 'carol.vol61@example.com',
    phone: '+15555560201',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });
  const { doc: dan, token: danToken } = await seedUser({
    name: 'Dan Volunteer 61',
    email: 'dan.vol61@example.com',
    phone: '+15555560202',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve Volunteer 61',
    email: 'eve.vol61@example.com',
    phone: '+15555560203',
    role: 'VOLUNTEER',
    isVerified: false,
    areaId: inAreaId,
  });
  const { doc: outVol, token: outVolToken } = await seedUser({
    name: 'OutOfArea Volunteer 61',
    email: 'outvol61@example.com',
    phone: '+15555560204',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: outAreaId,
  });

  const { doc: modInArea, token: modInToken } = await seedUser({
    name: 'Mod InArea 61',
    email: 'mod.inarea61@example.com',
    phone: '+15555560301',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modOutArea, token: modOutToken } = await seedUser({
    name: 'Mod OutOfArea 61',
    email: 'mod.outarea61@example.com',
    phone: '+15555560302',
    role: 'MODERATOR',
    areaId: outAreaId,
  });
  const { doc: modNoArea, token: modNoToken } = await seedUser({
    name: 'Mod NoArea 61',
    email: 'mod.noarea61@example.com',
    phone: '+15555560303',
    role: 'MODERATOR',
    areaId: null,
  });
  const { token: adminToken } = await seedUser({
    name: 'Grace Admin 61',
    email: 'grace.admin61@example.com',
    phone: '+15555560401',
    role: 'ADMIN',
  });

  // 3 in-area resources: Alice x2 + Bob x1 (mix MEDICAL + RESCUE_EQUIPMENT)
  const aliceResA = await seedResource({
    ownerId: alice._id,
    title: 'Ambulance 61-A',
    category: 'MEDICAL',
    areaId: inAreaId,
  });
  const aliceResB = await seedResource({
    ownerId: alice._id,
    title: 'Rescue Boat 61-B',
    category: 'RESCUE_EQUIPMENT',
    areaId: inAreaId,
  });
  const bobRes = await seedResource({
    ownerId: bob._id,
    title: 'Generator 61-C',
    category: 'UTILITIES',
    areaId: inAreaId,
  });
  // 2 out-of-area resources
  const outResA = await seedResource({
    ownerId: outOwner._id,
    title: 'Out Truck 61-A',
    category: 'TRANSPORTATION',
    areaId: outAreaId,
  });
  const outResB = await seedResource({
    ownerId: outOwner._id,
    title: 'Out Ambulance 61-B',
    category: 'MEDICAL',
    areaId: outAreaId,
  });

  // 2 in-area requests: 1 REQUESTED (the queue item) + 1 APPROVED
  const reqInRequested = await seedRequest({
    resourceId: aliceResA._id,
    ownerId: alice._id,
    volunteerId: carol._id,
    status: 'REQUESTED',
  });
  const reqInApproved = await seedRequest({
    resourceId: bobRes._id,
    ownerId: bob._id,
    volunteerId: dan._id,
    status: 'APPROVED',
  });
  // 1 out-of-area request
  const reqOutRequested = await seedRequest({
    resourceId: outResA._id,
    ownerId: outOwner._id,
    volunteerId: outVol._id,
    status: 'REQUESTED',
  });

  assert(
    aliceToken && bobToken && outOwnerToken &&
      carolToken && danToken && eveToken && outVolToken &&
      modInToken && modOutToken && modNoToken && adminToken,
    'all 11 users + tokens created'
  );
  assert(
    aliceResA && aliceResB && bobRes && outResA && outResB,
    '5 resources seeded (3 in-area + 2 out-of-area)'
  );
  assert(
    reqInRequested && reqInApproved && reqOutRequested,
    '3 requests seeded (2 in-area + 1 out-of-area)'
  );

  // ── 2. Auth gates ────────────────────────────────────────────────────
  section('2. auth gates');
  {
    const endpoints = [
      'GET /api/moderator/area-resources',
      'GET /api/moderator/pending-requests',
      'GET /api/moderator/volunteers',
      'GET /api/moderator/owners',
    ];
    for (const ep of endpoints) {
      const [method, path] = ep.split(' ');
      const r = await http_(method, path);
      assert(r.status === 401, `${ep} without token → 401`);
    }

    // 403 for OWNER + VOLUNTEER tokens.
    for (const tok of [aliceToken, carolToken]) {
      const ar = await http_('GET', '/api/moderator/area-resources', { token: tok });
      const pr = await http_('GET', '/api/moderator/pending-requests', { token: tok });
      const vr = await http_('GET', '/api/moderator/volunteers', { token: tok });
      const or = await http_('GET', '/api/moderator/owners', { token: tok });
      assert(ar.status === 403, `OWNER/VOLUNTEER → /area-resources 403 (got ${ar.status})`);
      assert(pr.status === 403, `OWNER/VOLUNTEER → /pending-requests 403 (got ${pr.status})`);
      assert(vr.status === 403, `OWNER/VOLUNTEER → /volunteers 403 (got ${vr.status})`);
      assert(or.status === 403, `OWNER/VOLUNTEER → /owners 403 (got ${or.status})`);
    }
  }

  // ── 3. GET /api/moderator/area-resources ─────────────────────────────
  section('3. GET /area-resources');
  {
    const inList = await http_('GET', '/api/moderator/area-resources', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /area-resources → 200');
    assert(
      inList.body.data.resources.length === 3,
      `ModInArea sees 3 in-area resources (got ${inList.body.data.resources.length})`
    );
    assert(
      inList.body.data.pagination.total === 3,
      'pagination.total === 3'
    );
    assert(
      !hasContactLeak(inList.body),
      'area-resources payload has NO email/phone/password leak'
    );

    const inIds = inList.body.data.resources.map((r) => r.id);
    assert(
      !inIds.includes(outResA._id.toString()) &&
        !inIds.includes(outResB._id.toString()),
      'out-of-area resources excluded from ModInArea list'
    );

    // Populate shape sanity — first resource has every publicResource field.
    const sample = inList.body.data.resources[0];
    for (const key of [
      'id',
      'ownerId',
      'category',
      'title',
      'description',
      'photos',
      'status',
      'areaId',
      'createdAt',
      'updatedAt',
    ]) {
      assert(key in sample, `sample resource has "${key}"`);
    }

    // Privacy strip — explicit check the response has no email/phone
    // keys even at the resource object level.
    for (const r of inList.body.data.resources) {
      assert(
        !r.email && !r.phone && !r.password,
        `resource ${r.id} carries no email/phone/password`
      );
    }

    const outList = await http_('GET', '/api/moderator/area-resources', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /area-resources → 200');
    assert(
      outList.body.data.resources.length === 2,
      'ModOutOfArea sees 2 out-of-area resources'
    );

    const noList = await http_('GET', '/api/moderator/area-resources', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /area-resources → 200');
    assert(
      noList.body.data.resources.length === 0,
      'ModNoArea sees 0 resources'
    );
    assert(
      noList.body.data.pagination.total === 0,
      'ModNoArea pagination.total === 0'
    );
    assert(!hasContactLeak(noList.body), 'ModNoArea empty payload has no contact leak');

    // Filters compose: status=MEDICAL + area scope.
    const medList = await http_(
      'GET',
      '/api/moderator/area-resources?status=AVAILABLE&category=MEDICAL',
      { token: modInToken }
    );
    assert(medList.status === 200, 'ModInArea /area-resources?status=AVAILABLE&category=MEDICAL → 200');
    assert(
      medList.body.data.resources.length === 1,
      'category=MEDICAL filter narrows to 1 (Ambulance 61-A)'
    );
    assert(
      medList.body.data.resources.every(
        (r) => r.status === 'AVAILABLE' && r.category === 'MEDICAL'
      ),
      'composed filters honored'
    );

    // q substring on title.
    const qList = await http_(
      'GET',
      '/api/moderator/area-resources?q=Ambulance',
      { token: modInToken }
    );
    assert(qList.status === 200, '?q=Ambulance → 200');
    assert(
      qList.body.data.resources.length === 1 &&
        qList.body.data.resources[0].title === 'Ambulance 61-A',
      'q filter narrows to Ambulance 61-A'
    );

    // Bad status → 400.
    const badStatus = await http_(
      'GET',
      '/api/moderator/area-resources?status=NOT_A_STATUS',
      { token: modInToken }
    );
    assert(badStatus.status === 400, '?status=NOT_A_STATUS → 400');

    // Bad category → 400.
    const badCat = await http_(
      'GET',
      '/api/moderator/area-resources?category=NOT_A_CATEGORY',
      { token: modInToken }
    );
    assert(badCat.status === 400, '?category=NOT_A_CATEGORY → 400');
  }

  // ── 4. GET /api/moderator/pending-requests ───────────────────────────
  section('4. GET /pending-requests');
  {
    const inList = await http_('GET', '/api/moderator/pending-requests', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /pending-requests → 200');
    assert(
      inList.body.data.requests.length === 1,
      'ModInArea sees 1 REQUESTED in-area'
    );
    assert(
      inList.body.data.requests[0].id === reqInRequested._id.toString(),
      'the row is the in-area REQUESTED request'
    );
    assert(
      inList.body.data.pagination.total === 1,
      'pagination.total === 1'
    );
    assert(
      !hasContactLeak(inList.body),
      'pending-requests payload has NO contact leak'
    );

    // volunteerSummary + resource summary populated.
    const row = inList.body.data.requests[0];
    assert(
      row.volunteerSummary && row.volunteerSummary.name === 'Carol Volunteer 61',
      'volunteerSummary.name === "Carol Volunteer 61"'
    );
    assert(
      row.volunteerSummary.id === carol._id.toString(),
      'volunteerSummary.id is the volunteer id'
    );
    assert(
      row.resource && row.resource.title === 'Ambulance 61-A' &&
        row.resource.category === 'MEDICAL',
      'resource summary has title + category'
    );
    assert(
      row.resource.status === 'AVAILABLE',
      'resource.status=AVAILABLE (seed default)'
    );

    // — Strict validator: ?status=APPROVED must be rejected.
    const badStatus = await http_(
      'GET',
      '/api/moderator/pending-requests?status=APPROVED',
      { token: modInToken }
    );
    assert(badStatus.status === 400, '?status=APPROVED → 400 (strict schema)');

    // Out-of-area moderator sees their own row.
    const outList = await http_('GET', '/api/moderator/pending-requests', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /pending-requests → 200');
    assert(
      outList.body.data.requests.length === 1 &&
        outList.body.data.requests[0].id === reqOutRequested._id.toString(),
      'ModOutOfArea sees the out-of-area REQUESTED'
    );
    // Confirm in-area request id does NOT leak.
    assert(
      !outList.body.data.requests
        .map((r) => r.id)
        .includes(reqInRequested._id.toString()),
      'in-area request id does NOT leak to ModOutOfArea'
    );

    // No-area moderator → [].
    const noList = await http_('GET', '/api/moderator/pending-requests', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /pending-requests → 200');
    assert(
      noList.body.data.requests.length === 0,
      'ModNoArea sees 0 pending requests'
    );

    // The APPROVED in-area request is NOT in the queue (status filter
    // is hard-coded REQUESTED).
    const inIds = inList.body.data.requests.map((r) => r.id);
    assert(
      !inIds.includes(reqInApproved._id.toString()),
      'APPROVED in-area request NOT in pending-requests queue'
    );
  }

  // ── 5. GET /api/moderator/volunteers ─────────────────────────────────
  section('5. GET /volunteers');
  {
    const inList = await http_('GET', '/api/moderator/volunteers', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /volunteers → 200');
    assert(
      inList.body.data.volunteers.length === 3,
      'ModInArea sees 3 in-area volunteers (Carol + Dan + Eve)'
    );
    assert(
      inList.body.data.pagination.total === 3,
      'pagination.total === 3'
    );
    assert(
      !hasContactLeak(inList.body),
      'volunteers payload has NO contact leak'
    );

    // Every entry has the publicUserDirectory shape.
    for (const v of inList.body.data.volunteers) {
      assert(
        v.id && v.name && v.role === 'VOLUNTEER' &&
          'isVerified' in v && 'isActive' in v && 'areaId' in v &&
          v.createdAt && v.updatedAt,
        `volunteer ${v.id} has publicUserDirectory shape`
      );
    }

    // isVerified=true filter narrows to Carol + Dan.
    const verified = await http_(
      'GET',
      '/api/moderator/volunteers?isVerified=true',
      { token: modInToken }
    );
    assert(verified.status === 200, '?isVerified=true → 200');
    assert(
      verified.body.data.volunteers.length === 2 &&
        verified.body.data.volunteers.every((v) => v.isVerified === true),
      '?isVerified=true narrows to 2 verified (Carol + Dan)'
    );
    const verifiedIds = verified.body.data.volunteers.map((v) => v.id);
    assert(
      verifiedIds.includes(carol._id.toString()) &&
        verifiedIds.includes(dan._id.toString()) &&
        !verifiedIds.includes(eve._id.toString()),
      'verified set includes Carol + Dan, excludes Eve'
    );

    // isVerified=false filter narrows to Eve.
    const unverified = await http_(
      'GET',
      '/api/moderator/volunteers?isVerified=false',
      { token: modInToken }
    );
    assert(unverified.status === 200, '?isVerified=false → 200');
    assert(
      unverified.body.data.volunteers.length === 1 &&
        unverified.body.data.volunteers[0].id === eve._id.toString(),
      '?isVerified=false narrows to Eve (unverified)'
    );

    // Out-of-area volunteer NOT in ModInArea list.
    const inIds = inList.body.data.volunteers.map((v) => v.id);
    assert(
      !inIds.includes(outVol._id.toString()),
      'out-of-area volunteer NOT in ModInArea list'
    );

    // ModOutOfArea sees only the out-of-area volunteer.
    const outList = await http_('GET', '/api/moderator/volunteers', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /volunteers → 200');
    assert(
      outList.body.data.volunteers.length === 1 &&
        outList.body.data.volunteers[0].id === outVol._id.toString(),
      'ModOutOfArea sees only the out-of-area volunteer'
    );

    // ModNoArea → 0.
    const noList = await http_('GET', '/api/moderator/volunteers', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /volunteers → 200');
    assert(
      noList.body.data.volunteers.length === 0,
      'ModNoArea sees 0 volunteers'
    );

    // Bad isVerified → 400.
    const badIv = await http_(
      'GET',
      '/api/moderator/volunteers?isVerified=maybe',
      { token: modInToken }
    );
    assert(badIv.status === 400, '?isVerified=maybe → 400 (strict validator)');
  }

  // ── 6. GET /api/moderator/owners ─────────────────────────────────────
  section('6. GET /owners');
  {
    const inList = await http_('GET', '/api/moderator/owners', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /owners → 200');
    assert(
      inList.body.data.owners.length === 2,
      'ModInArea sees 2 in-area owners (Alice + Bob)'
    );
    assert(
      inList.body.data.pagination.total === 2,
      'pagination.total === 2'
    );
    assert(
      !hasContactLeak(inList.body),
      'owners payload has NO contact leak'
    );

    const inIds = inList.body.data.owners.map((o) => o.id);
    assert(
      inIds.includes(alice._id.toString()) &&
        inIds.includes(bob._id.toString()) &&
        !inIds.includes(outOwner._id.toString()),
      'ModInArea owner set = {Alice, Bob}; out-of-area excluded'
    );

    // Every entry has the publicUserDirectory shape.
    for (const o of inList.body.data.owners) {
      assert(
        o.id && o.name && o.role === 'OWNER' &&
          'isVerified' in o && 'isActive' in o && 'areaId' in o,
        `owner ${o.id} has publicUserDirectory shape`
      );
    }

    const outList = await http_('GET', '/api/moderator/owners', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /owners → 200');
    assert(
      outList.body.data.owners.length === 1 &&
        outList.body.data.owners[0].id === outOwner._id.toString(),
      'ModOutOfArea sees only the out-of-area owner'
    );

    const noList = await http_('GET', '/api/moderator/owners', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /owners → 200');
    assert(
      noList.body.data.owners.length === 0,
      'ModNoArea sees 0 owners'
    );
  }

  // ── 7. Validator strictness ─────────────────────────────────────────
  section('7. validator strictness');
  {
    // Unknown query key on every endpoint → 400.
    const r1 = await http_('GET', '/api/moderator/area-resources?foo=bar', { token: modInToken });
    assert(r1.status === 400, '?foo=bar on /area-resources → 400');

    const r2 = await http_('GET', '/api/moderator/pending-requests?foo=bar', { token: modInToken });
    assert(r2.status === 400, '?foo=bar on /pending-requests → 400');

    const r3 = await http_('GET', '/api/moderator/volunteers?foo=bar', { token: modInToken });
    assert(r3.status === 400, '?foo=bar on /volunteers → 400');

    const r4 = await http_('GET', '/api/moderator/owners?foo=bar', { token: modInToken });
    assert(r4.status === 400, '?foo=bar on /owners → 400');

    // Non-numeric page → 400.
    const badPage = await http_('GET', '/api/moderator/area-resources?page=abc', { token: modInToken });
    assert(badPage.status === 400, '?page=abc on /area-resources → 400');

    const badPage2 = await http_('GET', '/api/moderator/volunteers?page=0', { token: modInToken });
    assert(badPage2.status === 400, '?page=0 (must be positive) → 400');

    const badLimit = await http_('GET', '/api/moderator/owners?limit=-5', { token: modInToken });
    assert(badLimit.status === 400, '?limit=-5 → 400');
  }

  // ── 8. Admin cross-scope ─────────────────────────────────────────────
  section('8. admin cross-scope (no area filter)');
  {
    const ar = await http_('GET', '/api/moderator/area-resources', { token: adminToken });
    assert(ar.status === 200, 'admin /area-resources → 200');
    assert(
      ar.body.data.resources.length === 5,
      `admin sees 5 resources globally (in + out) (got ${ar.body.data.resources.length})`
    );
    assert(
      !hasContactLeak(ar.body),
      'admin /area-resources has NO contact leak'
    );

    const pr = await http_('GET', '/api/moderator/pending-requests', { token: adminToken });
    assert(pr.status === 200, 'admin /pending-requests → 200');
    assert(
      pr.body.data.requests.length === 2,
      'admin sees 2 REQUESTED requests (in + out)'
    );
    assert(
      !hasContactLeak(pr.body),
      'admin /pending-requests has NO contact leak'
    );

    const vr = await http_('GET', '/api/moderator/volunteers', { token: adminToken });
    assert(vr.status === 200, 'admin /volunteers → 200');
    assert(
      vr.body.data.volunteers.length === 4,
      'admin sees 4 volunteers globally (Carol + Dan + Eve + outVol)'
    );
    assert(
      !hasContactLeak(vr.body),
      'admin /volunteers has NO contact leak'
    );

    const or = await http_('GET', '/api/moderator/owners', { token: adminToken });
    assert(or.status === 200, 'admin /owners → 200');
    assert(
      or.body.data.owners.length === 3,
      'admin sees 3 owners globally (Alice + Bob + outOwner)'
    );
    assert(
      !hasContactLeak(or.body),
      'admin /owners has NO contact leak'
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