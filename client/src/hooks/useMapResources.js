/**
 * useMapResources — TanStack Query wrapper for the bulk resource list
 * the map view (Module 4.3) needs.
 *
 * The map can't paginate — a user expects to see ALL geo-located
 * resources in one go. So we wrap a `useQuery` (NOT a `useInfiniteQuery`)
 * around GET /api/resources with a generous `limit`. The server caps
 * its own `limit` at 50 (Module 3.2's MAX_LIMIT); we set limit to 50
 * for the first pass. Resources without a location are filtered out
 * client-side in MapViewPage.
 *
 * Filters supported here mirror the map view's URL params (category +
 * status + a single active search location). The location is forwarded
 * to the server as `lat` / `lng` / `radius` (meters); the controller
 * already supports it via `$geoWithin / $centerSphere` (see
 * server/controllers/resource.controller.js). When any of the three
 * location values is missing/non-finite, the geo filter is dropped so
 * the request still works.
 *
 * Other filters (q, areaId, minCapacity) are intentionally NOT wired
 * because the map's UX only exposes category + status + location. If
 * we needed the rest later we'd share the helpers from
 * useResourceSearch instead of duplicating them.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

// Server's MAX_LIMIT is 50 (server/controllers/resource.controller.js).
// We match that here so we get one server round-trip's worth of pins.
// A future module can switch this to multiple paginated calls if
// the catalog grows past 50 geo-located resources.
const MAP_LIMIT = 50;

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function locationKey(location) {
  if (
    !location ||
    !isFiniteNumber(location.lat) ||
    !isFiniteNumber(location.lng) ||
    !isFiniteNumber(location.radius)
  ) {
    return 'no-location';
  }
  // The radius is in km on the URL but the server expects meters —
  // bake the converted value into the cache key so a future unit
  // change doesn't accidentally reuse a stale response.
  return `${location.lat},${location.lng},${Math.round(location.radius * 1000)}`;
}

function buildParams(filters, location) {
  const params = { limit: MAP_LIMIT };
  if (filters && filters.category) params.category = filters.category;
  if (filters && filters.status) params.status = filters.status;
  if (
    location &&
    isFiniteNumber(location.lat) &&
    isFiniteNumber(location.lng) &&
    isFiniteNumber(location.radius)
  ) {
    params.lat = location.lat;
    params.lng = location.lng;
    // Server's cap is 100 km (server MAX_RADIUS_METERS). The map's
    // UI options (1/2/5/10/25/50) are well within that.
    params.radius = Math.min(Math.round(location.radius * 1000), 100000);
  }
  return params;
}

function hashFilters(filters) {
  const obj = {};
  for (const k of Object.keys(filters || {}).sort()) {
    const v = filters[k];
    if (v === '' || v == null) continue;
    obj[k] = v;
  }
  return JSON.stringify(obj);
}

/**
 * @param {object} [filters]
 * @param {string|null} [filters.category]
 * @param {string|null} [filters.status]
 * @param {object} [location]
 * @param {number} [location.lat]
 * @param {number} [location.lng]
 * @param {number} [location.radius] - radius in KILOMETERS (the hook
 *   converts to meters for the API call).
 */
export function useMapResources(filters = {}, location = null) {
  const filtersHash = hashFilters(filters);
  const locKey = locationKey(location);
  return useQuery({
    queryKey: ['map-resources', filtersHash, locKey],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data } = await api.get('/resources', {
        params: buildParams(filters, location),
      });
      return (
        data?.data || { resources: [], pagination: { total: 0, page: 1 } }
      );
    },
  });
}
