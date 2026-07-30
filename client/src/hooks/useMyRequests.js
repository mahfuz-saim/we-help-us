/**
 * useMyRequests — TanStack Query for the volunteer dashboard (Module 5.3).
 *
 * Wraps GET /api/requests — Module 5.2's role-scoped list endpoint.
 * For a VOLUNTEER the server narrows the list to requests where
 * volunteerId === req.user._id, so the dashboard never needs a
 * `mine=1` style flag — the server enforces the scope.
 *
 * Also wraps the lifecycle actions the volunteer can take:
 *   - useCreateRequest  — POST /api/requests
 *   - useCollectRequest — PATCH /api/requests/:id/collect
 *   - useReturnRequest  — PATCH /api/requests/:id/return
 *
 * All three mutations return the updated request. The COLLECT response is
 * the SINGLE place the server reveals owner + volunteer contact info
 * (the privacy gate fires on APPROVED + COLLECTED). The hook captures
 * the mutation's `data` so the page can show the contact card right
 * after a successful collect.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The hook NEVER calls /api/users/:id or /api/auth/me to enrich
 *     a request with the owner's user doc. The server's
 *     `publicRequest()` shape is the only data we render — and that
 *     helper gates contact reveal on status === COLLECTED.
 *   - The hook never falls back to fetching user docs even if the
 *     server response is missing fields; a malformed response is an
 *     error, not a reason to phone home for more data.
 *
 * Cache keys:
 *   - ['my-requests', { status: <filter>, page, limit }] — the list.
 *   - Mutations invalidate the list so the status pill / action button
 *     update after a successful transition.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Fetch the volunteer's own requests.
 *
 * @param {object} [opts]
 * @param {string} [opts.status]   - one of the 6 REQUEST_STATUS values, or omitted
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.enabled=true]
 */
export function useMyRequests({
  status,
  page = 1,
  limit = 20,
  enabled = true,
} = {}) {
  return useQuery({
    queryKey: ['my-requests', { status: status || null, page, limit }],
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
 * Create a new resource request (VOLUNTEER + isVerified only — the
 * server enforces this gate; the client mirrors it so the button is
 * disabled before the round-trip). Used by the resource details page
 * (Module 4.2) for the "Request this resource" CTA.
 *
 * The mutation's `data` is the freshly-created request. Server-side
 * gates that surface as a 4xx:
 *   - 403  not a VOLUNTEER or not isVerified
 *   - 400  volunteer tried to request their own resource
 *   - 404  resource id does not exist
 *   - 409  resource not AVAILABLE, or volunteer already has an open
 *          request for it
 *
 * On success we invalidate the volunteer's request list AND the
 * single-resource cache so the details page reflects the new state
 * (the resource will transition to RESERVED only after the owner
 * approves — but the volunteer's "My Requests" tab updates immediately).
 */
export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ resourceId, moderatorNote } = {}) => {
      if (!resourceId) {
        throw new Error('resourceId is required to create a request.');
      }
      const body = { resourceId };
      if (moderatorNote) body.moderatorNote = moderatorNote;
      const { data } = await api.post('/requests', body);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-requests'] });
      qc.invalidateQueries({ queryKey: ['resource'] });
    },
  });
}

/**
 * Mark an APPROVED request as COLLECTED. The mutation's `data`
 * is the updated request — which is the ONLY response that may
 * contain the owner's name/email/phone (KEY DESIGN REMINDER: the
 * server reveals contact info only after APPROVED + COLLECTED).
 *
 * @returns UseMutationResult — `mutation.data.data.request` carries
 *          the updated request on success.
 */
export function useCollectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/requests/${id}/collect`);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
  });
}

/**
 * Mark a COLLECTED request as RETURNED. The resource stays IN_USE
 * until the owner confirms via PATCH /:id/complete (Module 5.4's
 * surface); the volunteer just declares they've handed it back.
 *
 * @returns UseMutationResult
 */
export function useReturnRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/requests/${id}/return`);
      return data?.data?.request || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
  });
}
