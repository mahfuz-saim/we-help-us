/**
 * useModeratorRequests — TanStack Query for the moderator request
 * dashboard (Module 5.5).
 *
 * Wraps the MODERATOR side of GET /api/requests. For a MODERATOR
 * caller the server joins through Resource.areaId === req.user.areaId
 * and returns the area-scoped slice, so the dashboard never sends a
 * `mine` flag — the server enforces the scope. A moderator without an
 * areaId gets an empty list (the controller returns { requests: [] }
 * before touching the database).
 *
 * Action hook the MODERATOR can fire from this surface:
 *   - useRejectModeratorRequest — PATCH /api/requests/:id/reject
 *     (REQUESTED/APPROVED → REJECTED; if the request was APPROVED, the
 *     server un-RESERVES the resource back to AVAILABLE).
 *
 * Moderators CANNOT approve / collect / return / complete — those
 * endpoints return 403 for moderator tokens. The dashboard deliberately
 * exposes only the Reject CTA so the UI doesn't invite actions the
 * server will reject.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The hook NEVER calls /api/users/:id or /api/auth/me. Owner /
 *     volunteer contact info NEVER arrives through this list. The
 *     populated fields are name + resource-title only; the
 *     single-request GET /:id endpoint restricts to
 *     principal-or-admin (server controller line ~451), and the
 *     moderator is intentionally not in that scope — there's no
 *     reason for the moderator dashboard to phone home for contact
 *     info. PrivacyFooter on the page explains this to the user.
 *   - The hook's mutations are the ONLY outbound calls; the list is
 *     a single GET.
 *
 * Cache keys:
 *   - ['moderator-requests', {status, page, limit}] — the list.
 *   - ['moderator-requests', {pendingCount: true}] — the badge.
 *   - Mutations invalidate the list so status pills update after a
 *     reject.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

/**
 * Fetch the moderator's area-scoped requests.
 *
 * @param {object} [opts]
 * @param {string} [opts.status]   - one of the 6 REQUEST_STATUS values, or omitted
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.enabled=true]
 */
export function useModeratorRequests({
  status,
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: ['moderator-requests', { status: status || null, page, limit }],
    enabled,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const params = { page, limit };
      if (status) params.status = status;
      const { data } = await api.get('/requests', { params });
      return (
        data?.data || {
          requests: [],
          pagination: { total: 0, page: 1, limit, pages: 1 },
        }
      );
    },
  });
}

/**
 * Reject a REQUESTED or APPROVED request on behalf of the area. The
 * server flips the request to REJECTED and (if the request had
 * reached APPROVED) un-RESERVES the resource. Moderators can attach
 * a `moderatorNote` explaining the decision; the note is visible to
 * the volunteer (via GET /api/requests/:id, principal-only) and to
 * the owner (via the owner's list endpoint, also role-scoped).
 *
 * @param {object} payload
 * @param {string} payload.id              - request id
 * @param {string} [payload.moderatorNote] - optional reason/note (≤1000 chars)
 */
export function useRejectModeratorRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, moderatorNote } = {}) => {
      const payload = moderatorNote ? { moderatorNote } : {};
      const { data } = await api.patch(`/requests/${id}/reject`, payload);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moderator-requests'] });
    },
  });
}

/**
 * Pending-count badge used by the moderator dashboard header:
 * the number of REQUESTED requests in the moderator's area. Fetched
 * with `?status=REQUESTED` so the badge tracks the queue the moderator
 * is supposed to clear. APPROVED is the owner's pending decision,
 * not the moderator's — it shows up on the badge only as a side
 * effect of total counts on the page (FilterBar).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 * @returns UseQueryResult<{total: number}>
 */
export function useModeratorRequestCount({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['moderator-requests', { pendingCount: true }],
    enabled,
    staleTime: ONE_MINUTE,
    queryFn: async () => {
      const { data } = await api.get('/requests', {
        params: { status: 'REQUESTED', page: 1, limit: 100 },
      });
      return { total: data?.data?.pagination?.total || 0 };
    },
  });
}