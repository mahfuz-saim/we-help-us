/**
 * useOwnerRequests — TanStack Query for the owner request inbox (Module 5.4).
 *
 * Wraps the OWNER side of GET /api/requests. For an OWNER caller the
 * server narrows the list to requests whose ownerId === req.user._id,
 * so the dashboard never sends a `mine` flag — the server enforces
 * the scope. Module 5.4 also relies on the controller's list-level
 * populate (volunteerSummary.name + resource.title) so the inbox
 * can render names + titles without a second round-trip per row.
 *
 * Action hooks the OWNER can fire from this surface:
 *   - useApproveRequest  — PATCH /api/requests/:id/approve   (REQUESTED → APPROVED)
 *   - useRejectRequest   — PATCH /api/requests/:id/reject    (REQUESTED/APPROVED → REJECTED)
 *   - useCompleteRequest — PATCH /api/requests/:id/complete  (RETURNED → AVAILABLE on Resource)
 *
 * Mutations return the updated request. None of them surface contact
 * info — privacy remains gated on the COLLECT response per the 5.2
 * controller. The OWNER inbox only reveals volunteer name + email/
 * phone once the volunteer has marked the resource COLLECTED (and
 * even then, only after the OWNER-facing surfaces in 5.4's page
 * explicitly fetch the single request via the GET /:id endpoint,
 * which carries `revealContacts: true` for the principal).
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The hook NEVER calls /api/users/:id or /api/auth/me. Owner/
 *     volunteer contact info NEVER arrives through the list — the
 *     populated fields are name + id + title only. The single-request
 *     GET is the only path through which contact reveals flow into
 *     the OWNER side (mirrors the symmetry of 5.3's COLLECTED card).
 *   - The hook's mutations are the ONLY outbound calls; the list is
 *     a single GET.
 *
 * Cache keys:
 *   - ['owner-requests', {status, page, limit}] — the list.
 *   - Mutations invalidate the list so status pills / action buttons
 *     update after a transition.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Fetch the owner's incoming requests.
 *
 * @param {object} [opts]
 * @param {string} [opts.status]   - one of the 6 REQUEST_STATUS values, or omitted
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.enabled=true]
 */
export function useOwnerRequests({
  status,
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: ['owner-requests', { status: status || null, page, limit }],
    enabled,
    staleTime: FIVE_MINUTES,
    queryFn: async () => {
      const params = { page, limit };
      if (status) params.status = status;
      const { data } = await api.get('/requests', { params });
      // Returns { requests: [...], pagination: {...} }
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
 * Approve a REQUESTED request. The server flips the request to
 * APPROVED and the underlying Resource to RESERVED atomically.
 *
 * Returns the updated request on success. No contact reveal (status
 * is APPROVED, not yet COLLECTED).
 */
export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/requests/${id}/approve`);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-requests'] });
    },
  });
}

/**
 * Reject a REQUESTED or APPROVED request. The server flips the
 * request to REJECTED and (if the request had reached APPROVED)
 * un-RESERVES the resource. Owners can attach a `moderatorNote`.
 *
 * @param {object} [opts]
 * @param {string} [opts.moderatorNote] - optional reason/note
 */
export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, moderatorNote } = {}) => {
      const payload = moderatorNote ? { moderatorNote } : {};
      const { data } = await api.patch(`/requests/${id}/reject`, payload);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-requests'] });
    },
  });
}

/**
 * Confirm the resource is back in the owner's hands (the volunteer's
 * RETURNED status is the trigger). The server flips the underlying
 * Resource back to AVAILABLE; the request itself stays RETURNED
 * (terminal — there's no "completed" status on the request).
 *
 * No contact reveal — the gate is COLLECTED, this fires from
 * RETURNED.
 */
export function useCompleteRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/requests/${id}/complete`);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-requests'] });
    },
  });
}

/**
 * Lightweight counter used by the OwnerDashboard header (Module 5.4):
 * the number of active incoming requests (REQUESTED + APPROVED +
 * COLLECTED — anything that needs the owner's attention before the
 * resource returns to the catalog). Fetches once with a large enough
 * `limit` to cover typical owner load; if an owner ever scales past
 * this we'd add pagination on the dashboard counter (out of scope).
 *
 * Mirrors the same server-side role-scoping as the rest of the hook —
 * for OWNER callers the server filters to ownerId===me automatically.
 *
 * @returns UseQueryResult — data shaped as `{ total: number }`. The
 *          dashboard treats a missing total as zero.
 */
export function useActiveRequestCount({ enabled = true } = {}) {
  return useQuery({
    // Big page so a single round-trip is enough for the dashboard
    // badge; the OWNER's normal inbox UX lives in OwnerRequestsPage
    // which has its own paginated query.
    queryKey: ['owner-requests', { activeCount: true }],
    enabled,
    staleTime: 60 * 1000, // 1-minute freshness on the dashboard counter
    queryFn: async () => {
      // We need the role to gate the request; the server treats
      // every OWNER caller's response as already filtered to
      // ownerId===me. Use a couple of narrow status filters so the
      // counter reflects "needs attention" rather than total. We pick
      // REQUESTED + APPROVED for the badge — once COLLECTED the
      // resource is in flight and the OWNER's next action is to wait
      // for RETURNED, not "respond now".
      const statuses = ['REQUESTED', 'APPROVED'];
      const out = { total: 0 };
      // Sequential (two requests) is fine — they hit a single
      // compound index (ownerId+status) and the in-memory aggregation
      // is trivial. Parallel would also work but the readability
      // win isn't worth the change.
      for (const s of statuses) {
        const { data } = await api.get('/requests', {
          params: { status: s, page: 1, limit: 100 },
        });
        out.total += data?.data?.pagination?.total || 0;
      }
      return out;
    },
  });
}
