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
 * status). Other filters (q, areaId, minCapacity, lat/lng/radius) are
 * intentionally NOT wired because the map's UX only exposes category
 * + status. If we needed the rest later we'd share the helpers from
 * useResourceSearch instead of duplicating them.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

// Server's MAX_LIMIT is 50 (server/controllers/resource.controller.js).
// We match that here so we get one server round-trip's worth of pins.
// A future module can switch this to multiple paginated calls if
// the catalog grows past 50 geo-located resources.
const MAP_LIMIT = 50;

function buildParams(filters) {
  const params = { limit: MAP_LIMIT };
  if (filters && filters.category) params.category = filters.category;
  if (filters && filters.status) params.status = filters.status;
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
 */
export function useMapResources(filters = {}) {
  const hash = hashFilters(filters);
  return useQuery({
    queryKey: ['map-resources', hash],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data } = await api.get('/resources', {
        params: buildParams(filters),
      });
      return (
        data?.data || { resources: [], pagination: { total: 0, page: 1 } }
      );
    },
  });
}
