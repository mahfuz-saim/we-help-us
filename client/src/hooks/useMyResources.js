/**
 * useMyResources — TanStack Query for the owner dashboard (Module 3.5).
 *
 * Wraps GET /api/resources?mine=1 + status filter + pagination so the
 * dashboard only fetches the caller's own resources. Cache key is
 * scoped to (status filter, page) so a "Available" tab doesn't nuke
 * the "All" tab.
 *
 * The mutation hooks (toggleStatus, deleteResource) live alongside so
 * the page can call them without importing react-query primitives
 * directly. They invalidate the matching query keys on success so the
 * UI stays consistent after a mutation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Fetch the caller's resources.
 *
 * @param {object} [opts]
 * @param {string} [opts.status]  - one of AVAILABLE / RESERVED / IN_USE /
 *                                   UNAVAILABLE, or omitted for all
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @param {boolean} [opts.enabled=true]
 */
export function useMyResources({
  status,
  page = 1,
  limit = 50,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: ['my-resources', { status: status || null, page, limit }],
    enabled,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const params = { mine: 1, page, limit };
      if (status) params.status = status;
      const { data } = await api.get('/resources', { params });
      // Returns { resources: [...], pagination: {...} }
      return data?.data || { resources: [], pagination: { total: 0, page: 1, limit, pages: 1 } };
    },
  });
}

/**
 * Flip a resource to AVAILABLE or UNAVAILABLE. PATCH /api/resources/:id
 * is owner-only on the server (Module 3.2), so this mutation is safe to
 * call from the dashboard; the server 403s anything else.
 *
 * @returns UseMutationResult
 */
export function useToggleAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nextStatus }) => {
      const { data } = await api.patch(`/resources/${id}`, { status: nextStatus });
      return data?.data?.resource || null;
    },
    onSuccess: () => {
      // Invalidate every my-resources cache key so a "Available" tab
      // + the "All" tab both refresh.
      qc.invalidateQueries({ queryKey: ['my-resources'] });
    },
  });
}

/**
 * Delete a resource. The server's DELETE /api/resources/:id is owner-OR-
 * moderator (KEY DESIGN REMINDER); from the dashboard we always call it
 * as the owner. The server is the source of truth for ownership; the
 * mutation relies on that.
 */
export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.delete(`/resources/${id}`);
      return data?.data || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-resources'] });
    },
  });
}
