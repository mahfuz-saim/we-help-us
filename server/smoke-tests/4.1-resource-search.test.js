/**
 * End-to-end smoke test for Module 4.1 — Resource Search API.
 *
 * Validates the server-side extension of GET /api/resources with
 * Module 4.1's new filters:
 *   - minCapacity (capacity >= N)
 *   - lat / lng / radius (geo within radius meters)
 *
 * Plus the existing filters from Module 3.2 (category, status,
 * areaId, q, mine, page, limit) so we don't regress them. We also
 * keep the privacy check (no owner email/phone/name in the
 * response) and the auth gate (401 without a token).
 *
 * Storage: same Atlas-ephemeral-DB pattern as 3.5 — connect to the
 * real Atlas cluster with a per-run DB name `wehelpus_smoke_41_<ts>_<rand>`
 * and drop it on teardown so the dev `wehelpus` DB is never touched.
 *
 * Run: `node smoke-tests/4.1-resource-search.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';
// Cloudinary not exercised (no photos uploaded in this test) — empty
// strings survive dotenv.config() and keep isCloudinaryConfigured false.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const TEST_DB = `wehelpus_smoke_41_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
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

async function run() {
  // ── 1. Bootstrap: owner + 4 resources across Dhaka ──────────────────
  console.log('\n--- 1. seed owner + 4 resources ---');
  const ownerDoc = await User.create({
    name: 'Alice Owner',
    email: 'alice-search@example.com',
    phone: '+8801710000201',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const ownerToken = signJwt({ id: ownerDoc._id.toString(), role: 'OWNER' });
  assert(ownerToken, 'token issued');

  // Create via the API so we exercise the real validator + controller.
  // We'll then PATCH one resource to add capacity / status / location
  // because the POST endpoint doesn't accept location in the test's
  // JSON path (it expects multipart) and we want finer control.
  const created = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await http_('POST', '/api/resources', {
      token: ownerToken,
      body: {
        category: ['TRANSPORTATION', 'MEDICAL', 'UTILITIES', 'MEDICAL'][i],
        title: `Resource ${i + 1}`,
        description: `A useful resource description for the test number ${i + 1}.`,
      },
    });
    assert(r.status === 201, `resource ${i + 1} created → 201`);
    created.push(r.body.data.resource.id);
  }

  // Now patch the resources directly so we can:
  //   - give resource 1 capacity=10 (Dhaka center, AVAILABLE)
  //   - give resource 2 capacity=2  (Dhaka center, AVAILABLE)
  //   - give resource 3 capacity=null (~7km east, UNAVAILABLE)
  //   - give resource 4 capacity=8  (~150km SE, AVAILABLE)
  await Resource.updateOne(
    { _id: created[0] },
    { capacity: 10, status: 'AVAILABLE', location: { type: 'Point', coordinates: [90.4125, 23.8103] } }
  );
  await Resource.updateOne(
    { _id: created[1] },
    { capacity: 2, status: 'AVAILABLE', location: { type: 'Point', coordinates: [90.4125, 23.8103] } }
  );
  await Resource.updateOne(
    { _id: created[2] },
    { capacity: null, status: 'UNAVAILABLE', location: { type: 'Point', coordinates: [90.4825, 23.8303] } }
  );
  await Resource.updateOne(
    { _id: created[3] },
    { capacity: 8, status: 'AVAILABLE', location: { type: 'Point', coordinates: [91.7, 22.3] } }
  );

  // ── 2. Auth gate ────────────────────────────────────────────────────
  console.log('\n--- 2. auth gate ---');
  {
    const r = await http_('GET', '/api/resources');
    assert(r.status === 401, 'GET /api/resources without token → 401');
  }

  // ── 3. Default list returns 200 with the existing shape ─────────────
  console.log('\n--- 3. default list ---');
  {
    const r = await http_('GET', '/api/resources', { token: ownerToken });
    assert(r.status === 200, 'GET /api/resources → 200');
    assert(r.body.data.resources.length === 4, '  4 resources returned');
    assert(
      r.body.data.pagination &&
        r.body.data.pagination.total === 4 &&
        r.body.data.pagination.pages >= 1,
      '  pagination.total=4, pages>=1'
    );
  }

  // ── 4. Existing 3.2 filters still work (regression guard) ────────────
  console.log('\n--- 4. existing filters still work ---');
  {
    const r = await http_('GET', '/api/resources?category=MEDICAL', { token: ownerToken });
    assert(r.status === 200, 'category=MEDICAL → 200');
    assert(r.body.data.resources.every((x) => x.category === 'MEDICAL'),
      '  every result is MEDICAL');
    assert(r.body.data.resources.length === 2, '  exactly 2 MEDICAL resources');

    const r2 = await http_('GET', '/api/resources?status=AVAILABLE', { token: ownerToken });
    assert(r2.body.data.resources.every((x) => x.status === 'AVAILABLE'),
      '  status=AVAILABLE filters correctly');

    const r3 = await http_('GET', '/api/resources?q=Resource%201', { token: ownerToken });
    assert(r3.body.data.resources.length === 1, '  q matches a single resource');
  }

  // ── 5. New: minCapacity filter ───────────────────────────────────────
  console.log('\n--- 5. minCapacity filter ---');
  {
    const r = await http_('GET', '/api/resources?minCapacity=3', { token: ownerToken });
    assert(r.status === 200, 'minCapacity=3 → 200');
    // capacity=10 (r1) + capacity=8 (r4) match; capacity=2 and capacity=null do not
    assert(r.body.data.resources.length === 2, '  2 resources have capacity >= 3');
    assert(
      r.body.data.resources.every((x) => x.capacity >= 3),
      '  every result has capacity >= 3'
    );

    const r0 = await http_('GET', '/api/resources?minCapacity=100', { token: ownerToken });
    assert(r0.body.data.resources.length === 0, '  minCapacity=100 → 0 results');

    const rAll = await http_('GET', '/api/resources?minCapacity=0', { token: ownerToken });
    // capacity >= 0 excludes null capacity (resource 3)
    assert(
      rAll.body.data.resources.every((x) => x.capacity !== null),
      '  minCapacity=0 excludes resources with capacity=null'
    );
  }

  // ── 6. New: lat / lng / radius distance filter ──────────────────────
  console.log('\n--- 6. distance filter (lat/lng/radius) ---');
  {
    // Dhaka center 90.4125, 23.8103. 20km radius should include the
    // two Dhaka resources + the ~7km east one; the 150km SE one is out.
    const r = await http_(
      'GET',
      '/api/resources?lat=23.8103&lng=90.4125&radius=20000',
      { token: ownerToken }
    );
    assert(r.status === 200, 'distance 20km around Dhaka → 200');
    assert(r.body.data.resources.length === 3, '  3 resources within 20km');
    assert(
      r.body.data.resources.every(
        (x) => x.location && Array.isArray(x.location.coordinates)
      ),
      '  every result has location coordinates'
    );

    // Tighten to 5km — only the two resources that share Dhaka center.
    const tight = await http_(
      'GET',
      '/api/resources?lat=23.8103&lng=90.4125&radius=5000',
      { token: ownerToken }
    );
    assert(tight.body.data.resources.length === 2, '  5km radius → 2 resources');

    // Tighten to 1km — only one (the two Dhaka resources are at the
    // exact same coords; $geoWithin treats that as zero distance).
    const one = await http_(
      'GET',
      '/api/resources?lat=23.8103&lng=90.4125&radius=1000',
      { token: ownerToken }
    );
    assert(one.body.data.resources.length === 2, '  1km radius → 2 resources (same point)');
  }

  // ── 7. Filter compose: minCapacity + distance + status ──────────────
  console.log('\n--- 7. filters compose ---');
  {
    const r = await http_(
      'GET',
      '/api/resources?lat=23.8103&lng=90.4125&radius=20000&minCapacity=5&status=AVAILABLE',
      { token: ownerToken }
    );
    assert(r.status === 200, 'compose → 200');
    // capacity=10 (r1) matches; capacity=2 + capacity=8 + null + UNAVAILABLE all excluded
    assert(r.body.data.resources.length === 1, '  exactly 1 resource satisfies all filters');
    assert(
      r.body.data.resources[0].capacity >= 5 &&
        r.body.data.resources[0].status === 'AVAILABLE',
      '  the result matches every filter'
    );
  }

  // ── 8. Validator strictness + lat/lng/lat compose rules ─────────────
  console.log('\n--- 8. validator rejects bad inputs ---');
  {
    const cases = [
      ['minCapacity=foo', 'bad minCapacity'],
      ['minCapacity=-1', 'negative minCapacity'],
      ['lat=999', 'lat out of range'],
      ['lat=23.8103&lng=200', 'lng out of range'],
      ['lat=23.8103&lng=90.4125&radius=0', 'radius zero'],
      ['lat=23.8103&lng=90.4125&radius=999999', 'radius too big'],
      // Compose: half-specified geo
      ['lat=23.8103', 'lat without lng'],
      ['lng=90.4125', 'lng without lat'],
      ['radius=10000', 'radius without center'],
    ];
    for (const [qs, label] of cases) {
      const r = await http_('GET', `/api/resources?${qs}`, { token: ownerToken });
      assert(r.status === 400, `${label} → 400 (got ${r.status})`);
    }

    // Strict: unknown query keys rejected.
    const unknown = await http_('GET', '/api/resources?bogus=1', { token: ownerToken });
    assert(unknown.status === 400, 'unknown query key → 400');
  }

  // ── 9. Pagination metadata still works under the new filters ───────
  console.log('\n--- 9. pagination + new filters ---');
  {
    const r = await http_('GET', '/api/resources?limit=2&page=1', { token: ownerToken });
    assert(r.status === 200, 'limit=2&page=1 → 200');
    assert(r.body.data.resources.length === 2, '  2 docs on page 1');
    assert(r.body.data.pagination.limit === 2, '  pagination.limit echoed');
    assert(r.body.data.pagination.page === 1, '  pagination.page echoed');
    assert(r.body.data.pagination.total === 4, '  pagination.total=4');

    const r2 = await http_('GET', '/api/resources?limit=2&page=2', { token: ownerToken });
    assert(r2.body.data.resources.length === 2, '  2 docs on page 2');
    assert(r2.body.data.pagination.page === 2, '  pagination.page=2 echoed');
  }

  // ── 10. Privacy boundary under the new filters ──────────────────────
  console.log('\n--- 10. privacy ---');
  {
    const blob = JSON.stringify(
      await http_('GET', '/api/resources?minCapacity=1', { token: ownerToken }).then(
        (r) => r.body
      )
    );
    assert(!/alice-search@example\.com/.test(blob), '  no owner email leaks');
    assert(!/\+8801710000201/.test(blob), '  no owner phone leaks');
    assert(!/Alice Owner/.test(blob), '  no owner name leaks');
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