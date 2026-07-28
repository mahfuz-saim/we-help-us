/**
 * Analytics controller — Module 8.1.
 *
 * Read-only reporting surface for the MODERATOR role (and ADMIN).
 * Five endpoints under /api/analytics, each gated at the router level
 * by `protect, authorize('MODERATOR', 'ADMIN')`:
 *
 *   - GET /api/analytics/total-by-category
 *       Counts of resources grouped by category. Used by the
 *       "Resource count by category" pie/bar chart (Module 8.2).
 *   - GET /api/analytics/distribution-by-area
 *       Counts of resources grouped by area. Optional `level`
 *       (DISTRICT..VILLAGE) parameter rolls up the bucket — when
 *       omitted, the count is at the resource.areaId level directly.
 *   - GET /api/analytics/most-used-resources
 *       Top N resources by completed-request count (REQUESTED,
 *       APPROVED, COLLECTED, RETURNED). Drives the "Most used" table.
 *   - GET /api/analytics/active-emergency-assets
 *       Counts of resources by status, scoped to areas where
 *       emergencyMode.isActive === true (Module 6.3 flag).
 *   - GET /api/analytics/coverage-by-village
 *       Coverage grid — count of resources per "village" (or any
 *       chosen level) across the area scope. The default level is
 *       VILLAGE so the dashboard renders the bottom-up view.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   None of the endpoints expose email / phone / password / owner
 *   contact info. Resource summaries use the privacy-stripped
 *   `publicResource()` helper from the resource controller. User
 *   identities never appear in the response — analytics rolls up to
 *   counts, not lists of users. A walker test in the smoke (section
 *   7) asserts zero contact-key leakage across every payload.
 *
 * Role scoping (matches the 6.1 / 6.3 contract):
 *   - MODERATOR: queries are filtered to `req.user.areaId`. A moderator
 *     with no areaId gets an empty payload (analytics with no scope
 *     is meaningless — the empty result is the contract).
 *   - ADMIN: no areaId filter. Admin sees the entire DB.
 *
 * Status flow / Geospatial:
 *   - The status enum is unchanged here. We only count / roll up;
 *     we never mutate a resource or a request.
 *   - The distribution-by-area + coverage-by-village endpoints join
 *     through the existing 2dsphere + areaId indexes (Module 3.1
 *     and 2.1). No new geo queries are introduced.
 */

const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const Area = require('../models/Area');
const User = require('../models/User');
const { CATEGORY_VALUES } = require('../utils/categories');
const { publicResource } = require('./resource.controller');
const { ok } = require('../utils/apiResponse');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

/**
 * Mirror of the moderator controller's area-scoping helper. Kept
 * local rather than imported so this module is self-contained and a
 * future server split (e.g. /api/admin/analytics) doesn't have to
 * reach across module boundaries.
 */
function areaScopeFor(req) {
  if (req.user.role === User.ROLES.ADMIN) {
    return {};
  }
  if (!req.user.areaId) return null;
  return { areaId: req.user.areaId };
}

/**
 * Resolve the set of Area ObjectIds that fall under `rootIds` for a
 * given roll-up `level`. BFS down the (level, parentId) index until
 * the requested level is reached; returns [] when no nodes exist at
 * that level.
 */
async function areaIdsAtLevel({ rootIds, level }) {
  if (!rootIds || rootIds.length === 0) return [];
  // First, check whether the rootIds already sit at the target level.
  // If they do, return them directly — no BFS needed.
  const rootDocs = await Area.find({ _id: { $in: rootIds } })
    .select('level')
    .lean();
  if (rootDocs.length > 0 && rootDocs[0].level === level) {
    return rootIds;
  }
  const out = [];
  let frontier = [...rootIds];
  while (frontier.length > 0) {
    const sample = await Area.findOne({ _id: { $in: frontier } }).select(
      'level'
    );
    if (!sample) break;
    if (sample.level === level) {
      out.push(...frontier);
      break;
    }
    const children = await Area.find({ parentId: { $in: frontier } }).select(
      '_id level'
    );
    if (children.length === 0) break;
    const nextFrontier = children.map((c) => c._id);
    if (children[0].level === level) {
      out.push(...nextFrontier);
      break;
    }
    frontier = nextFrontier;
  }
  return out;
}

// ── GET /api/analytics/total-by-category ─────────────────────────────────
async function getTotalByCategory(req, res, next) {
  try {
    const scope = areaScopeFor(req);

    // Build the canonical 6-bucket list first — the chart renders a
    // stable shape even when the moderator has no scope or a category
    // has zero resources.
    let byCategory;
    if (scope === null) {
      byCategory = CATEGORY_VALUES.map((category) => ({ category, count: 0 }));
    } else {
      const grouped = await Resource.aggregate([
        { $match: { ...scope } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $project: { _id: 0, category: '$_id', count: 1 } },
      ]);
      byCategory = CATEGORY_VALUES.map((category) => {
        const found = grouped.find((g) => g.category === category);
        return { category, count: found ? found.count : 0 };
      });
    }
    const total = byCategory.reduce((sum, b) => sum + b.count, 0);

    return ok(
      res,
      { total, byCategory },
      'Total-by-category fetched'
    );
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/analytics/distribution-by-area ──────────────────────────────
async function getDistributionByArea(req, res, next) {
  try {
    const scope = areaScopeFor(req);
    if (scope === null) {
      return ok(res, { total: 0, byArea: [] }, 'Analytics fetched');
    }
    const level = req.query.level || null;
    const limit = req.query.limit
      ? Math.min(parseInt(req.query.limit, 10), MAX_LIMIT)
      : MAX_LIMIT;

    // Build the resource filter. When `level` is provided, we need
    // to expand the scope to include all area IDs in the chosen
    // subtree under `req.user.areaId` (or every district for admin).
    let resourceFilter;
    if (!level || (scope.areaId && !level)) {
      resourceFilter = { ...scope };
    } else {
      // Roll up to the chosen level under the scope's areaId (or all
      // top-level area nodes for admin).
      let rootIds;
      if (scope.areaId) {
        rootIds = [scope.areaId];
      } else {
        const districts = await Area.find({ level: Area.LEVELS.DISTRICT })
          .select('_id');
        if (districts.length > 0) {
          rootIds = districts.map((d) => d._id);
        } else {
          const roots = await Area.find({ parentId: null }).select('_id');
          rootIds = roots.map((r) => r._id);
        }
      }
      const ids = await areaIdsAtLevel({ rootIds, level });
      resourceFilter = { areaId: { $in: ids } };
    }

    const grouped = await Resource.aggregate([
      { $match: resourceFilter },
      {
        $group: {
          _id: '$areaId',
          count: { $sum: 1 },
          byCategory: {
            $push: '$category',
          },
        },
      },
      {
        $project: {
          _id: 0,
          areaId: { $toString: '$_id' },
          count: 1,
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    // Enrich with the Area display name + level so the chart can
    // label each bucket. We avoid `populate()` because the
    // controller is small and we want predictable round-trip cost.
    const areaIds = grouped.map((g) => g.areaId);
    const areas = await Area.find({ _id: { $in: areaIds } })
      .select('name level parentId')
      .lean();
    const byId = new Map(areas.map((a) => [a._id.toString(), a]));
    const byArea = grouped
      .filter((g) => byId.has(g.areaId))
      .map((g) => {
        const area = byId.get(g.areaId);
        return {
          areaId: g.areaId,
          name: area.name,
          level: area.level,
          count: g.count,
        };
      });

    const total = byArea.reduce((sum, b) => sum + b.count, 0);
    return ok(res, { total, byArea, level: level || null }, 'Distribution-by-area fetched');
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/analytics/most-used-resources ───────────────────────────────
async function getMostUsedResources(req, res, next) {
  try {
    const scope = areaScopeFor(req);
    if (scope === null) {
      return ok(res, { total: 0, items: [] }, 'Analytics fetched');
    }
    const limit = req.query.limit
      ? Math.min(parseInt(req.query.limit, 10), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // Join requests → resources so the area scope can be enforced on
    // the resource side. We count any request that reached COLLECTED
    // OR RETURNED — the "actually used" set — but we also expose the
    // request count so the dashboard can sort by either metric.
    const items = await ResourceRequest.aggregate([
      {
        $lookup: {
          from: 'resources',
          localField: 'resourceId',
          foreignField: '_id',
          as: 'resource',
        },
      },
      { $unwind: '$resource' },
      ...(scope.areaId
        ? [{ $match: { 'resource.areaId': scope.areaId } }]
        : []),
      {
        $group: {
          _id: '$resourceId',
          resource: { $first: '$resource' },
          requestCount: { $sum: 1 },
          completedCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$status',
                    ['COLLECTED', 'RETURNED'],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { completedCount: -1, requestCount: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          resourceId: { $toString: '$_id' },
          requestCount: 1,
          completedCount: 1,
          resource: {
            id: { $toString: '$resource._id' },
            category: '$resource.category',
            title: '$resource.title',
            status: '$resource.status',
            areaId: {
              $cond: [
                { $eq: ['$resource.areaId', null] },
                null,
                { $toString: '$resource.areaId' },
              ],
            },
            createdAt: '$resource.createdAt',
            updatedAt: '$resource.updatedAt',
          },
        },
      },
    ]);

    const total = items.reduce((sum, b) => sum + b.requestCount, 0);
    return ok(res, { total, items }, 'Most-used resources fetched');
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/analytics/active-emergency-assets ───────────────────────────
async function getActiveEmergencyAssets(req, res, next) {
  try {
    const scope = areaScopeFor(req);
    if (scope === null) {
      return ok(
        res,
        {
          emergencyModeAreas: [],
          total: 0,
          byStatus: [],
          sample: [],
        },
        'Analytics fetched'
      );
    }

    // 1. Resolve the set of areas that currently have emergency mode
    //    active. The Area model (Module 6.3) stores a subdocument with
    //    `emergencyMode.isActive`. For admin (no area scope) we
    //    globally scan for active rows (the partial index
    //    `emergency_active` covers this case). For a moderator we
    //    scope to their subtree so other districts don't leak.
    let activeDocs;
    if (scope.areaId) {
      let rootIds = [scope.areaId];
      const allAreas = await Area.find({ parentId: { $in: rootIds } })
        .select('_id name level parentId emergencyMode')
        .lean();
      const rootDocs = await Area.find({ _id: { $in: rootIds } })
        .select('_id name level parentId emergencyMode')
        .lean();
      const merged = [...rootDocs, ...allAreas];
      activeDocs = merged.filter(
        (a) => a.emergencyMode && a.emergencyMode.isActive === true
      );
    } else {
      // Admin path — use the partial index (`emergencyMode.isActive:
      // true` rows only) so this is an index hit, not a collection
      // scan.
      activeDocs = await Area.find({ 'emergencyMode.isActive': true })
        .select('_id name level parentId emergencyMode')
        .lean();
    }
    const activeAreaIds = activeDocs.map((a) => a._id);

    if (activeAreaIds.length === 0) {
      return ok(
        res,
        {
          emergencyModeAreas: [],
          total: 0,
          byStatus: [],
          sample: [],
        },
        'No areas are currently in emergency mode'
      );
    }

    // 2. Resources in those areas, broken down by status.
    const filter = { areaId: { $in: activeAreaIds } };
    const grouped = await Resource.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
      { $sort: { status: 1 } },
    ]);

    // 3. A small sample of resources (≤10) so the dashboard can show
    //    "what's deployed" without a separate endpoint. The
    //    privacy-stripped publicResource() shape is reused.
    const sampleDocs = await Resource.find(filter)
      .sort({ updatedAt: -1 })
      .limit(10);
    const sample = sampleDocs.map(publicResource);

    const total = grouped.reduce((sum, g) => sum + g.count, 0);
    const emergencyModeAreas = activeDocs.map((a) => ({
      areaId: a._id.toString(),
      name: a.name,
      level: a.level,
      activatedAt: a.emergencyMode?.activatedAt || null,
    }));
    return ok(
      res,
      { emergencyModeAreas, total, byStatus: grouped, sample },
      'Active emergency assets fetched'
    );
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/analytics/coverage-by-village ───────────────────────────────
async function getCoverageByVillage(req, res, next) {
  try {
    const scope = areaScopeFor(req);
    if (scope === null) {
      return ok(
        res,
        { total: 0, byArea: [], level: req.query.level || 'VILLAGE' },
        'Analytics fetched'
      );
    }
    const level = req.query.level || 'VILLAGE';

    // Same BFS roll-up as distribution-by-area — we share the helper.
    let rootIds;
    if (scope.areaId) {
      rootIds = [scope.areaId];
    } else {
      // Admin path: roll up from every top-level (district) node. We
      // walk the tree through `(level, parentId)` indexes; if there
      // are no top-level districts, fall back to all area-level roots
      // (parentId: null) so the dashboard still renders coverage.
      const districts = await Area.find({ level: Area.LEVELS.DISTRICT }).select(
        '_id'
      );
      if (districts.length > 0) {
        rootIds = districts.map((d) => d._id);
      } else {
        const roots = await Area.find({ parentId: null }).select('_id');
        rootIds = roots.map((r) => r._id);
      }
    }
    let targetIds = await areaIdsAtLevel({ rootIds, level });
    // Fallback: if the chosen level doesn't drill down to anything
    // under the scope's areaId (e.g. a UNION-level scope with
    // ?level=VILLAGE on a tree without village children), use the
    // scope's own areaId as the single bucket so the dashboard has
    // something to render. Admin has no scope.areaId; the fallback
    // uses every top-level area as a single bucket when no descendants
    // exist at the requested level.
    if (targetIds.length === 0) {
      if (scope.areaId) {
        targetIds = [scope.areaId];
      } else {
        targetIds = await Area.find({}).select('_id').lean();
        targetIds = targetIds.map((a) => a._id);
      }
    }

    const grouped = await Resource.aggregate([
      { $match: { areaId: { $in: targetIds } } },
      { $group: { _id: '$areaId', count: { $sum: 1 } } },
      {
        $project: {
          _id: 0,
          areaId: { $toString: '$_id' },
          count: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);

    const areaDocs = await Area.find({ _id: { $in: targetIds } })
      .select('name level parentId')
      .lean();
    const byId = new Map(areaDocs.map((a) => [a._id.toString(), a]));
    const byArea = grouped
      .filter((g) => byId.has(g.areaId))
      .map((g) => {
        const a = byId.get(g.areaId);
        return {
          areaId: g.areaId,
          name: a.name,
          level: a.level,
          count: g.count,
        };
      });
    const total = byArea.reduce((sum, b) => sum + b.count, 0);
    return ok(res, { total, byArea, level }, 'Coverage-by-village fetched');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getTotalByCategory,
  getDistributionByArea,
  getMostUsedResources,
  getActiveEmergencyAssets,
  getCoverageByVillage,
};