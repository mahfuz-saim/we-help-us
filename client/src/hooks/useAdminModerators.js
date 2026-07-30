/**
 * useAdminModerators — TanStack Query for the admin's moderator list
 * page.
 *
 * Wraps `GET /api/admin/moderators`. The server returns a global list
 * of every MODERATOR account on the platform (admins are not area-
 * scoped), shaped via the privacy-safe `publicUserDirectory()` helper
 * — so the response NEVER contains email / phone / password.
 *
 * Cache strategy: 30s staleTime, matches the rest of the app's
 * admin / dashboard surface. The mutation (`useCreateAdminModerator`)
 * invalidates the list on success so a freshly created row appears
 * immediately.
 *
 * Privacy (KEY DESIGN REMINDER): admin list endpoints are scoped to
 * `publicUserDirectory` server-side. The hook does NOT need any
 * extra filtering — anything the server emits is safe to render.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const THIRTY_SECONDS = 30 * 1000;

/**
 * Fetch every moderator on the platform.
 *
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.enabled=true]
 */
export function useAdminModerators({
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: ['admin-moderators', { page, limit }],
    enabled,
    staleTime: THIRTY_SECONDS,
    queryFn: async () => {
      const { data } = await api.get('/admin/moderators', {
        params: { page, limit },
      });
      return (
        data?.data || {
          moderators: [],
          pagination: { total: 0, page: 1, limit, pages: 1 },
        }
      );
    },
  });
}

/**
 * Create a new MODERATOR account via the existing
 * `POST /api/admin/create-privileged-user` endpoint with
 * `role: 'MODERATOR'` hardcoded. Only the minimum mandatory fields
 * (name, email, phone, password) are sent — the moderator completes
 * areaId / location / etc. from their profile page after first login.
 *
 * @returns UseMutationResult<{user, token}, Error, {name, email, phone, password}>
 */
export function useCreateAdminModerator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, email, phone, password } = {}) => {
      const { data } = await api.post('/admin/create-privileged-user', {
        name,
        email,
        phone,
        password,
        role: 'MODERATOR',
      });
      return data?.data || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-moderators'] });
    },
  });
}