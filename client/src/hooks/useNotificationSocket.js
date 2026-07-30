/**
 * NotificationSocket — Module 7.5 (+ Module 9 emergency extension).
 *
 * Bridges the server-side Socket.io `notification:new` event into:
 *   1. The TanStack Query notifications cache (bumps unread count +
 *      prepends the row to the first page so the bell badge updates
 *      instantly without a refetch).
 *   2. A react-hot-toast toast so the user sees the alert even if
 *      the bell is off-screen.
 *
 * Module 9 — Emergency System Rework:
 *   The hook ALSO subscribes to the `emergency:activated` socket
 *   event. That event doesn't carry a notification payload — the
 *   server already writes one row per recipient via
 *   `notifyMany`. The emergency event is the cross-cutting
 *   signal that the analytics map + resource list / owner
 *   dashboards / search list need to refresh.
 *
 *   We invalidate the `emergency-activations` query family plus
 *   the resource/owner-resources/resource-requests keys so any
 *   badge or row that depends on `areaEmergencyActive` updates
 *   within one socket roundtrip.
 *
 * Lifecycle:
 *   - Hook is mounted while `enabled` is true (typically: while the
 *     user is logged in).
 *   - Connects the singleton socket on mount (idempotent — Socket.io
 *     reuses the connection across re-mounts).
 *   - Disconnects on `enabled → false` (logout / session loss) so
 *     the next user doesn't inherit the prior socket's user-room
 *     bind.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - We never enrich the payload with contact info. The server-side
 *     `publicNotificationPayload()` (Module 7.4) is contact-free by
 *     construction; the toast + bell render the title + message
 *     only.
 *   - The hook does NOT call /users/:id or /auth/me. The bell +
 *     toast consume the round-tripped payload as-is.
 */

import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  getSocket,
  disconnectSocket,
} from '../services/socket';
import { NOTIFICATION_QUERY_KEY } from './useNotifications';

/**
 * Open the singleton Socket.io connection and subscribe to
 * `notification:new` + (Module 9) `emergency:activated`. The handler:
 *   - prepends the payload to the first page of the notifications list
 *   - increments unreadCount across every cached notifications entry
 *   - emits a toast using title + message
 *   - on `emergency:activated`: invalidates the emergency family +
 *     resource family so the analytics map + resource list rows
 *     refresh.
 *
 * Returns nothing — the consumer (e.g. <NotificationBell />) wires
 * the UI; this hook is just the bridge.
 */
export function useNotificationSocket({ enabled }) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      // User logged out — drop the connection so the next user
      // doesn't inherit the prior socket's user-room binding.
      disconnectSocket();
      return undefined;
    }

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function handleNewNotification(payload) {
      // ── Cache mutation ───────────────────────────────────────────
      // Walk every cached notifications entry (different filter /
      // pagination slices) and:
      //   - bump unreadCount by 1 (this payload is unread by
      //     construction — the trigger writes a fresh row)
      //   - prepend the payload to the first page when the slice
      //     matches "any / unread / all"
      const queries = qc.getQueryCache().findAll({
        queryKey: [NOTIFICATION_QUERY_KEY],
      });
      for (const q of queries) {
        qc.setQueryData(q.queryKey, (prev) => {
          if (!prev) return prev;
          const next = { ...prev, unreadCount: (prev.unreadCount || 0) + 1 };
          const [_, params] = q.queryKey;
          const firstPage =
            params && params.page === 1 && params.limit === 20;
          // Only mutate the default-shaped slice (page=1, limit=20).
          // Filtered slices (type=REQUEST_CREATED, isRead=true, etc.)
          // would otherwise show the new row even when it doesn't
          // match their filter.
          const matchesFilter =
            !params ||
            (params.isRead == null && params.type == null);
          if (firstPage && matchesFilter) {
            next.notifications = [payload, ...(prev.notifications || [])];
          }
          return next;
        });
      }
      // Belt-and-braces — invalidate so a stale cache can't drift
      // forever. Subsequent fetches hit the server's recipient-scoped
      // unreadCount and reconcile.
      qc.invalidateQueries({ queryKey: [NOTIFICATION_QUERY_KEY] });

      // ── Toast ────────────────────────────────────────────────────
      // react-hot-toast renders a plain string as the body; the project
      // already wires a Toaster with custom icon + style at app root.
      // We pass `title — message` so the toast mirrors the panel's
      // privacy-safe copy. Format is kept intentionally simple so the
      // hook stays a pure .js file (JSX lives in the panel component).
      toast(`${payload.title} — ${payload.message}`, {
        duration: 5000,
        id: `notif:${payload.id}`,
      });
    }

    // Module 9 — emergency socket subscriber. The payload is the
    // public-shape activation row (id only, no contact info). We use
    // it purely as a "refresh signal" — every consumer that depends
    // on the activation family refetches.
    function handleEmergencyActivated(_payload) {
      qc.invalidateQueries({ queryKey: ['emergency-activations'] });
      // Resource rows / owner rows / search results surface
      // `areaEmergencyActive` per row. Those caches also need to
      // re-fetch so the badge appears in the same socket roundtrip.
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['owner-resources'] });
      qc.invalidateQueries({ queryKey: ['resource-requests'] });
      qc.invalidateQueries({ queryKey: ['resource-search'] });
      qc.invalidateQueries({ queryKey: ['moderator-emergency-mode'] });
    }

    socket.on('notification:new', handleNewNotification);
    socket.on('emergency:activated', handleEmergencyActivated);
    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('emergency:activated', handleEmergencyActivated);
    };
  }, [enabled, qc]);
}
