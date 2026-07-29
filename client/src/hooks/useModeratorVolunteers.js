/**
 * useModeratorVolunteers — TanStack Query for the moderator-side
 * volunteer directory (Module: Volunteers Tab — Moderator Panel).
 *
 * Wraps GET /api/moderator/volunteers. The server is the source of
 * truth for area scoping — moderators are filtered to their own
 * `areaId` automatically. Admins calling this endpoint see the global
 * list (matches the moderator endpoint's `areaScopeFor()` helper).
 *
 * Optional filters passed straight through:
 *   - isVerified: 'all' (default) | 'true' | 'false'
 *   - page, limit: pagination
 *
 * There is NO `areaId` param — moderators cannot pick another area
 * (the server rejects any attempt to broaden). The UI mirrors this by
 * showing the moderator's area label in the header instead of a
 * picker.
 *
 * Privacy: response is `publicUserDirectory` — no email, phone, or
 * password. The hook does not augment that.
 *
 * Cache key: ['moderator-volunteers', { isVerified, page, limit }]
 * 30s staleTime mirrors `useAdminVolunteers`.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const THIRTY_SECONDS = 30 * 1000;

/**
 * Fetch the volunteer directory scoped to the moderator's area.
 *
 * @param {object} [opts]
 * @param {'all'|'true'|'false'} [opts.isVerified='all']
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 */
export function useModeratorVolunteers({
  isVerified = 'all',
  page = 1,
  limit = 20,
} = {}) {
  return useQuery({
    queryKey: ['moderator-volunteers', { isVerified, page, limit }],
    staleTime: THIRTY_SECONDS,
    queryFn: async () => {
      const params = { page, limit };
      if (isVerified === 'true' || isVerified === 'false') {
        params.isVerified = isVerified;
      }
      const { data } = await api.get('/moderator/volunteers', { params });
      return (
        data?.data || {
          volunteers: [],
          pagination: { total: 0, page, limit, pages: 1 },
        }
      );
    },
  });
}
