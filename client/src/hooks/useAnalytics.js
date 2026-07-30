/**
 * useAnalytics — Module 8.2.
 *
 * TanStack Query v5 wrappers over Module 8.1's five analytics endpoints.
 * The server-side surface is read-only, role-gated (MODERATOR/ADMIN),
 * and area-scoped for moderators. The endpoints:
 *
 *   - GET /api/analytics/total-by-category       → useTotalByCategory()
 *   - GET /api/analytics/distribution-by-area    → useDistributionByArea({level, limit})
 *   - GET /api/analytics/most-used-resources     → useMostUsedResources({limit})
 *   - GET /api/analytics/active-emergency-assets → useActiveEmergencyAssets()
 *   - GET /api/analytics/coverage-by-village     → useCoverageByVillage({level})
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   The 8.1 controller never exposes email / phone / password — every
 *   payload is a roll-up (counts, area summaries, resource summaries
 *   via the privacy-stripped publicResource() helper from 3.2). The
 *   hooks below consume those payloads as-is. The hooks NEVER call
 *   /users/:id or /auth/me.
 *
 * The hooks are read-only — there are no mutations. We do, however,
 * expose `invalidateAll()` as a convenience so the page header's
 * "Refresh" CTA can re-fetch every slice at once.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

import api from '../services/api';

export const ANALYTICS_QUERY_KEY = 'analytics';

/**
 * Strip JS comments (line + block) before regex matching. We use this
 * to keep the privacy walker from being fooled by an `api.get('/users/...')`
 * string in a doc-block comment — the smoke test enforces that the
 * analytics hooks NEVER reach for /users/:id or /auth/me.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Helper that unwraps the analytics controller's `ok()` envelope. Every
 * endpoint returns `{ success: true, data, message }`; the hooks only
 * care about `data`.
 */
function unwrap(res) {
  return res?.data?.data || null;
}

/**
 * GET /api/analytics/total-by-category — no params. Returns
 * `{ total, byCategory: [{ category, count }, ...] }`. The server
 * always emits the canonical 6-bucket list (zeros for empty categories),
 * so the chart renders a stable shape even when the moderator has no
 * scope or a category has zero resources.
 */
export function useTotalByCategory({ enabled } = {}) {
  return useQuery({
    queryKey: [ANALYTICS_QUERY_KEY, 'total-by-category'],
    enabled: enabled !== false,
    queryFn: async () => {
      const res = await api.get('/analytics/total-by-category');
      return unwrap(res);
    },
    staleTime: 60 * 1000,
  });
}

/**
 * GET /api/analytics/distribution-by-area. Optional `level`
 * (DISTRICT|UPAZILA|UNION|WARD|VILLAGE) rolls up to a chosen level;
 * `limit` (1..50) caps the bucket list.
 */
export function useDistributionByArea({ level, limit, enabled } = {}) {
  return useQuery({
    queryKey: [
      ANALYTICS_QUERY_KEY,
      'distribution-by-area',
      { level: level || null, limit: limit || null },
    ],
    enabled: enabled !== false,
    queryFn: async () => {
      const params = {};
      if (level) params.level = level;
      if (limit) params.limit = limit;
      const res = await api.get('/analytics/distribution-by-area', { params });
      return unwrap(res);
    },
    staleTime: 60 * 1000,
  });
}

/**
 * GET /api/analytics/most-used-resources. Optional `limit` (1..50,
 * default 10) caps the top-N table.
 */
export function useMostUsedResources({ limit, enabled } = {}) {
  return useQuery({
    queryKey: [
      ANALYTICS_QUERY_KEY,
      'most-used-resources',
      { limit: limit || null },
    ],
    enabled: enabled !== false,
    queryFn: async () => {
      const params = {};
      if (limit) params.limit = limit;
      const res = await api.get('/analytics/most-used-resources', { params });
      return unwrap(res);
    },
    staleTime: 60 * 1000,
  });
}

/**
 * GET /api/analytics/active-emergency-assets — no params. Returns the
 * areas currently in emergency mode + the resources deployed in those
 * areas (broken down by status, with a privacy-stripped sample).
 */
export function useActiveEmergencyAssets({ enabled } = {}) {
  return useQuery({
    queryKey: [ANALYTICS_QUERY_KEY, 'active-emergency-assets'],
    enabled: enabled !== false,
    queryFn: async () => {
      const res = await api.get('/analytics/active-emergency-assets');
      return unwrap(res);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * GET /api/analytics/coverage-by-village. Optional `level` (default
 * VILLAGE) selects the roll-up level for the per-area count grid.
 */
export function useCoverageByVillage({ level, enabled } = {}) {
  return useQuery({
    queryKey: [
      ANALYTICS_QUERY_KEY,
      'coverage-by-village',
      { level: level || null },
    ],
    enabled: enabled !== false,
    queryFn: async () => {
      const params = {};
      if (level) params.level = level;
      const res = await api.get('/analytics/coverage-by-village', { params });
      return unwrap(res);
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Convenience: invalidate every analytics slice so a single click
 * re-fetches the whole dashboard. Used by the page's "Refresh" CTA.
 */
export function useInvalidateAnalytics() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [ANALYTICS_QUERY_KEY] });
}

// Re-export the comment-stripping helper for tests.
export { stripComments };