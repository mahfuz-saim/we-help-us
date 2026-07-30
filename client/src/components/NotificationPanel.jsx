/**
 * NotificationPanel — Module 7.5.
 *
 * Dropdown content for the bell. Renders:
 *   - the latest 20 unread notifications (newest first)
 *   - a "Mark all as read" CTA when unread > 0
 *   - empty / loading / error states
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - No email / phone / password / owner contact info is ever
 *     rendered. The panel consumes the public notification wire
 *     shape (title + message + type + relatedId + timestamps)
 *     directly.
 *   - RelatedId deep-links: the server's `relatedId` is polymorphic,
 *     so we only link when the recipient role + type maps to a known
 *     route (owner's REQUEST_* → /owner/requests; volunteer's
 *     REQUEST_* → /volunteer/requests). All other rows just mark
 *     themselves read on click.
 */

import { Link } from 'react-router-dom';
import {
  useUnreadNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../hooks/useNotifications';

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Map (notification type, recipient role) to a deep link.
 * Returns null when no sensible link exists.
 */
function linkFor(notification, user) {
  if (!notification || !user) return null;
  const type = notification.type;
  const role = user.role;
  // Request lifecycle events route the user to their inbox.
  if (
    type === 'REQUEST_CREATED' ||
    type === 'REQUEST_APPROVED' ||
    type === 'REQUEST_REJECTED' ||
    type === 'REQUEST_COLLECTED' ||
    type === 'REQUEST_RETURNED' ||
    type === 'REQUEST_COMPLETED'
  ) {
    if (role === 'OWNER') return '/owner/requests';
    if (role === 'VOLUNTEER') return '/volunteer/requests';
    if (role === 'MODERATOR' || role === 'ADMIN') return '/moderator';
  }
  return null;
}

function NotificationRow({ notification, onMarkRead, user }) {
  const link = linkFor(notification, user);
  const body = (
    <div
      className={
        'flex flex-col gap-0.5 px-3 py-2 text-left ' +
        (notification.isRead
          ? 'bg-white text-slate-600'
          : 'bg-safe-50 text-slate-900')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{notification.title}</span>
        <span className="shrink-0 text-xs text-slate-500">
          {formatRelative(notification.createdAt)}
        </span>
      </div>
      <p className="line-clamp-2 text-xs">{notification.message}</p>
      {!notification.isRead && (
        <span
          aria-label="unread"
          className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-safe-600"
        />
      )}
    </div>
  );
  async function handleClick() {
    if (notification.isRead) return;
    try {
      await onMarkRead(notification.id);
    } catch {
      // Swallow — the cache invalidation will reconcile on next
      // refetch. The row stays visible until then.
    }
  }
  if (link) {
    return (
      <Link
        to={link}
        onClick={handleClick}
        className="block border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
        data-testid="whu-notification-row"
      >
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="block w-full border-b border-slate-100 text-left last:border-b-0 hover:bg-slate-50 disabled:hover:bg-white"
      disabled={notification.isRead}
      data-testid="whu-notification-row"
    >
      {body}
    </button>
  );
}

export default function NotificationPanel({ user, onClose }) {
  const { data, isLoading, isError, error, refetch } = useUnreadNotifications();
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div
      data-testid="whu-notification-panel"
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-alert-700 px-2 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={unreadCount === 0 || markAll.isPending}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
          data-testid="whu-notification-mark-all"
        >
          {markAll.isPending ? 'Marking…' : 'Mark all as read'}
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {isLoading && (
          <div className="space-y-2 p-3" data-testid="whu-notification-loading">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md bg-slate-100"
              />
            ))}
          </div>
        )}
        {isError && (
          <div
            className="p-3 text-sm text-alert-700"
            data-testid="whu-notification-error"
          >
            <p>Could not load notifications.</p>
            <p className="mt-1 text-xs text-slate-500">
              {error?.message || 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 rounded-md bg-alert-700 px-2 py-1 text-xs font-semibold text-white hover:bg-alert-800"
            >
              Retry
            </button>
          </div>
        )}
        {!isLoading && !isError && notifications.length === 0 && (
          <div
            className="px-3 py-6 text-center text-sm text-slate-500"
            data-testid="whu-notification-empty"
          >
            You're all caught up.
          </div>
        )}
        {!isLoading && !isError && notifications.length > 0 && (
          <ul className="divide-y divide-slate-100" role="list">
            {notifications.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  notification={n}
                  onMarkRead={markOne.mutate}
                  user={user}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}