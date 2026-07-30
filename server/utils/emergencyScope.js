/**
 * emergencyScope — centralized "is this area in emergency?" computation.
 *
 * Two read paths feed this util:
 *
 *   - Single-area check  (e.g. volunteer dashboard contact card,
 *     single-resource GET): `isAreaInEmergency({ areaId, lat, lng })`
 *
 *   - Bulk check         (e.g. resource list page with 50 resources
 *     in mixed areas): `isAreaInEmergencyBulk([{areaId,lat,lng}, ...])`
 *     — collapses to a fixed number of EmergencyActivation queries
 *     regardless of input size.
 *
 * Why the util is split out:
 *   The 6.3 era computed `areaEmergencyActive` by exact-id match
 *   against `Area.emergencyMode.isActive` (`server/controllers/request.controller.js:134-156`).
 *   That logic was correct for single-area exact match but didn't
 *   scale to (a) hierarchy cascades and (b) list-endpoint annotation.
 *   Centralising the computation lets the resource list controller,
 *   the request controller, and the analytics controller share one
 *   implementation.
 *
 * Hot read strategy:
 *   The HIERARCHY branch is `EmergencyActivation.find({
 *   isActive: true, descendantAreaIds: <areaId> })` — one $in query
 *   against the sparse `descendant_areas` index. The area tree walk
 *   happens ONCE at write time (the controller BFS-es the descendants
 *   and denormalises them onto the activation doc). The CIRCLE branch
 *   fetches active CIRCLE activations once and filters in-app
 *   (Bangladesh-scale active emergencies are tens, not thousands).
 *
 * Memoization:
 *   Each util export accepts an optional `_cache` parameter (an
 *   in-process Map keyed by the helper name + input args). The
 *   resource list controller keeps one Map per request and passes it
 *   through, so the page makes at most ~2 EmergencyActivation queries
 *   total regardless of `limit`.
 */

const Area = require('../models/Area');
const EmergencyActivation = require('../models/EmergencyActivation');
const User = require('../models/User');
// Lazy-import to avoid the circular dependency with
// notificationTriggers.js (which imports the EmergencyActivation
// model that loads this util indirectly through the trigger
// service module). The function is only used inside
// `resolveEmergencyRecipients`, which is itself called from
// controller code — by then the cache is warm.
let _moderatorRecipientsForArea = null;
function getModeratorRecipientsForArea() {
  if (_moderatorRecipientsForArea) return _moderatorRecipientsForArea;
  // eslint-disable-next-line global-require
  const triggerSvc = require('../services/notificationTriggers');
  _moderatorRecipientsForArea = triggerSvc.moderatorRecipientsForArea;
  return _moderatorRecipientsForArea;
}

const MAX_CHAIN_DEPTH = 16; // mirrors server/controllers/area.controller.js:33
const EARTH_RADIUS_METERS = 6378100; // mirrors resource.controller.js:281

/**
 * BFS down from `rootId`. Returns the full subtree INCLUDING the
 * root. Safe against malformed trees (cycles, orphans) via the
 * `seen` set + MAX_CHAIN_DEPTH cap.
 *
 * Returns `[rootId, ...descendants]` as ObjectIds.
 */
async function descendantAreaIds(rootId) {
  if (!rootId) return [];
  const out = [];
  const seen = new Set();
  let frontier = [rootId];
  let depth = 0;
  while (frontier.length > 0 && depth < MAX_CHAIN_DEPTH) {
    const next = [];
    for (const id of frontier) {
      const key = id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    if (seen.size >= Math.pow(2, depth + 1) && depth > 0) {
      // Pathological safety: bail before runaway fan-out.
      break;
    }
    const children = await Area.find({ parentId: { $in: frontier } })
      .select('_id')
      .lean();
    if (children.length === 0) break;
    frontier = children.map((c) => c._id);
    depth += 1;
  }
  return out;
}

/**
 * Walk UP from a leaf area to the root, returning the full ancestor
 * chain INCLUDING the leaf. Mirrors `getAreaChain` in
 * `server/controllers/area.controller.js:89-131` but does not depend
 * on Express — used inside hot helpers.
 *
 * Returns ObjectIds in leaf → root order.
 */
async function ancestorAreaIds(leafId) {
  if (!leafId) return [];
  const out = [];
  const seen = new Set();
  let cursorId = leafId;
  let depth = 0;
  while (cursorId && depth < MAX_CHAIN_DEPTH) {
    const key = cursorId.toString();
    if (seen.has(key)) break;
    seen.add(key);
    out.push(cursorId);
    const doc = await Area.findById(cursorId).select('parentId').lean();
    if (!doc || !doc.parentId) break;
    cursorId = doc.parentId;
    depth += 1;
  }
  return out;
}

/**
 * Filter out expired activations (the soft-expiry path). Cheap; runs
 * after the DB query so we can keep `isActive: true` indexed without
 * a partial filter on `expiresAt`.
 */
function isStillLive(doc, now = new Date()) {
  if (!doc || doc.isActive !== true) return false;
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * HIERARCHY check: is any active activation rooted at areaId or any
 * ancestor of areaId?
 *
 * Walks ancestors (≤5 deep in Bangladesh), then one $in query.
 * Memoizable via `_cache`.
 */
async function _hierarchyMatch(areaId, _cache) {
  if (!areaId) return false;
  const cacheKey = `hierarchy:${areaId.toString()}`;
  if (_cache && _cache.has(cacheKey)) return _cache.get(cacheKey);

  const ancestors = await ancestorAreaIds(areaId);
  if (ancestors.length === 0) {
    if (_cache) _cache.set(cacheKey, false);
    return false;
  }
  const docs = await EmergencyActivation.find({
    isActive: true,
    descendantAreaIds: { $in: ancestors.map((id) => id.toString()) },
    scope: EmergencyActivation.SCOPES.HIERARCHY,
  })
    .select('_id expiresAt isActive')
    .lean();
  const live = docs.some((d) => isStillLive(d));
  if (_cache) _cache.set(cacheKey, live);
  return live;
}

/**
 * CIRCLE check: does any active CIRCLE activation's radius cover
 * (lat, lng)?
 *
 * Fetches active CIRCLE rows once and filters in-app (cheap; this
 * util is memoized at the request level so the fetch only happens
 * once per request).
 */
async function _circleMatch(lat, lng, _cache) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const cacheKey = `circle:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  if (_cache && _cache.has(cacheKey)) return _cache.get(cacheKey);

  const docs = await EmergencyActivation.find({
    isActive: true,
    scope: EmergencyActivation.SCOPES.CIRCLE,
    center: { $exists: true, $ne: null },
  })
    .select('_id center radiusMeters expiresAt isActive')
    .lean();

  let live = false;
  for (const d of docs) {
    if (!isStillLive(d)) continue;
    if (!d.center || !Array.isArray(d.center.coordinates)) continue;
    if (!Number.isFinite(d.radiusMeters)) continue;
    const c = d.center.coordinates;
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (isPointWithinRadius(lng, lat, c[0], c[1], d.radiusMeters)) {
      live = true;
      break;
    }
  }
  if (_cache) _cache.set(cacheKey, live);
  return live;
}

/**
 * Great-circle distance check (Haversine). Returns true if the
 * distance from (lngA, latA) to (lngB, latB) is ≤ radiusMeters.
 *
 * Inlined (instead of importing from request.controller) so this
 * util stays self-contained.
 */
function isPointWithinRadius(lngA, latA, lngB, latB, radiusMeters) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = EARTH_RADIUS_METERS;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const lat1 = toRad(latA);
  const lat2 = toRad(latB);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(h));
  return dist <= radiusMeters;
}

/**
 * Single-area check. Returns true iff any active HIERARCHY activation
 * covers the area OR any active CIRCLE activation contains the
 * point.
 *
 * @param {Object} args
 * @param {String|ObjectId} args.areaId — leaf area to test
 * @param {Number} [args.lat] — optional latitude for CIRCLE match
 * @param {Number} [args.lng] — optional longitude for CIRCLE match
 * @param {Map} [args._cache] — request-scoped memo
 */
async function isAreaInEmergency({ areaId, lat, lng, _cache } = {}) {
  const [hier, circ] = await Promise.all([
    _hierarchyMatch(areaId, _cache),
    _circleMatch(lat, lng, _cache),
  ]);
  return hier === true || circ === true;
}

/**
 * Bulk check. Each input is `{ areaId, lat?, lng? }`. Returns a
 * Map<areaId-string, boolean>.
 *
 * Internally does ONE hierarchy fetch + ONE circle fetch, regardless
 * of input size. Memoization collapses duplicate (areaId,lat,lng)
 * tuples into single evaluations.
 */
async function isAreaInEmergencyBulk(items, _cache) {
  const out = new Map();
  if (!Array.isArray(items) || items.length === 0) return out;

  // Pre-compute the ancestor set for each distinct areaId. Bangladesh
  // is 5 deep max, so this is O(distinct-areas * 5).
  const distinctAreaIds = Array.from(
    new Set(
      items
        .map((it) => (it && it.areaId ? it.areaId.toString() : null))
        .filter(Boolean)
    )
  );

  const ancestorMap = new Map();
  for (const aid of distinctAreaIds) {
    const ancestors = await ancestorAreaIds(aid);
    ancestorMap.set(
      aid,
      ancestors.map((id) => id.toString())
    );
  }
  // Single hierarchy fetch: all activations whose rootAreaId is
  // somewhere in the union of every leaf's ancestor chain.
  const allRootIds = Array.from(
    new Set(
      Array.from(ancestorMap.values()).reduce(
        (acc, arr) => acc.concat(arr),
        []
      )
    )
  );
  const hierDocs =
    allRootIds.length > 0
      ? await EmergencyActivation.find({
          isActive: true,
          scope: EmergencyActivation.SCOPES.HIERARCHY,
          descendantAreaIds: { $in: allRootIds },
        })
          .select('_id descendantAreaIds expiresAt isActive')
          .lean()
      : [];

  // Build: for each leaf areaId, the set of active hierarchy roots
  // that cover it. A root covers a leaf if the leaf's ancestor set
  // contains the root. (Same semantics as _hierarchyMatch but bulk.)
  const hierCovers = new Map(); // areaId-string → Set<rootId-string>
  for (const aid of distinctAreaIds) {
    const ancestors = ancestorMap.get(aid);
    const matched = new Set();
    for (const d of hierDocs) {
      if (!isStillLive(d)) continue;
      const roots = Array.isArray(d.descendantAreaIds)
        ? d.descendantAreaIds.map((id) => id.toString())
        : [];
      for (const r of roots) {
        if (ancestors.includes(r)) matched.add(r);
      }
    }
    hierCovers.set(aid, matched);
  }

  // Single circle fetch.
  const circleDocs = await EmergencyActivation.find({
    isActive: true,
    scope: EmergencyActivation.SCOPES.CIRCLE,
    center: { $exists: true, $ne: null },
  })
    .select('_id center radiusMeters expiresAt isActive')
    .lean();

  // First pass: compute per-areaId CIRCLE coverage. Multiple items may
  // share the same areaId (e.g. 3 resources in the same union, only
  // one with a location). If ANY item at this areaId lands inside an
  // active CIRCLE, the whole areaId is considered covered — a single
  // resource inside the radius is enough to mark the area as in
  // emergency for list annotations (callers that need per-resource
  // precision use `isAreaInEmergency({ areaId, lat, lng })` directly).
  const circCovers = new Map(); // areaId-string → boolean
  for (const aid of distinctAreaIds) circCovers.set(aid, false);
  for (const it of items) {
    if (!it || !it.areaId) continue;
    const aid = it.areaId.toString();
    if (circCovers.get(aid) === true) continue;
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue;
    for (const d of circleDocs) {
      if (!isStillLive(d)) continue;
      if (!d.center || !Array.isArray(d.center.coordinates)) continue;
      if (!Number.isFinite(d.radiusMeters)) continue;
      const c = d.center.coordinates;
      if (
        isPointWithinRadius(it.lng, it.lat, c[0], c[1], d.radiusMeters)
      ) {
        circCovers.set(aid, true);
        break;
      }
    }
  }

  // Evaluate each item, aggregating per-areaId.
  for (const it of items) {
    if (!it || !it.areaId) {
      out.set('__null__', false);
      continue;
    }
    const aid = it.areaId.toString();
    const hierActive = (hierCovers.get(aid) || new Set()).size > 0;
    const circActive = circCovers.get(aid) === true;
    out.set(aid, hierActive || circActive);
  }

  return out;
}

/**
 * Resolve recipients for an activation. Two distinct pipelines:
 *
 *   HIERARCHY → Users whose `User.areaId` is in the activation's
 *               `descendantAreaIds` (mirrors `computeAreaEmergencyActive`
 *               at `request.controller.js:134-156`).
 *
 *   CIRCLE    → Users whose `User.location` (GeoJSON Point) falls
 *               within the activation's `center + radiusMeters`.
 *
 * Returns `{ owners: ObjectId[], moderators: ObjectId[],
 *           volunteers: ObjectId[], all: ObjectId[] }`. Caller picks
 * which groups to fan out to.
 *
 * Moderators for HIERARCHY scope are deduped across descendant
 * areas via the existing `moderatorRecipientsForArea` helper.
 */
async function resolveEmergencyRecipients(activation) {
  const owners = [];
  const volunteers = [];
  const moderators = [];

  if (!activation) return { owners, volunteers, moderators, all: [] };

  if (activation.scope === EmergencyActivation.SCOPES.HIERARCHY) {
    const areaIds = (activation.descendantAreaIds || []).map((id) =>
      id.toString()
    );
    if (areaIds.length === 0) {
      return { owners, volunteers, moderators, all: [] };
    }
    const users = await User.find({
      isActive: true,
      areaId: { $in: areaIds },
      role: { $in: [User.ROLES.OWNER, User.ROLES.VOLUNTEER] },
    })
      .select('_id role')
      .lean();
    for (const u of users) {
      if (u.role === User.ROLES.OWNER) owners.push(u._id);
      else if (u.role === User.ROLES.VOLUNTEER) volunteers.push(u._id);
    }
    // Moderators: dedupe across descendant area ids.
    const modSet = new Set();
    const moderatorRecipientsForArea = getModeratorRecipientsForArea();
    for (const aid of areaIds) {
      const mods = await moderatorRecipientsForArea(aid);
      for (const m of mods) modSet.add(m.toString());
    }
    for (const id of modSet) moderators.push(id);
  } else if (activation.scope === EmergencyActivation.SCOPES.CIRCLE) {
    if (
      !activation.center ||
      !Array.isArray(activation.center.coordinates) ||
      !Number.isFinite(activation.radiusMeters)
    ) {
      return { owners, volunteers, moderators, all: [] };
    }
    const [lng, lat] = activation.center.coordinates;
    const radiusRadians = activation.radiusMeters / EARTH_RADIUS_METERS;
    const users = await User.find({
      isActive: true,
      role: { $in: [User.ROLES.OWNER, User.ROLES.VOLUNTEER] },
      location: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusRadians],
        },
      },
    })
      .select('_id role')
      .lean();
    for (const u of users) {
      if (u.role === User.ROLES.OWNER) owners.push(u._id);
      else if (u.role === User.ROLES.VOLUNTEER) volunteers.push(u._id);
    }
    // Moderators in the area whose location also falls in the circle.
    const mods = await User.find({
      role: User.ROLES.MODERATOR,
      isActive: true,
      location: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusRadians],
        },
      },
    })
      .select('_id')
      .lean();
    for (const m of mods) moderators.push(m._id);
  }

  const all = [...owners, ...volunteers, ...moderators];
  return { owners, volunteers, moderators, all };
}

module.exports = {
  ancestorAreaIds,
  descendantAreaIds,
  emergencyScopeAreaIdsForRoot: descendantAreaIds, // alias for callers
  isAreaInEmergency,
  isAreaInEmergencyBulk,
  resolveEmergencyRecipients,
  isStillLive,
  isPointWithinRadius,
  EARTH_RADIUS_METERS,
  MAX_CHAIN_DEPTH,
};