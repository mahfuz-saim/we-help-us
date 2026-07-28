/**
 * useResource — TanStack Query wrapper for the single-resource endpoint.
 *
 * Module 4.2's ResourceDetailsPage calls GET /api/resources/:id to load
 * the full record (photos, description, capacity, status, ownerId,
 * areaId, location, timestamps) so the user can drill into a card
 * from the search list (Module 4.1).
 *
 * Notes:
 *   - The server's `publicResource()` helper strips owner contact info
 *     before the response leaves the server. The hook passes the
 *     document through unchanged — the privacy boundary is enforced
 *     on the server, NOT here. The page still double-checks via
 *     static-guard assertions (it never references owner.email /
 *     owner.phone / owner.name / resource.owner).
 *   - `enabled` defaults to `Boolean(id)` so a missing id is a no-op
 *     (instead of a 400 round-trip).
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

/**
 * @param {string} id - The 24-char ObjectId hex of the resource.
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]
 */
export function useResource(id, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['resource', id || null],
    enabled: enabled && Boolean(id),
    staleTime: 30 * 1000, // 30s — the page is read-only so a short
                           // staleness is fine. Invalidations on
                           // Module 5.x mutations will refresh anyway.
    queryFn: async () => {
      const { data } = await api.get(`/resources/${id}`);
      // Server response shape: { success, data: { resource: {...} } }
      return data?.data?.resource || null;
    },
  });
}
