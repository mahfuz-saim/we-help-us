/**
 * Area controller — public reference-data endpoints (Module 2.1).
 *
 * Endpoints:
 *   - GET /api/areas     → list areas filtered by `level` and/or `parent`.
 *   - GET /api/areas/:id → resolve a single area id to its full ancestor
 *                           chain (root → leaf). Used by the profile
 *                           page so a stored `areaId` can be displayed
 *                           as a hierarchy label even when the picker
 *                           is in read-only mode.
 *
 * Design notes:
 *   - Areas are PUBLIC reference data. There is no PII on the Area
 *     document, so the endpoint is intentionally unauthenticated —
 *     the cascading UI in Module 2.2 will fetch these on page load.
 *   - The zod schema in validators/area.validators.js guarantees we
 *     never get here with both `level` and `parent` missing. The
 *     controller still defensively falls back to `level=DISTRICT` if
 *     somehow both are undefined (belt + braces against refactors).
 *   - Results are sorted by `name` ascending so the dropdown options
 *     come back in a stable, human-readable order.
 *   - Hard cap of 5000 docs per query — Bangladesh's full hierarchy
 *     is ~87k villages, but the cascading dropdown only ever asks
 *     for one slice at a time, and 5000 per level is wildly more
 *     than realistic (the largest district has ~20 upazilas).
 */

const ApiError = require('../utils/apiError');
const { ok } = require('../utils/apiResponse');
const Area = require('../models/Area');

const MAX_RESULTS = 5000;
const MAX_CHAIN_DEPTH = 16; // safety cap — Bangladesh's deepest level is VILLAGE (5)

async function listAreas(req, res, next) {
  try {
    const { level, parent } = req.query;

    const filter = {};
    if (level) filter.level = level;
    if (parent) filter.parentId = parent;

    // Belt + braces — the schema requires `level` or `parent`, but if
    // a future refactor weakens that we still don't dump the whole
    // collection on the network.
    if (Object.keys(filter).length === 0) {
      filter.level = Area.LEVELS.DISTRICT;
    }

    const areas = await Area.find(filter)
      .sort({ name: 1 })
      .limit(MAX_RESULTS)
      .lean();

    return ok(
      res,
      {
        areas: areas.map((a) => ({
          id: a._id.toString(),
          country: a.country,
          level: a.level,
          name: a.name,
          parentId: a.parentId ? a.parentId.toString() : null,
        })),
        count: areas.length,
      },
      'Areas fetched'
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/areas/:id
 *
 * Resolve a single area id to its full ancestor chain (root → leaf).
 * Returns:
 *   {
 *     area:   { id, level, name },
 *     chain:  [{ id, level, name }, ...]   // root first, leaf last
 *   }
 *
 * Walking is iterative (not recursive) with a hard depth cap so a
 * malformed tree can't blow the stack or spin forever. If any link
 * is missing (orphan or stale reference) we stop walking and return
 * what we have — the client can still show the partial chain.
 */
async function getAreaChain(req, res, next) {
  try {
    const startId = req.params.id;
    const chain = [];

    let cursorId = startId;
    let depth = 0;
    let leaf = null;

    while (cursorId && depth < MAX_CHAIN_DEPTH) {
      const doc = await Area.findById(cursorId)
        .select('name level parentId')
        .lean();
      if (!doc) break;
      chain.push({
        id: doc._id.toString(),
        level: doc.level,
        name: doc.name,
      });
      if (!leaf) leaf = { id: doc._id.toString(), level: doc.level, name: doc.name };
      cursorId = doc.parentId ? doc.parentId.toString() : null;
      depth += 1;
    }

    if (chain.length === 0) {
      throw new ApiError(404, 'area not found');
    }

    // Root first → leaf last (we walked leaf → root above, so reverse).
    chain.reverse();

    return ok(
      res,
      {
        area: leaf,
        chain,
      },
      'Area resolved'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { listAreas, getAreaChain };