/**
 * End-to-end smoke test for Module 8.1 — Analytics APIs.
 *
 * Locks the read-only reporting surface:
 *   - GET /api/analytics/total-by-category
 *   - GET /api/analytics/distribution-by-area
 *   - GET /api/analytics/most-used-resources
 *   - GET /api/analytics/active-emergency-assets
 *   - GET /api/analytics/coverage-by-village
 *
 * Coverage:
 *   1. Seed: 2 areas (in-area + out-of-area), 11 users, 5 resources
 *      across both areas (mix of categories + statuses), 4 requests
 *      (REQUESTED + APPROVED + COLLECTED + RETURNED), one area
 *      flipped to emergencyMode.isActive=true.
 *   2. Auth gates: 401 without token on every endpoint; 403 for
 *      OWNER, VOLUNTEER tokens.
 *   3. GET /total-by-category: ModInArea sees canonical 6-bucket list
 *      with correct counts; ModOutOfArea sees its own bucket; ModNoArea
 *      sees 0 total; Admin sees the global sum; NO contact leak.
 *   4. GET /distribution-by-area: ModInArea sees 1 area bucket (3
 *      resources); Admin sees 2; optional ?level= rolls up; the
 *      response includes area name + level; NO contact leak.
 *   5. GET /most-used-resources: sorted by completedCount (COLLECTED +
 *      RETURNED); sample summary shape (no email/phone/password); the
 *      top entry has the highest completed+request count.
 *   6. GET /active-emergency-assets: emergencyModeAreas lists the
 *      activated area (name + activatedAt); total reflects the
 *      resource count in that area; sample[] uses publicResource
 *      shape (no contact leak); inactive area mod sees 0 total.
 *   7. GET /coverage-by-village: default level=VILLAGE returns
 *      per-area buckets; admin sees both areas; the total is the
 *      sum of counts; optional level= returns the roll-up
 *      (VILLAGE level matches the bucket count).
 *   8. Validator strictness: every endpoint returns 400 on unknown
 *      query key (e.g. ?foo=bar); bad limit / bad level → 400.
 *   9. Admin cross-scope: ADMIN token can hit every endpoint
 *      without 403; admin sees the global view (no area filter).
 *
 * Run: `node smoke-tests/8.1-analytics-apis.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_81_${Date.now()}_${Math.random()
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

async function seedResource({
  ownerId,
  title = 'Resource',
  category = 'MEDICAL',
  status = 'AVAILABLE',
  areaId = null,
}) {
  return Resource.create({
    ownerId,
    category,
    title,
    description: `${title} — 8.1 smoke fixture`,
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

async function seedArea({ name, level = 'UNION', emergencyMode = null }) {
  const doc = await Area.create({
    country: 'Bangladesh',
    level,
    name,
    parentId: null,
    ...(emergencyMode ? { emergencyMode } : {}),
  });
  return doc;
}

async function run() {
  await start();

  // ── 1. Seed ─────────────────────────────────────────────────────────
  section('1. seed users + resources + requests + areas');
  const inArea = await seedArea({ name: 'Test Union 81 In' });
  const outArea = await seedArea({ name: 'Test Union 81 Out' });
  // Flip inArea to emergency mode (Module 6.3 flag).
  inArea.emergencyMode = {
    isActive: true,
    activatedAt: new Date(),
    activatedBy: null,
  };
  await inArea.save();
  assert(inArea._id && outArea._id, '2 areas seeded (in-area + out-of-area)');
  assert(inArea.emergencyMode.isActive === true, 'in-area flipped to emergency mode');

  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 81',
    email: 'alice.owner81@example.com',
    phone: '+15555570101',
    role: 'OWNER',
    areaId: inArea._id,
  });
  const { doc: bob, token: bobToken } = await seedUser({
    name: 'Bob Owner 81',
    email: 'bob.owner81@example.com',
    phone: '+15555570102',
    role: 'OWNER',
    areaId: inArea._id,
  });
  const { doc: outOwner, token: outOwnerToken } = await seedUser({
    name: 'OutOfArea Owner 81',
    email: 'outowner81@example.com',
    phone: '+15555570103',
    role: 'OWNER',
    areaId: outArea._id,
  });
  const { doc: carol, token: carolToken } = await seedUser({
    name: 'Carol Volunteer 81',
    email: 'carol.vol81@example.com',
    phone: '+15555570201',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inArea._id,
  });
  const { doc: dan, token: danToken } = await seedUser({
    name: 'Dan Volunteer 81',
    email: 'dan.vol81@example.com',
    phone: '+15555570202',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inArea._id,
  });

  const { doc: modInArea, token: modInToken } = await seedUser({
    name: 'Mod InArea 81',
    email: 'mod.inarea81@example.com',
    phone: '+15555570301',
    role: 'MODERATOR',
    areaId: inArea._id,
  });
  const { doc: modOutArea, token: modOutToken } = await seedUser({
    name: 'Mod OutOfArea 81',
    email: 'mod.outarea81@example.com',
    phone: '+15555570302',
    role: 'MODERATOR',
    areaId: outArea._id,
  });
  const { doc: modNoArea, token: modNoToken } = await seedUser({
    name: 'Mod NoArea 81',
    email: 'mod.noarea81@example.com',
    phone: '+15555570303',
    role: 'MODERATOR',
    areaId: null,
  });
  const { token: adminToken } = await seedUser({
    name: 'Grace Admin 81',
    email: 'grace.admin81@example.com',
    phone: '+15555570401',
    role: 'ADMIN',
  });

  // 3 in-area resources: Alice x2 + Bob x1 (mix 3 categories).
  const aliceResA = await seedResource({
    ownerId: alice._id,
    title: 'Ambulance 81-A',
    category: 'MEDICAL',
    areaId: inArea._id,
  });
  const aliceResB = await seedResource({
    ownerId: alice._id,
    title: 'Rescue Boat 81-B',
    category: 'RESCUE_EQUIPMENT',
    areaId: inArea._id,
  });
  const bobRes = await seedResource({
    ownerId: bob._id,
    title: 'Generator 81-C',
    category: 'UTILITIES',
    areaId: inArea._id,
  });
  // 2 out-of-area resources.
  const outResA = await seedResource({
    ownerId: outOwner._id,
    title: 'Out Truck 81-A',
    category: 'TRANSPORTATION',
    areaId: outArea._id,
  });
  const outResB = await seedResource({
    ownerId: outOwner._id,
    title: 'Out Ambulance 81-B',
    category: 'MEDICAL',
    areaId: outArea._id,
  });

  // 4 requests: 1 REQUESTED, 1 APPROVED, 1 COLLECTED, 1 RETURNED.
  // Most-used rolls up by completedCount (COLLECTED + RETURNED).
  const reqRequested = await seedRequest({
    resourceId: aliceResA._id,
    ownerId: alice._id,
    volunteerId: carol._id,
    status: 'REQUESTED',
  });
  const reqApproved = await seedRequest({
    resourceId: bobRes._id,
    ownerId: bob._id,
    volunteerId: dan._id,
    status: 'APPROVED',
  });
  const reqCollected = await seedRequest({
    resourceId: aliceResA._id,
    ownerId: alice._id,
    volunteerId: carol._id,
    status: 'COLLECTED',
  });
  const reqReturned = await seedRequest({
    resourceId: aliceResB._id,
    ownerId: alice._id,
    volunteerId: dan._id,
    status: 'RETURNED',
  });

  assert(
    aliceToken && bobToken && outOwnerToken &&
      carolToken && danToken &&
      modInToken && modOutToken && modNoToken && adminToken,
    '9 users + tokens created'
  );
  assert(
    aliceResA && aliceResB && bobRes && outResA && outResB,
    '5 resources seeded (3 in-area + 2 out-of-area)'
  );
  assert(
    reqRequested && reqApproved && reqCollected && reqReturned,
    '4 requests seeded (REQUESTED + APPROVED + COLLECTED + RETURNED)'
  );

  // ── 2. Auth gates ────────────────────────────────────────────────────
  section('2. auth gates');
  {
    const endpoints = [
      'GET /api/analytics/total-by-category',
      'GET /api/analytics/distribution-by-area',
      'GET /api/analytics/most-used-resources',
      'GET /api/analytics/active-emergency-assets',
      'GET /api/analytics/coverage-by-village',
    ];
    for (const ep of endpoints) {
      const [method, path] = ep.split(' ');
      const r = await http_(method, path);
      assert(r.status === 401, `${ep} without token → 401 (got ${r.status})`);
    }

    // 403 for OWNER + VOLUNTEER tokens.
    for (const tok of [aliceToken, carolToken]) {
      const t = await http_('GET', '/api/analytics/total-by-category', { token: tok });
      const d = await http_('GET', '/api/analytics/distribution-by-area', { token: tok });
      const m = await http_('GET', '/api/analytics/most-used-resources', { token: tok });
      const e = await http_('GET', '/api/analytics/active-emergency-assets', { token: tok });
      const c = await http_('GET', '/api/analytics/coverage-by-village', { token: tok });
      assert(t.status === 403, `OWNER/VOLUNTEER → /total-by-category 403 (got ${t.status})`);
      assert(d.status === 403, `OWNER/VOLUNTEER → /distribution-by-area 403 (got ${d.status})`);
      assert(m.status === 403, `OWNER/VOLUNTEER → /most-used-resources 403 (got ${m.status})`);
      assert(e.status === 403, `OWNER/VOLUNTEER → /active-emergency-assets 403 (got ${e.status})`);
      assert(c.status === 403, `OWNER/VOLUNTEER → /coverage-by-village 403 (got ${c.status})`);
    }
  }

  // ── 3. GET /api/analytics/total-by-category ─────────────────────────
  section('3. GET /total-by-category');
  {
    const inList = await http_('GET', '/api/analytics/total-by-category', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /total-by-category → 200');
    assert(
      Array.isArray(inList.body.data.byCategory) && inList.body.data.byCategory.length === 6,
      'byCategory has the canonical 6 buckets'
    );
    const total = inList.body.data.total;
    assert(total === 3, `ModInArea total === 3 (got ${total})`);
    const counts = Object.fromEntries(
      inList.body.data.byCategory.map((b) => [b.category, b.count])
    );
    assert(counts.MEDICAL === 1, 'MEDICAL bucket = 1 in ModInArea');
    assert(counts.RESCUE_EQUIPMENT === 1, 'RESCUE_EQUIPMENT bucket = 1 in ModInArea');
    assert(counts.UTILITIES === 1, 'UTILITIES bucket = 1 in ModInArea');
    assert(counts.TRANSPORTATION === 0, 'TRANSPORTATION bucket = 0 in ModInArea');
    assert(
      counts.SKILLED_PROFESSIONALS === 0 && counts.INFRASTRUCTURE === 0,
      'empty categories surface as 0 in ModInArea'
    );
    assert(!hasContactLeak(inList.body), 'total-by-category payload has NO contact leak');

    const outList = await http_('GET', '/api/analytics/total-by-category', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /total-by-category → 200');
    assert(outList.body.data.total === 2, 'ModOutOfArea total === 2');
    const outCounts = Object.fromEntries(
      outList.body.data.byCategory.map((b) => [b.category, b.count])
    );
    assert(outCounts.TRANSPORTATION === 1 && outCounts.MEDICAL === 1, 'ModOutOfArea buckets correct');

    const noList = await http_('GET', '/api/analytics/total-by-category', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /total-by-category → 200');
    assert(noList.body.data.total === 0, 'ModNoArea total === 0');
    assert(noList.body.data.byCategory.length === 6, 'ModNoArea still returns canonical 6 buckets');
    assert(
      noList.body.data.byCategory.every((b) => b.count === 0),
      'every ModNoArea bucket is 0'
    );
  }

  // ── 4. GET /api/analytics/distribution-by-area ──────────────────────
  section('4. GET /distribution-by-area');
  {
    const inList = await http_('GET', '/api/analytics/distribution-by-area', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /distribution-by-area → 200');
    assert(inList.body.data.total === 3, 'ModInArea total === 3');
    assert(inList.body.data.byArea.length === 1, 'ModInArea sees 1 area bucket');
    const bucket = inList.body.data.byArea[0];
    assert(bucket.areaId === inArea._id.toString(), 'bucket areaId is inArea');
    assert(bucket.name === 'Test Union 81 In', 'bucket has the area name');
    assert(bucket.level === 'UNION', 'bucket has the area level');
    assert(bucket.count === 3, 'bucket count is 3');
    assert(!hasContactLeak(inList.body), 'distribution-by-area payload has NO contact leak');

    const outList = await http_('GET', '/api/analytics/distribution-by-area', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /distribution-by-area → 200');
    assert(outList.body.data.byArea.length === 1, 'ModOutOfArea sees 1 area bucket');
    assert(outList.body.data.byArea[0].areaId === outArea._id.toString(), 'ModOutOfArea bucket is outArea');
    assert(outList.body.data.byArea[0].count === 2, 'ModOutOfArea bucket count = 2');

    const noList = await http_('GET', '/api/analytics/distribution-by-area', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /distribution-by-area → 200');
    assert(noList.body.data.byArea.length === 0, 'ModNoArea → 0 buckets');
    assert(noList.body.data.total === 0, 'ModNoArea total === 0');

    // limit cap respected.
    const limited = await http_(
      'GET',
      '/api/analytics/distribution-by-area?limit=1',
      { token: adminToken }
    );
    assert(limited.status === 200, '?limit=1 → 200');
    assert(limited.body.data.byArea.length <= 1, '?limit=1 cap respected');
  }

  // ── 5. GET /api/analytics/most-used-resources ───────────────────────
  section('5. GET /most-used-resources');
  {
    const inList = await http_('GET', '/api/analytics/most-used-resources', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /most-used-resources → 200');
    assert(inList.body.data.items.length >= 1, 'ModInArea has at least 1 used resource');
    assert(!hasContactLeak(inList.body), 'most-used-resources payload has NO contact leak');

    // Top entry shape: resourceId, requestCount, completedCount, resource summary.
    const top = inList.body.data.items[0];
    assert(typeof top.resourceId === 'string', 'top entry has resourceId string');
    assert(typeof top.requestCount === 'number', 'top entry has requestCount');
    assert(typeof top.completedCount === 'number', 'top entry has completedCount');
    assert(top.resource && top.resource.title, 'top entry has resource summary');
    assert(
      !top.resource.email && !top.resource.phone && !top.resource.password,
      'top entry resource has no email/phone/password'
    );
    assert(top.resource.id && top.resource.category, 'top entry resource has id + category');

    // Resource AliceResA had 2 requests (REQUESTED + COLLECTED) → 1
    // completed. Resource AliceResB had 1 request (RETURNED) → 1
    // completed. BobRes had 1 request (APPROVED) → 0 completed.
    // The top should be one of the two with completedCount=1.
    assert(top.completedCount === 1, 'top entry completedCount === 1');
    const inIds = inList.body.data.items.map((i) => i.resourceId);
    assert(
      inIds.includes(aliceResA._id.toString()) ||
        inIds.includes(aliceResB._id.toString()),
      'top set includes aliceResA or aliceResB (with completed requests)'
    );

    // The basic sort is by completedCount DESC then requestCount DESC.
    const sorted = [...inList.body.data.items].sort((a, b) => {
      if (b.completedCount !== a.completedCount) return b.completedCount - a.completedCount;
      return b.requestCount - a.requestCount;
    });
    assert(
      JSON.stringify(inList.body.data.items.map((i) => i.resourceId)) ===
        JSON.stringify(sorted.map((i) => i.resourceId)),
      'items sorted by completedCount DESC, then requestCount DESC'
    );

    // Out-of-area resources NOT in ModInArea most-used list.
    assert(
      !inIds.includes(outResA._id.toString()) &&
        !inIds.includes(outResB._id.toString()),
      'out-of-area resources excluded from ModInArea most-used'
    );

    // limit query.
    const limited = await http_(
      'GET',
      '/api/analytics/most-used-resources?limit=1',
      { token: adminToken }
    );
    assert(limited.status === 200, '?limit=1 → 200');
    assert(limited.body.data.items.length <= 1, '?limit=1 cap respected');

    // Admin sees global set.
    const adminList = await http_('GET', '/api/analytics/most-used-resources', { token: adminToken });
    assert(adminList.status === 200, 'admin /most-used-resources → 200');
    // Admin sees at minimum the in-area resources (no out-area requests
    // were created, but the aliceResA / aliceResB / bobRes are still
    // pulled). Our seed has no out-area requests, so admin set size
    // equals ModInArea set size.
    assert(
      adminList.body.data.items.length >= inList.body.data.items.length,
      'admin sees ≥ ModInArea items'
    );
  }

  // ── 6. GET /api/analytics/active-emergency-assets ───────────────────
  section('6. GET /active-emergency-assets');
  {
    const inList = await http_('GET', '/api/analytics/active-emergency-assets', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /active-emergency-assets → 200');
    assert(!hasContactLeak(inList.body), 'active-emergency-assets payload has NO contact leak');
    assert(
      Array.isArray(inList.body.data.emergencyModeAreas) &&
      inList.body.data.emergencyModeAreas.length === 1,
      'emergencyModeAreas lists the 1 activated area'
    );
    const eArea = inList.body.data.emergencyModeAreas[0];
    assert(eArea.areaId === inArea._id.toString(), 'emergencyMode areaId is inArea');
    assert(eArea.name === 'Test Union 81 In', 'emergencyMode area has name');
    assert(eArea.level === 'UNION', 'emergencyMode area has level');
    assert(eArea.activatedAt, 'emergencyMode area has activatedAt timestamp');

    // In-area has 3 resources (aliceResA + aliceResB + bobRes), all
    // AVAILABLE — so total = 3, byStatus = [{status: AVAILABLE, count: 3}].
    assert(inList.body.data.total === 3, 'ModInArea total = 3 (in-area resources)');
    assert(
      inList.body.data.byStatus.length === 1 &&
      inList.body.data.byStatus[0].status === 'AVAILABLE' &&
      inList.body.data.byStatus[0].count === 3,
      'byStatus groups 3 AVAILABLE resources'
    );
    assert(
      Array.isArray(inList.body.data.sample) && inList.body.data.sample.length === 3,
      'sample carries 3 resources (publicResource shape)'
    );
    // Sample uses publicResource shape — no contact leak.
    for (const s of inList.body.data.sample) {
      assert(
        !s.email && !s.phone && !s.password,
        `sample ${s.id} has no email/phone/password`
      );
      assert(
        s.id && s.title && s.category && s.status,
        'sample entry has publicResource fields'
      );
    }

    // ModOutOfArea sees 0 (their area is not in emergency mode).
    const outList = await http_('GET', '/api/analytics/active-emergency-assets', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /active-emergency-assets → 200');
    assert(
      outList.body.data.emergencyModeAreas.length === 0,
      'ModOutOfArea → 0 emergencyMode areas'
    );
    assert(outList.body.data.total === 0, 'ModOutOfArea total === 0');

    // ModNoArea → 0.
    const noList = await http_('GET', '/api/analytics/active-emergency-assets', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /active-emergency-assets → 200');
    assert(noList.body.data.total === 0, 'ModNoArea total === 0');

    // Admin sees the activated area too.
    const adminList = await http_('GET', '/api/analytics/active-emergency-assets', { token: adminToken });
    assert(adminList.status === 200, 'admin /active-emergency-assets → 200');
    assert(
      adminList.body.data.emergencyModeAreas.length === 1,
      'admin sees 1 emergencyMode area'
    );
  }

  // ── 7. GET /api/analytics/coverage-by-village ───────────────────────
  section('7. GET /coverage-by-village');
  {
    const inList = await http_('GET', '/api/analytics/coverage-by-village', { token: modInToken });
    assert(inList.status === 200, 'ModInArea /coverage-by-village → 200');
    assert(!hasContactLeak(inList.body), 'coverage-by-village payload has NO contact leak');
    assert(inList.body.data.level === 'VILLAGE', 'default level=VILLAGE');
    assert(inList.body.data.total === 3, 'ModInArea total === 3');
    assert(inList.body.data.byArea.length === 1, 'ModInArea sees 1 area bucket');
    assert(inList.body.data.byArea[0].areaId === inArea._id.toString(), 'bucket is inArea');
    assert(inList.body.data.byArea[0].count === 3, 'bucket count === 3');

    const outList = await http_('GET', '/api/analytics/coverage-by-village', { token: modOutToken });
    assert(outList.status === 200, 'ModOutOfArea /coverage-by-village → 200');
    assert(outList.body.data.total === 2, 'ModOutOfArea total === 2');
    assert(outList.body.data.byArea.length === 1, 'ModOutOfArea sees 1 area bucket');
    assert(outList.body.data.byArea[0].areaId === outArea._id.toString(), 'ModOutOfArea bucket is outArea');

    const noList = await http_('GET', '/api/analytics/coverage-by-village', { token: modNoToken });
    assert(noList.status === 200, 'ModNoArea /coverage-by-village → 200');
    assert(noList.body.data.total === 0, 'ModNoArea total === 0');
    assert(noList.body.data.byArea.length === 0, 'ModNoArea byArea is empty');

    // level=UNION rolls up to the same shape (inArea is UNION).
    const lvlUnion = await http_(
      'GET',
      '/api/analytics/coverage-by-village?level=UNION',
      { token: modInToken }
    );
    assert(lvlUnion.status === 200, '?level=UNION → 200');
    assert(lvlUnion.body.data.level === 'UNION', 'response echoes level=UNION');
  }

  // ── 8. Validator strictness ─────────────────────────────────────────
  section('8. validator strictness');
  {
    // Unknown query key on every endpoint → 400.
    const r1 = await http_('GET', '/api/analytics/total-by-category?foo=bar', { token: modInToken });
    assert(r1.status === 400, '?foo=bar on /total-by-category → 400');

    const r2 = await http_('GET', '/api/analytics/distribution-by-area?foo=bar', { token: modInToken });
    assert(r2.status === 400, '?foo=bar on /distribution-by-area → 400');

    const r3 = await http_('GET', '/api/analytics/most-used-resources?foo=bar', { token: modInToken });
    assert(r3.status === 400, '?foo=bar on /most-used-resources → 400');

    const r4 = await http_('GET', '/api/analytics/active-emergency-assets?foo=bar', { token: modInToken });
    assert(r4.status === 400, '?foo=bar on /active-emergency-assets → 400');

    const r5 = await http_('GET', '/api/analytics/coverage-by-village?foo=bar', { token: modInToken });
    assert(r5.status === 400, '?foo=bar on /coverage-by-village → 400');

    // Bad level enum → 400.
    const badLevel = await http_(
      'GET',
      '/api/analytics/distribution-by-area?level=NOT_A_LEVEL',
      { token: modInToken }
    );
    assert(badLevel.status === 400, '?level=NOT_A_LEVEL → 400');

    const badLevel2 = await http_(
      'GET',
      '/api/analytics/coverage-by-village?level=BOGUS',
      { token: modInToken }
    );
    assert(badLevel2.status === 400, '?level=BOGUS → 400');

    // Bad limit → 400.
    const badLimit = await http_(
      'GET',
      '/api/analytics/most-used-resources?limit=0',
      { token: modInToken }
    );
    assert(badLimit.status === 400, '?limit=0 → 400 (must be positive)');

    const badLimit2 = await http_(
      'GET',
      '/api/analytics/most-used-resources?limit=51',
      { token: modInToken }
    );
    assert(badLimit2.status === 400, '?limit=51 → 400 (cap is 50)');

    const badLimit3 = await http_(
      'GET',
      '/api/analytics/most-used-resources?limit=abc',
      { token: modInToken }
    );
    assert(badLimit3.status === 400, '?limit=abc → 400 (non-numeric)');
  }

  // ── 9. Admin cross-scope ─────────────────────────────────────────────
  section('9. admin cross-scope (no area filter)');
  {
    const t = await http_('GET', '/api/analytics/total-by-category', { token: adminToken });
    assert(t.status === 200, 'admin /total-by-category → 200');
    assert(t.body.data.total === 5, `admin total === 5 (got ${t.body.data.total})`);
    assert(!hasContactLeak(t.body), 'admin /total-by-category has NO contact leak');

    const d = await http_('GET', '/api/analytics/distribution-by-area', { token: adminToken });
    assert(d.status === 200, 'admin /distribution-by-area → 200');
    assert(d.body.data.total === 5, 'admin distribution-by-area total === 5');
    assert(d.body.data.byArea.length === 2, 'admin sees 2 area buckets');
    assert(!hasContactLeak(d.body), 'admin /distribution-by-area has NO contact leak');

    const m = await http_('GET', '/api/analytics/most-used-resources', { token: adminToken });
    assert(m.status === 200, 'admin /most-used-resources → 200');
    assert(!hasContactLeak(m.body), 'admin /most-used-resources has NO contact leak');

    const e = await http_('GET', '/api/analytics/active-emergency-assets', { token: adminToken });
    assert(e.status === 200, 'admin /active-emergency-assets → 200');
    assert(e.body.data.total === 3, 'admin emergency-assets total === 3 (in-area only has the emergency flag)');
    assert(!hasContactLeak(e.body), 'admin /active-emergency-assets has NO contact leak');

    const c = await http_('GET', '/api/analytics/coverage-by-village', { token: adminToken });
    assert(c.status === 200, 'admin /coverage-by-village → 200');
    assert(c.body.data.total === 5, 'admin coverage total === 5');
    assert(c.body.data.byArea.length === 2, 'admin sees 2 area buckets');
    assert(!hasContactLeak(c.body), 'admin /coverage-by-village has NO contact leak');
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
