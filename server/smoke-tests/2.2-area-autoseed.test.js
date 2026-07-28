/**
 * End-to-end smoke test for the Area auto-seed behavior (Module 2.2 fix).
 *
 * Scenario:
 *   1. Connect to a fresh in-memory MongoDB with NO areas present.
 *   2. Call `seedAreasIfEmpty()` — should populate the full hierarchy.
 *   3. Call `seedAreasIfEmpty()` again — should be a no-op (returns null).
 *   4. Hand-insert one custom area → call again → must NOT be wiped
 *      (the auto-seed must respect operator-curated data).
 *
 * Run: `node smoke-tests/2.2-area-autoseed.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';

const Area = require('../models/Area');
const { seedAreasIfEmpty } = require('../utils/seedAreas');

let mongo;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

async function run() {
  // ── 1. Fresh in-memory MongoDB ────────────────────────────────────────
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('whu_test'));

  // ── 2. seedAreasIfEmpty() on empty collection ────────────────────────
  const before = await Area.countDocuments({});
  assert(before === 0, 'Area collection starts empty');

  const first = await seedAreasIfEmpty();
  assert(first !== null, 'seedAreasIfEmpty() returns a counts object on first call');
  assert(
    typeof first.districts === 'number' && first.districts > 0,
    `seedAreasIfEmpty seeded at least 1 district (got ${first && first.districts})`
  );

  const after = await Area.countDocuments({});
  assert(after > 0, `Area collection now has documents (count=${after})`);

  // ── 3. seedAreasIfEmpty() on already-populated collection ─────────────
  const second = await seedAreasIfEmpty();
  assert(second === null, 'seedAreasIfEmpty() returns null when collection is non-empty');

  const afterSecond = await Area.countDocuments({});
  assert(
    afterSecond === after,
    `second call did not modify the collection (was ${after}, still ${afterSecond})`
  );

  // ── 4. Operator-curated data must not be wiped ────────────────────────
  // Insert a custom marker that the seed never adds.
  const marker = await Area.create({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: '__CUSTOM_OPERATOR_DISTRICT__',
    parentId: null,
  });
  const withMarker = await Area.countDocuments({});

  const third = await seedAreasIfEmpty();
  assert(third === null, 'seedAreasIfEmpty() still no-ops when collection has operator data');

  const stillThere = await Area.findById(marker._id);
  assert(
    stillThere !== null,
    'operator-curated area is preserved (not wiped by auto-seed)'
  );

  const finalCount = await Area.countDocuments({});
  assert(
    finalCount === withMarker,
    `collection size unchanged after third call (${withMarker} → ${finalCount})`
  );

  // ── 5. Static guards for the public exports ──────────────────────────
  const exports = require('../utils/seedAreas');
  assert(
    typeof exports.seedAreas === 'function',
    'utils/seedAreas.js exports seedAreas()'
  );
  assert(
    typeof exports.seedAreasIfEmpty === 'function',
    'utils/seedAreas.js exports seedAreasIfEmpty()'
  );

  await mongoose.disconnect();
  await mongo.stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
    try {
      await mongoose.disconnect();
    } catch {}
    if (mongo) await mongo.stop();
  }
})();