/**
 * useEmergencyMode — TanStack Query for the area-scoped emergency
 * mode toggle (Module 6.3).
 *
 * The MODERATOR can flip the area's `emergencyMode.isActive` flag.
 * When active:
 *   - The moderator dashboard renders a red banner + a "Response
 *     mode" badge.
 *   - The pending-requests list is the priority queue (the
 *     server already hard-codes status=REQUESTED for the moderator's
 *     view; the dashboard surfaces this through the banner).
 *
 * Wraps:
 *   - GET  /api/moderator/emergency-mode — read the current state.
 *   - PATCH /api/moderator/emergency-mode — flip the flag.
 *
 * Auth gate:
 *   The route is mounted behind `protect, authorize('MODERATOR',
 *   'ADMIN')` on the server. A non-moderator caller surfaces a 403
 *   via `onError`. A moderator with no areaId also gets 403 (the
 *   controller returns "You must be assigned to an area…"); the hook
 *   surfaces that message so the dashboard's "No area assigned"
 *   hint can render next to a disabled toggle.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The response includes `activatedBy` as the public User shape
 *   (`toSafeObject()` from the controller) — id + name + role +
 *   isVerified + isActive + areaId + timestamps. NEVER email /
 *   phone / password. The hook does NOT phone home for contact
 *   info; it just relays what the server returns.
 *
 * Cache:
 *   ['moderator-emergency-mode'] — the current state. The mutation
 *   invalidates it on success so the next read is fresh.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

/**
 * Read the moderator's area emergency-mode state.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 */
export function useEmergencyMode({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['moderator-emergency-mode'],
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data } = await api.get('/moderator/emergency-mode');
      return (
        data?.data || {
          areaId: null,
          isActive: false,
          activatedAt: null,
          activatedBy: null,
        }
      );
    },
  });
}

/**
 * Toggle the moderator's area emergency-mode flag.
 *
 * @param {object} payload
 * @param {boolean} payload.isActive  - the desired new state
 * @param {string} [payload.note]    - optional note (≤1000 chars server-side)
 */
export function useSetEmergencyMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ isActive, note } = {}) => {
      const body = { isActive: isActive === true };
      if (note) body.note = note;
      const { data } = await api.patch('/moderator/emergency-mode', body);
      return data?.data || null;
    },
    onSuccess: (data) => {
      // Update the cache directly so the toggle UI reflects the
      // server's authoritative state without a round-trip.
      if (data) {
        qc.setQueryData(['moderator-emergency-mode'], data);
      }
      // Invalidate the list caches too — when the moderator flips
      // emergency mode ON, the dashboard switches to response view
      // and re-fetches the queue; OFF returns to the normal view.
      qc.invalidateQueries({ queryKey: ['moderator-requests'] });
      qc.invalidateQueries({ queryKey: ['moderator-emergency-mode'] });
    },
  });
}