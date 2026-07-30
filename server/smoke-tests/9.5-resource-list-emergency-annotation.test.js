/**
 * End-to-end smoke test for Module 9.5 — resource list / single
 * emergency annotation + perf regression guard.
 *
 * Locks:
 *   - GET /api/resources (list) annotates each row with
 *     `areaEmergencyActive: boolean`.
 *   - GET /api/resources/:id (single) annotates the same field.
 *   - Bulk annotation uses ONE HIERARCHY query + ONE CIRCLE query
 *     for the whole page (perf regression).
 *
 * Coverage:
 *   1. Seed: 2 areas (DISTRICT + UNION) + 6 resources (3 in UNION,
 *      3 in SIBLING_UNION) + 1 owner in each area + 1 verified
 *      volunteer token.
 *   2. Initially no emergency → every resource has
 *      `areaEmergencyActive: false`.
 *   3. Activate HIERARCHY at DISTRICT root → ALL 6 resources flip
 *      to true (DISTRICT is an ancestor of both unions).
 *   4. Deactivate → all flip back to false.
 *   5. Activate at UNION root → only the 3 in that union flip; the
 *      3 in SIBLING_UNION stay false.
 *   6. CIRCLE activation covering the SIBLING_UNION centroid → its
 *      3 resources flip to true; UNION's stay at the HIERARCHY
 *      state (still false, since the district-level activation is
 *      gone).
 *   7. Performance guard: a single bulk request annotates a page of
 *      ≥10 resources without making per-row EmergencyActivation
 *      queries (we wrap `isAreaInEmergencyBulk` to count calls).
 *   8. GET /:id reflects the same flag.
 *
 * Run: `node smoke-tests/9.5-resource-list-emergency-annotation.test.js`
 * from `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_95_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
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
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
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
    try { await mongoose.connection.dropDatabase(); } catch {}
    await mongoose.disconnect();
  }
}

async function run() {
  section('1. seed 2 areas + 6 resources + 1 volunteer');
  const district = await mongoose.connection.collection('areas').insertOne({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: 'D-95',
    parentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const union = await mongoose.connection.collection('areas').insertOne({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'UN-95',
    parentId: district.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const siblingUnion = await mongoose.connection.collection('areas').insertOne({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'SiblingUN-95',
    parentId: district.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const unionHex = union.insertedId.toString();
  const siblingHex = siblingUnion.insertedId.toString();

  const owner = await User.create({
    name: 'Owner-95',
    email: 'owner-95@example.com',
    phone: '+8801710000951',
    password: 'long-enough-password',
    role: 'OWNER',
    isActive: true,
    areaId: union.insertedId,
  });
  const otherOwner = await User.create({
    name: 'OwnerSibling-95',
    email: 'owner-sib-95@example.com',
    phone: '+8801710000952',
    password: 'long-enough-password',
    role: 'OWNER',
    isActive: true,
    areaId: siblingUnion.insertedId,
  });
  const vol = await User.create({
    name: 'Vol-95',
    email: 'vol-95@example.com',
    phone: '+8801710000953',
    password: 'long-enough-password',
    role: 'VOLUNTEER',
    isVerified: true,
    isActive: true,
  });
  const volTok = signJwt({ id: vol._id.toString(), role: 'VOLUNTEER' });

  // 3 resources in union, 3 in siblingUnion. Spread their createdAt
  // so the sort order is deterministic.
  const unionResources = [];
  for (let i = 0; i < 3; i++) {
    const r = await Resource.create({
      ownerId: owner._id,
      category: 'MEDICAL',
      title: `Union resource ${i}`,
      description: `union resource description ${i}`,
      capacity: 1,
      condition: 'GOOD',
      status: 'AVAILABLE',
      areaId: unionHex,
      createdAt: new Date(Date.now() - (i + 1) * 60_000),
    });
    unionResources.push(r);
  }
  const siblingResources = [];
  for (let i = 0; i < 3; i++) {
    const r = await Resource.create({
      ownerId: otherOwner._id,
      category: 'TRANSPORTATION',
      title: `Sibling resource ${i}`,
      description: `sibling resource description ${i}`,
      capacity: 1,
      condition: 'GOOD',
      status: 'AVAILABLE',
      areaId: siblingHex,
      createdAt: new Date(Date.now() - (i + 1) * 60_000),
    });
    siblingResources.push(r);
  }
  assert(unionResources.length === 3 && siblingResources.length === 3, '  6 resources seeded');

  section('2. initially all resources have areaEmergencyActive=false');
  {
    const list = await http_('GET', '/api/resources', { token: volTok });
    assert(list.status === 200, '  GET /api/resources → 200');
    const resources = list.body.data.resources;
    assert(resources.length === 6, '  6 resources in page');
    for (const r of resources) {
      assert(r.areaEmergencyActive === false, `  resource ${r.title}: areaEmergencyActive=false`);
    }
  }

  section('3. HIERARCHY activation at DISTRICT → all 6 flip');
  await EmergencyActivation.create({
    rootAreaId: district.insertedId,
    level: 'DISTRICT',
    scope: 'HIERARCHY',
    descendantAreaIds: [district.insertedId, union.insertedId, siblingUnion.insertedId],
    message: 'district flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
  });
  {
    const list = await http_('GET', '/api/resources', { token: volTok });
    const resources = list.body.data.resources;
    const unionCount = resources.filter(
      (r) => r.areaId === unionHex && r.areaEmergencyActive === true
    ).length;
    const sibCount = resources.filter(
      (r) => r.areaId === siblingHex && r.areaEmergencyActive === true
    ).length;
    assert(unionCount === 3, '  3 union resources flipped to true');
    assert(sibCount === 3, '  3 sibling resources flipped to true');
  }

  section('4. deactivate → all back to false');
  await EmergencyActivation.updateMany({}, { isActive: false });
  {
    const list = await http_('GET', '/api/resources', { token: volTok });
    const resources = list.body.data.resources;
    assert(
      resources.every((r) => r.areaEmergencyActive === false),
      '  all resources back to false'
    );
  }

  section('5. HIERARCHY activation at UNION → only union flips');
  await EmergencyActivation.create({
    rootAreaId: union.insertedId,
    level: 'UNION',
    scope: 'HIERARCHY',
    descendantAreaIds: [union.insertedId],
    message: 'union flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
  });
  {
    const list = await http_('GET', '/api/resources', { token: volTok });
    const resources = list.body.data.resources;
    const unionTrue = resources.filter(
      (r) => r.areaId === unionHex && r.areaEmergencyActive === true
    ).length;
    const sibFalse = resources.filter(
      (r) => r.areaId === siblingHex && r.areaEmergencyActive === false
    ).length;
    assert(unionTrue === 3, '  3 union resources flipped to true');
    assert(sibFalse === 3, '  3 sibling resources still false');
  }

  section('6. CIRCLE activation covering sibling centroid');
  // Sibling has no explicit location; we'll set one of its resources
  // inside the circle to test the CIRCLE path. First deactivate the
  // UNION HIERARCHY activation so we can isolate the CIRCLE signal.
  await EmergencyActivation.updateMany({}, { isActive: false });
  // Use a center slightly inside sibling's resources (which all sit
  // at union/sibling centroids). For CIRCLE we use resource location.
  const unionCentroid = [90.4, 23.8];
  const siblingCentroid = [91.4, 24.8];
  // Set one sibling resource's location inside a small circle.
  await Resource.findByIdAndUpdate(siblingResources[0]._id, {
    location: { type: 'Point', coordinates: siblingCentroid },
  });
  await EmergencyActivation.create({
    rootAreaId: siblingUnion.insertedId,
    level: 'UNION',
    scope: 'CIRCLE',
    center: { type: 'Point', coordinates: siblingCentroid },
    radiusMeters: 5000,
    descendantAreaIds: [],
    message: 'sibling circle',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
  });
  {
    const list = await http_('GET', '/api/resources', { token: volTok });
    const resources = list.body.data.resources;
    // Per-areaId CIRCLE semantics: if ANY resource at this area
    // lands inside the circle, every resource at that area flips.
    const sibResources = resources.filter(
      (r) => r.areaId === siblingHex
    );
    const unionResourcesList = resources.filter(
      (r) => r.areaId === unionHex
    );
    assert(
      sibResources.length === 3 && sibResources.every((r) => r.areaEmergencyActive === true),
      '  all 3 sibling resources flip to true (per-areaId CIRCLE semantics)'
    );
    assert(
      unionResourcesList.length === 3 && unionResourcesList.every((r) => r.areaEmergencyActive === false),
      '  all 3 union resources stay false (UNION area not in CIRCLE)'
    );
  }

  section('7. performance guard — single page makes ≤ 2 EA queries');
  // We can't easily count DB queries through HTTP. Instead, we
  // rely on the helper's own bulk semantics: `isAreaInEmergencyBulk`
  // does ONE HIERARCHY fetch + ONE CIRCLE fetch regardless of
  // input size. We assert the helper's behaviour directly via a
  // mock counter on the EmergencyActivation model.
  await EmergencyActivation.deleteMany({});
  await EmergencyActivation.create({
    rootAreaId: district.insertedId,
    level: 'DISTRICT',
    scope: 'HIERARCHY',
    descendantAreaIds: [district.insertedId, union.insertedId, siblingUnion.insertedId],
    message: 'perf test',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
  });
  const { isAreaInEmergencyBulk } = require('../utils/emergencyScope');
  // Count find() calls on EmergencyActivation during a 30-row bulk.
  const items = [];
  for (let i = 0; i < 30; i++) {
    items.push({
      areaId: i % 2 === 0 ? unionHex : siblingHex,
      lat: 23.8,
      lng: 90.4,
    });
  }
  const origFind = EmergencyActivation.find.bind(EmergencyActivation);
  let findCount = 0;
  EmergencyActivation.find = function (...args) {
    findCount += 1;
    return origFind(...args);
  };
  try {
    await isAreaInEmergencyBulk(items);
  } finally {
    EmergencyActivation.find = origFind;
  }
  assert(findCount <= 2, `  bulk fetched EA ≤ 2 times (got ${findCount})`);

  section('8. GET /:id reflects the same flag');
  {
    const r = await http_(
      'GET',
      `/api/resources/${unionResources[0]._id.toString()}`,
      { token: volTok }
    );
    assert(r.status === 200, '  GET /:id → 200');
    assert(
      r.body.data.resource.areaEmergencyActive === true,
      '  single-resource flag = true (district HIERARCHY active)'
    );
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