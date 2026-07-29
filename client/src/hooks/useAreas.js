/**
 * useAreas — TanStack Query wrappers for the cascading area fetch.
 *
 * Re-exported from a single module so the AreaSelector component can
 * pull in everything it needs in one import. Each hook maps to a
 * query-key scope so cache invalidation is precise and the same
 * dropdown shouldn't refetch on every render.
 *
 * Cache strategy:
 *   - `useDistricts()` is rare (only on first mount) and prefetched.
 *   - `useChildren({ parentId })` is keyed on the parentId; refetching
 *     one slice won't nuke the rest of the cascade.
 *   - Default staleTime is 5 minutes — admin hierarchy is essentially
 *     static, so we don't need to keep hitting the server.
 *
 * Module 2.2.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Fetch one slice of the area tree.
 *
 * @param {object}  opts
 * @param {string} [opts.level]   - DISTRICT | UPAZILA | UNION | WARD | VILLAGE
 * @param {string} [opts.parentId] - 24-char ObjectId hex of the parent node
 * @param {boolean} [opts.enabled] - skip the request when false
 * @returns UseQueryResult<{data: {areas, count}}>
 */
export function useAreas({ level, parentId, enabled = true } = {}) {
  const hasLevel = Boolean(level);
  const hasParent = Boolean(parentId);
  // We only fire when the caller passed at least one of the two and
  // — when parentId is set — it's a non-empty string. The server
  // already enforces the level/parent minimum, but short-circuiting
  // here keeps the queryKey stable across renders.
  const ok = enabled && (hasLevel || hasParent);

  return useQuery({
    queryKey: ['areas', { level: level || null, parentId: parentId || null }],
    enabled: ok,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const params = {};
      if (level) params.level = level;
      if (parentId) params.parent = parentId;
      const { data } = await api.get('/areas', { params });
      return data?.data || { areas: [], count: 0 };
    },
  });
}

/**
 * Convenience wrapper: list all top-level districts.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 */
export function useDistricts({ enabled = true } = {}) {
  return useAreas({ level: 'DISTRICT', enabled });
}

/**
 * Convenience wrapper: list children of a specific parent node.
 *
 * IMPORTANT: `parentId` is OPTIONAL here. The hook passes `enabled`
 * through to `useAreas` instead of gating on `parentId` being truthy,
 * so the caller can ask for "all districts" (parentId null + level
 * DISTRICT) the same way they ask for "all children of X".
 *
 * @param {object} opts
 * @param {string} [opts.parentId]
 * @param {string} [opts.level] - optional, used to filter children by level
 * @param {boolean} [opts.enabled=true]
 */
export function useChildren({ parentId, level, enabled = true } = {}) {
  return useAreas({ parentId, level, enabled });
}

/**
 * Resolve a single area id to its full ancestor chain (root → leaf).
 * Used by the profile page so a stored `areaId` can be displayed as a
 * hierarchy label even when the picker is in read-only mode.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.areaId]   - 24-char ObjectId hex. Query is
 *                                    disabled when null/undefined.
 * @param {boolean} [opts.enabled=true]
 * @returns UseQueryResult<{data: {area, chain}}>
 *
 * The result `chain` is an array of `{ id, level, name }` from root
 * to leaf — e.g. for a VILLAGE id it looks like:
 *   [
 *     { level: 'DISTRICT', name: 'Dhaka' },
 *     { level: 'UPAZILA',  name: 'Gulshan' },
 *     { level: 'UNION',    name: '...' },
 *     ...
 *     { level: 'VILLAGE',  name: '...' }, // leaf — matches `area`
 *   ]
 */
export function useAreaChain({ areaId, enabled = true } = {}) {
  const ok = enabled && typeof areaId === 'string' && areaId.length > 0;
  return useQuery({
    queryKey: ['area-chain', areaId || null],
    enabled: ok,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const { data } = await api.get(`/areas/${encodeURIComponent(areaId)}`);
      return data?.data || { area: null, chain: [] };
    },
  });
}