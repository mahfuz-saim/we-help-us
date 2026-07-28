/**
 * Seed the Area collection with Bangladesh's administrative hierarchy.
 *
 * Shipped in two pieces so the same logic powers:
 *   - the CLI entry `scripts/seed-areas.js` (operational seeding),
 *   - the smoke test (in-memory seeding via `seedAreas()`),
 *   - server auto-seed on first boot (`seedAreasIfEmpty()`).
 *
 * The `seedAreas()` function is idempotent and DESTRUCTIVE: it wipes
 * the existing Area collection first and reinserts. Use with care —
 * a partial seed leaves the cascade in a half-broken state.
 *
 * The `seedAreasIfEmpty()` helper is the safe sibling: it only
 * inserts when the Area collection is empty, so server boot can call
 * it without risking data loss in deployments where an operator
 * has hand-curated the hierarchy.
 *
 * Hierarchy that this function materialises:
 *   District → Upazila → Union → Ward → Village
 *
 * Districts come from `utils/bangladeshAreas.js` (all real Bangladesh
 * district names). Lower levels are generated deterministically from
 * each district name (e.g. `<District> North → East → Ward 1 → A`,
 * etc.). Boundary polygons are intentionally omitted — Module 4.3
 * owns them.
 */

const mongoose = require('mongoose');
const Area = require('../models/Area');
const {
  DISTRICTS,
  UPAZILAS_PER_DISTRICT,
  UNIONS_PER_UPAZILA,
  WARDS_PER_UNION,
  VILLAGES_PER_WARD,
  CARDINALS,
  UNION_NAMES,
  WARD_NUMBERS,
  VILLAGE_LETTERS,
} = require('./bangladeshAreas');

const COUNTRY = Area.DEFAULT_COUNTRY;

/**
 * Idempotently insert the Bangladesh hierarchy into the Area
 * collection, replacing any prior content.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skipClear=false]   Skip the destructive wipe.
 *                                          Useful when running inside a
 *                                          test that already has its
 *                                          own fixtures.
 * @param {object}  [opts.connection=mongoose.connection]  Mongo handle
 *                                          to log against (overridable
 *                                          for unit tests).
 * @returns {Promise<{districts:number, upazilas:number, unions:number,
 *                   wards:number, villages:number, total:number}>}
 */
async function seedAreas(opts = {}) {
  const {
    skipClear = false,
    connection = mongoose.connection,
  } = opts;

  if (!skipClear) {
    // Drop the collection outright — recreating indexes is cheaper
    // than walking the tree and bulkWrite-updating every parentId.
    if (connection.readyState !== 1) {
      throw new Error('seedAreas: MongoDB is not connected');
    }
    await connection.collection('areas').deleteMany({});
  }

  // ── 1. Districts (no parent) ───────────────────────────────────────────
  const districtDocs = DISTRICTS.map((d) => ({
    country: COUNTRY,
    level: Area.LEVELS.DISTRICT,
    name: d.name,
    parentId: null,
  }));
  const insertedDistricts = await Area.insertMany(districtDocs, {
    ordered: false,
  });
  const districtByName = new Map(
    insertedDistricts.map((d) => [d.name, d])
  );

  // ── 2. Upazilas ────────────────────────────────────────────────────────
  const upazilaDocs = [];
  for (const d of insertedDistricts) {
    for (let i = 0; i < UPAZILAS_PER_DISTRICT; i += 1) {
      upazilaDocs.push({
        country: COUNTRY,
        level: Area.LEVELS.UPAZILA,
        name: `${d.name} ${CARDINALS[i] || `Upazila ${i + 1}`}`,
        parentId: d._id,
      });
    }
  }
  const insertedUpazilas = await Area.insertMany(upazilaDocs, {
    ordered: false,
  });

  // ── 3. Unions ──────────────────────────────────────────────────────────
  const unionDocs = [];
  for (const u of insertedUpazilas) {
    for (let i = 0; i < UNIONS_PER_UPAZILA; i += 1) {
      unionDocs.push({
        country: COUNTRY,
        level: Area.LEVELS.UNION,
        name: `${u.name.replace(/ .*/, '')} ${UNION_NAMES[i]}`,
        parentId: u._id,
      });
    }
  }
  const insertedUnions = await Area.insertMany(unionDocs, {
    ordered: false,
  });

  // ── 4. Wards ───────────────────────────────────────────────────────────
  const wardDocs = [];
  for (const u of insertedUnions) {
    for (let i = 0; i < WARDS_PER_UNION; i += 1) {
      wardDocs.push({
        country: COUNTRY,
        level: Area.LEVELS.WARD,
        name: `Ward ${WARD_NUMBERS[i]}`,
        parentId: u._id,
      });
    }
  }
  const insertedWards = await Area.insertMany(wardDocs, {
    ordered: false,
  });

  // ── 5. Villages ────────────────────────────────────────────────────────
  const villageDocs = [];
  for (const w of insertedWards) {
    for (let i = 0; i < VILLAGES_PER_WARD; i += 1) {
      villageDocs.push({
        country: COUNTRY,
        level: Area.LEVELS.VILLAGE,
        name: `Village ${VILLAGE_LETTERS[i]}`,
        parentId: w._id,
      });
    }
  }
  const insertedVillages = await Area.insertMany(villageDocs, {
    ordered: false,
  });

  return {
    districts: insertedDistricts.length,
    upazilas: insertedUpazilas.length,
    unions: insertedUnions.length,
    wards: insertedWards.length,
    villages: insertedVillages.length,
    total:
      insertedDistricts.length +
      insertedUpazilas.length +
      insertedUnions.length +
      insertedWards.length +
      insertedVillages.length,
  };
}

/**
 * Auto-seed helper for server boot: only inserts the Bangladesh
 * hierarchy if the Area collection is currently empty.
 *
 * Why this exists: the cascading dropdown (Module 2.2) and the
 * resource search (Phase 4) both depend on the Area tree being
 * populated. Forcing every operator to run
 * `node scripts/seed-areas.js` manually is a footgun — most users
 * hit `count: 0` on the first GET /api/areas request and have no
 * idea why. Calling `seedAreasIfEmpty()` on boot removes that step
 * at the cost of one extra collection-count on startup.
 *
 * Behavior:
 *   - If the Area collection already has any docs → no-op (return null).
 *     Operators who have hand-curated the hierarchy keep their data.
 *   - If the Area collection is empty → call `seedAreas({skipClear:true})`
 *     and return the resulting counts.
 *
 * @param {object} [opts]
 * @param {object} [opts.connection=mongoose.connection]
 * @returns {Promise<null | {districts, upazilas, unions, wards, villages, total}>}
 */
async function seedAreasIfEmpty(opts = {}) {
  const { connection = mongoose.connection } = opts;
  if (connection.readyState !== 1) {
    throw new Error('seedAreasIfEmpty: MongoDB is not connected');
  }
  const count = await connection.collection('areas').countDocuments({});
  if (count > 0) {
    // Already populated — leave it alone.
    return null;
  }
  return seedAreas({ skipClear: true, connection });
}

module.exports = { seedAreas, seedAreasIfEmpty };