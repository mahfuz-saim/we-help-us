/**
 * useVerifyVolunteer — TanStack Query mutation for the moderator's
 * volunteer verification action (Module 6.2).
 *
 * Wraps POST /api/moderator/verify-volunteer/:userId. The mutation is
 * idempotent on the server (already-verified → 200 with the existing
 * user, no DB write). The hook surfaces the verified user object so a
 * caller can update local UI state without a round-trip.
 *
 * Cache invalidation on success:
 *   - ['moderator-requests'] — the moderator's request dashboard
 *     populates `volunteerSummary.isVerified` and renders the badge
 *     next to each row; refetch so the badge appears after verify.
 *   - ['owner-requests']     — same populate, owner side.
 *
 * Privacy (KEY DESIGN REMINDER): the response is the
 * `publicUserDirectory()` shape (same one Module 6.1's directory
 * endpoints return) — password, email, AND phone are NEVER included.
 * The hook does NOT phone home for contact info on its own; it just
 * relays what the server returns.
 *
 * Role gate: the route is mounted behind
 * `protect, authorize('MODERATOR', 'ADMIN')` on the server, so the
 * hook is intentionally "fire-and-forget" — a non-moderator caller
 * gets a 403 surfaced via `onError`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

/**
 * Verify a volunteer.
 *
 * @param {object} payload
 * @param {string} payload.userId        - volunteer's User id (ObjectId)
 * @param {string} [payload.moderatorNote] - optional note (≤1000 chars server-side)
 */
export function useVerifyVolunteer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, moderatorNote } = {}) => {
      const body = moderatorNote ? { moderatorNote } : {};
      const { data } = await api.post(
        `/moderator/verify-volunteer/${userId}`,
        body
      );
      return data?.data?.user || null;
    },
    onSuccess: () => {
      // Re-fetch the role-scoped request lists so the badge surfaces
      // next to any volunteers who already appear there.
      qc.invalidateQueries({ queryKey: ['moderator-requests'] });
      qc.invalidateQueries({ queryKey: ['owner-requests'] });
    },
  });
}
