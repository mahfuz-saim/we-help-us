/**
 * useAdminVolunteers — TanStack Query for the admin volunteer directory
 * (Module: Volunteers Tab — Admin Panel).
 *
 * Wraps GET /api/admin/volunteers. Admin is global (not area-scoped),
 * so without an `areaId` filter the response is every volunteer on
 * the platform. Optional filters:
 *   - areaId:    a 24-char hex ObjectId narrowing to one area
 *                (any level — district / upazila / union / ward / village)
 *   - isVerified: 'all' (default) | 'true' | 'false'
 *   - page, limit: pagination
 *
 * The server enforces pagination + area-id format (see
 * `volunteersAdminQuerySchema` in server/validators/admin.validators.js).
 * Privacy: the response shape is `publicUserDirectory` from the
 * moderator controller — NEVER includes email, phone, or password.
 * This hook does NOT augment that with anything richer; if a row's
 * `isVerified` flips, we re-fetch (mutation invalidates the key).
 *
 * Cache key: ['admin-volunteers', { areaId, isVerified, page, limit }]
 * 30s staleTime mirrors `useAdminModerators` — the directory changes
 * infrequently and the volunteer list is small enough that a manual
 * "refresh" is unnecessary for routine admin work.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const THIRTY_SECONDS = 30 * 1000;

/**
 * Fetch the volunteer directory scoped to the admin's view.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.areaId]    - ObjectId hex, or null for all.
 * @param {'all'|'true'|'false'} [opts.isVerified='all']
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export function useAdminVolunteers({
  areaId = null,
  isVerified = 'all',
  page = 1,
  limit = 20,
} = {}) {
  return useQuery({
    queryKey: [
      'admin-volunteers',
      { areaId: areaId || null, isVerified, page, limit },
    ],
    staleTime: THIRTY_SECONDS,
    queryFn: async () => {
      const params = { page, limit };
      if (areaId) params.areaId = areaId;
      if (isVerified === 'true' || isVerified === 'false') {
        params.isVerified = isVerified;
      }
      const { data } = await api.get('/admin/volunteers', { params });
      return (
        data?.data || {
          volunteers: [],
          pagination: { total: 0, page, limit, pages: 1 },
        }
      );
    },
  });
}
