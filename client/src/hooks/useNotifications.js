/**
 * Notifications inbox hook — Module 7.5.
 *
 * Recipient-scoped inbox surface. The server side
 * (GET /api/notifications + PATCH /:id/read + PATCH /mark-all-read)
 * shipped in Module 7.2; this hook is the thin client-side wrapper.
 *
 * Wire shape (matches server/controllers/notification.controller.js
 * publicNotification()):
 *
 *   { id, recipientId, title, message, type, relatedId, isRead,
 *     createdAt, updatedAt }
 *
 * No email / phone / password / owner contact info is ever carried in
 * this surface (KEY DESIGN REMINDER: privacy).
 *
 * The hook NEVER calls /users/:id or /auth/me — the actor's identity
 * arrives implicitly via the recipientId gate on the server.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

export const NOTIFICATION_QUERY_KEY = 'notifications';

/**
 * GET /api/notifications
 * Optional filter shape: { isRead, type, page, limit }.
 * Server returns { notifications, unreadCount, pagination }.
 */
export function useNotifications({ isRead, type, page = 1, limit = 20, enabled } = {}) {
  return useQuery({
    queryKey: [
      NOTIFICATION_QUERY_KEY,
      { isRead: isRead ?? null, type: type ?? null, page, limit },
    ],
    enabled: enabled !== false,
    queryFn: async () => {
      const params = {};
      if (isRead !== undefined && isRead !== null) params.isRead = isRead;
      if (type) params.type = type;
      if (page) params.page = page;
      if (limit) params.limit = limit;
      const { data } = await api.get('/notifications', { params });
      return data?.data || { notifications: [], unreadCount: 0, pagination: null };
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Unread-only inbox. Same wire shape as useNotifications; the hook is a
 * thin convenience wrapper so the bell can call it without dragging in
 * pagination flags.
 */
export function useUnreadNotifications({ enabled } = {}) {
  return useNotifications({ isRead: false, limit: 20, enabled });
}

/**
 * Mark a single notification read.
 * PATCH /api/notifications/:id/read
 * Returns the publicNotification shape; rolls the unreadCount forward.
 */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const { data } = await api.patch(`/notifications/${id}/read`);
      return data?.data || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NOTIFICATION_QUERY_KEY] });
    },
  });
}

/**
 * Bulk-mark every unread row read.
 * PATCH /api/notifications/mark-all-read
 * Returns { modifiedCount }.
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.patch('/notifications/mark-all-read');
      return data?.data || { modifiedCount: 0 };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NOTIFICATION_QUERY_KEY] });
    },
  });
}