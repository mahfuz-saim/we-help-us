/**
 * useResourceSearch — TanStack Query v5 infinite query for Module 4.1.
 *
 * Wraps GET /api/resources so the SearchPage can paginate via "Load
 * more" without rebuilding the URL or managing page state itself.
 *
 * The hook is filter-aware: changing any filter resets the list to
 * page 1 (TanStack's `useInfiniteQuery` does this automatically when
 * the queryKey changes). Cache key:
 *
 *   ['resource-search', stableFilterHash]
 *
 * where `stableFilterHash = JSON.stringify(filters)` (deterministic
 * ordering via a sorted key list below).
 *
 * Distance filter: if the caller supplies `distanceKm` AND the
 * signed-in user has a `location`, we pass `lat/lng/radius` to the
 * server. The search page is responsible for reading the user object
 * (so this hook stays pure).
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import api from '../services/api';

const DEFAULT_PAGE_SIZE = 12;

/**
 * @typedef {object} ResourceSearchFilters
 * @property {string|null} [category]         - one of CATEGORY_VALUES or null
 * @property {string|null} [status]           - one of RESOURCE_STATUS values or null
 * @property {string|null} [areaId]           - 24-char ObjectId hex or null
 * @property {string}       [q]               - keyword (1-120 chars)
 * @property {number|null}  [minCapacity]     - inclusive minimum capacity
 * @property {number|null}  [distanceKm]      - geo distance (km) when user has a saved location
 * @property {[number, number]|null} [userLocation]  - [lng, lat] of the signed-in user
 */

function pickUserCoords(user) {
  if (!user) return null;
  const loc = user.location;
  if (!loc || !Array.isArray(loc.coordinates) || loc.coordinates.length !== 2) {
    return null;
  }
  const [lng, lat] = loc.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/**
 * Build the axios params object from the filter shape. Only includes
 * keys the server actually understands (Module 4.1's extended list
 * endpoint).
 */
function buildParams(filters, user) {
  const params = { page: undefined, limit: DEFAULT_PAGE_SIZE };
  if (filters.category) params.category = filters.category;
  if (filters.status) params.status = filters.status;
  if (filters.areaId) params.areaId = filters.areaId;
  if (filters.q) params.q = filters.q;
  if (filters.minCapacity != null && filters.minCapacity !== '') {
    params.minCapacity = String(Number(filters.minCapacity));
  }
  if (filters.distanceKm != null && filters.distanceKm !== '') {
    const coords = pickUserCoords(user);
    if (coords) {
      params.lat = coords[1]; // [lng, lat] -> lat second
      params.lng = coords[0];
      // radius is meters (server's cap is 100km).
      params.radius = Math.min(
        Math.round(Number(filters.distanceKm) * 1000),
        100000
      );
    }
  }
  // Drop undefined keys so the URL stays clean.
  Object.keys(params).forEach((k) => {
    if (params[k] === undefined) delete params[k];
  });
  return params;
}

/**
 * Stable hash of the filters for the query key. We sort the keys so
 * `{category, status}` and `{status, category}` produce the same key.
 */
function hashFilters(filters) {
  const obj = {};
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k];
    if (v === '' || v == null) continue;
    obj[k] = v;
  }
  return JSON.stringify(obj);
}

/**
 * @param {ResourceSearchFilters} [filters]
 * @param {object} [opts]
 * @param {object} [opts.user]        - The signed-in user object (from AuthContext).
 *                                      We read `user.location` for the distance filter.
 * @param {boolean} [opts.enabled=true]
 */
export function useResourceSearch(filters = {}, { user = null, enabled = true } = {}) {
  const hash = hashFilters(filters);
  const userCoords = pickUserCoords(user);
  const locationKey = userCoords ? userCoords.join(',') : 'no-location';

  return useInfiniteQuery({
    queryKey: ['resource-search', hash, locationKey],
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = buildParams(filters, user);
      params.page = String(pageParam);
      const { data } = await api.get('/resources', { params });
      // Server response shape: { success, data: { resources, pagination } }
      return (
        data?.data || {
          resources: [],
          pagination: { page: pageParam, limit: DEFAULT_PAGE_SIZE, total: 0, pages: 1 },
        }
      );
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage || !lastPage.pagination) return undefined;
      const { page, pages } = lastPage.pagination;
      if (page < pages) return page + 1;
      return undefined;
    },
  });
}