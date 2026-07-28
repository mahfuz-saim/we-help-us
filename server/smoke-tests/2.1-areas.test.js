/**
 * End-to-end smoke test for Module 2.1 — Area Model & Seed Data.
 *
 * Spins up:
 *   - in-memory MongoDB
 *   - the real Express app
 *   - the real areas router
 *
 * Seeds the Area collection via the same `seedAreas()` helper the CLI
 * uses, then exercises every cascading-dropdown scenario:
 *
 *   - GET /api/areas (no query) → 400 (must specify level or parent)
 *   - GET /api/areas?level=DISTRICT → all 64 districts
 *   - GET /api/areas?parent=<districtId> → upazilas of that district
 *   - GET /api/areas?level=UPAZILA&parent=<districtId> → same as above
 *   - GET /api/areas?level=XYZ → 400 (invalid level)
 *   - GET /api/areas?parent=not-an-objectid → 400
 *   - GET /api/areas?parent=<bogus but valid id> → 200 with empty list
 *   - Cascade depth: districts → upazilas → unions → wards → villages
 *     each yielding the expected count from the seed config
 *   - Idempotency: re-running seedAreas() wipes & reinserts cleanly
 *   - Caching: results are sorted by name ascending
 *
 * Run: `node smoke-tests/2.1-areas.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';

const { createApp } = require('../app');
const Area = require('../models/Area');
const { seedAreas } = require('../utils/seedAreas');
const {
  DISTRICTS,
  UPAZILAS_PER_DISTRICT,
  UNIONS_PER_UPAZILA,
  WARDS_PER_UNION,
  VILLAGES_PER_WARD,
} = require('../utils/bangladeshAreas');

let mongo;
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

async function http_(method, path) {
  const url = new URL(baseUrl + path);
  const opts = { method, headers: {} };
  return new Promise((resolve, reject) => {
    const req = http.request(url, opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(buf);
        } catch {
          /* keep null */
        }
        resolve({ status: res.statusCode, body: json, raw: buf });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function start() {
  console.log('--- starting in-memory mongo ---');
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  console.log('  listening on', baseUrl);
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  if (mongo) await mongo.stop();
}

async function run() {
  // ── 1. Seed health ─────────────────────────────────────────────────────
  console.log('\n--- 1. Seed sanity ---');
  const seeded = await seedAreas();
  assert(
    seeded.districts === DISTRICTS.length,
    `seed inserted all ${DISTRICTS.length} districts`
  );
  assert(
    seeded.districts === seeded.districts && seeded.districts > 0,
    '  (sanity) districts is a positive number'
  );
  assert(
    seeded.upazilas === DISTRICTS.length * UPAZILAS_PER_DISTRICT,
    `seed inserted ${DISTRICTS.length} × ${UPAZILAS_PER_DISTRICT} = ${DISTRICTS.length * UPAZILAS_PER_DISTRICT} upazilas`
  );
  assert(
    seeded.unions === seeded.districts * UPAZILAS_PER_DISTRICT * UNIONS_PER_UPAZILA,
    `seed inserted the right number of unions`
  );
  assert(
    seeded.wards === seeded.unions * WARDS_PER_UNION,
    '  ward count = unions × wardsPerUnion'
  );
  assert(
    seeded.villages === seeded.wards * VILLAGES_PER_WARD,
    '  village count = wards × villagesPerWard'
  );
  assert(
    seeded.total ===
      seeded.districts +
        seeded.upazilas +
        seeded.unions +
        seeded.wards +
        seeded.villages,
    '  total = sum of all level counts'
  );

  // ── 2. Validation errors ──────────────────────────────────────────────
  console.log('\n--- 2. Validation errors ---');
  {
    const r = await http_('GET', '/api/areas');
    assert(r.status === 400, 'GET /api/areas (no query) → 400');
    assert(
      /level or parent/i.test(r.body && r.body.message),
      '  error message mentions "level or parent"'
    );

    const r2 = await http_('GET', '/api/areas?level=XYZ');
    assert(r2.status === 400, 'GET /api/areas?level=XYZ → 400');
    assert(
      /level must be one of/i.test(r2.body && r2.body.message),
      '  error message mentions valid level enum'
    );

    const r3 = await http_('GET', '/api/areas?parent=not-an-objectid');
    assert(r3.status === 400, 'GET /api/areas?parent=invalid → 400');
    assert(
      /objectid/i.test(r3.body && r3.body.message),
      '  error message mentions ObjectId'
    );

    const r4 = await http_('GET', '/api/areas?level=DISTRICT&extra=1');
    assert(r4.status === 400, 'unknown query keys are rejected (strict)');
  }

  // ── 3. List districts ──────────────────────────────────────────────────
  console.log('\n--- 3. List districts ---');
  let districts;
  {
    const r = await http_('GET', '/api/areas?level=DISTRICT');
    assert(r.status === 200, 'GET /api/areas?level=DISTRICT → 200');
    assert(Array.isArray(r.body.data.areas), '  response has areas array');
    assert(
      r.body.data.areas.length === DISTRICTS.length,
      `  returns all ${DISTRICTS.length} districts`
    );
    assert(typeof r.body.data.count === 'number', '  count field is a number');
    assert(
      r.body.data.count === r.body.data.areas.length,
      '  count matches areas.length'
    );

    // Verify shape: id, country, level, name, parentId
    const sample = r.body.data.areas[0];
    assert(typeof sample.id === 'string' && sample.id.length === 24, '  id is ObjectId hex');
    assert(sample.country === 'Bangladesh', '  country is Bangladesh');
    assert(sample.level === 'DISTRICT', '  level is DISTRICT');
    assert(typeof sample.name === 'string' && sample.name.length > 0, '  name is non-empty');
    assert(sample.parentId === null, '  parentId is null for top-level districts');

    // Verify sorted by name
    const names = r.body.data.areas.map((a) => a.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    assert(
      JSON.stringify(names) === JSON.stringify(sortedNames),
      '  results are sorted by name ascending'
    );

    // Verify the actual district names appear
    const expectedNames = new Set(DISTRICTS.map((d) => d.name));
    const gotNames = new Set(r.body.data.areas.map((a) => a.name));
    assert(
      [...expectedNames].every((n) => gotNames.has(n)),
      '  every district name from the seed is present'
    );

    districts = r.body.data.areas;
  }

  // ── 4. List upazilas of a district ────────────────────────────────────
  console.log('\n--- 4. List upazilas of a district ---');
  {
    const dhaka = districts.find((d) => d.name === 'Dhaka');
    assert(dhaka, 'Dhaka district exists');

    const r = await http_(
      'GET',
      `/api/areas?level=UPAZILA&parent=${dhaka.id}`
    );
    assert(r.status === 200, 'GET upazilas of Dhaka → 200');
    assert(
      r.body.data.areas.length === UPAZILAS_PER_DISTRICT,
      `  returns ${UPAZILAS_PER_DISTRICT} upazilas for Dhaka`
    );
    assert(
      r.body.data.areas.every((a) => a.parentId === dhaka.id),
      '  every returned upazila has parentId = Dhaka'
    );
    assert(
      r.body.data.areas.every((a) => a.level === 'UPAZILA'),
      '  every returned level is UPAZILA'
    );
    assert(
      r.body.data.areas.every((a) => a.name.startsWith('Dhaka ')),
      '  upazila names follow "Dhaka <Cardinal>" pattern'
    );

    // Same query without `level` — returns all children regardless of level
    const r2 = await http_('GET', `/api/areas?parent=${dhaka.id}`);
    assert(r2.status === 200, 'GET children of Dhaka (no level) → 200');
    assert(
      r2.body.data.areas.length === UPAZILAS_PER_DISTRICT,
      '  same count regardless of level filter (only children of districts are upazilas)'
    );
  }

  // ── 5. Full cascade depth ─────────────────────────────────────────────
  console.log('\n--- 5. Full cascade: district → upazila → union → ward → village ---');
  {
    const dhaka = districts.find((d) => d.name === 'Dhaka');
    const upazilas = await http_(
      'GET',
      `/api/areas?level=UPAZILA&parent=${dhaka.id}`
    );
    const upazila = upazilas.body.data.areas[0];

    const unions = await http_(
      'GET',
      `/api/areas?level=UNION&parent=${upazila.id}`
    );
    assert(
      unions.status === 200 &&
        unions.body.data.areas.length === UNIONS_PER_UPAZILA,
      `  union level: ${UNIONS_PER_UPAZILA} per upazila`
    );
    const union = unions.body.data.areas[0];
    assert(
      union.parentId === upazila.id,
      '  union.parentId = upazila.id'
    );

    const wards = await http_(
      'GET',
      `/api/areas?level=WARD&parent=${union.id}`
    );
    assert(
      wards.status === 200 &&
        wards.body.data.areas.length === WARDS_PER_UNION,
      `  ward level: ${WARDS_PER_UNION} per union`
    );
    const ward = wards.body.data.areas[0];

    const villages = await http_(
      'GET',
      `/api/areas?level=VILLAGE&parent=${ward.id}`
    );
    assert(
      villages.status === 200 &&
        villages.body.data.areas.length === VILLAGES_PER_WARD,
      `  village level: ${VILLAGES_PER_WARD} per ward`
    );
    assert(
      villages.body.data.areas.every((v) => v.parentId === ward.id),
      '  every village has parentId = ward.id'
    );
    assert(
      villages.body.data.areas.every((v) => v.level === 'VILLAGE'),
      '  every returned level is VILLAGE'
    );
  }

  // ── 6. Empty result for a non-existent parent ─────────────────────────
  console.log('\n--- 6. Empty parent ID returns empty list ---');
  {
    const fakeId = '64a0000000000000000000ff';
    const r = await http_('GET', `/api/areas?parent=${fakeId}`);
    assert(r.status === 200, 'plausible-but-unknown ObjectId → 200');
    assert(Array.isArray(r.body.data.areas), '  areas array is still returned');
    assert(
      r.body.data.areas.length === 0,
      '  areas is empty for unknown parent'
    );
    assert(r.body.data.count === 0, '  count is 0');
  }

  // ── 7. Idempotency: re-seed wipes & reinserts ─────────────────────────
  console.log('\n--- 7. Idempotency ---');
  {
    const reseeded = await seedAreas();
    assert(
      reseeded.districts === DISTRICTS.length,
      're-seed inserts the same district count'
    );
    const still = await Area.countDocuments();
    assert(
      still === reseeded.total,
      `  collection size matches seed total (no duplicates from re-seed)`
    );
  }

  // ── 8. Module-level key-value sanity ──────────────────────────────────
  console.log('\n--- 8. Static guards ---');
  {
    assert(
      Area.LEVELS && Area.LEVELS.DISTRICT === 'DISTRICT',
      'Area.LEVELS.DISTRICT exported'
    );
    assert(
      Array.isArray(Area.LEVEL_VALUES) && Area.LEVEL_VALUES.length === 5,
      'Area.LEVEL_VALUES has 5 entries'
    );
    assert(
      Area.DEFAULT_COUNTRY === 'Bangladesh',
      'Area.DEFAULT_COUNTRY is Bangladesh'
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