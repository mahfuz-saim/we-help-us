/**
 * NotificationBell — Module 7.5.
 *
 * Bell icon with unread badge + dropdown panel.
 *
 *   - The bell sits inside the header (MainLayout) for every
 *     authenticated user.
 *   - Unread badge renders when unreadCount > 0 (capped display at
 *     99+).
 *   - Clicking the bell toggles a dropdown panel
 *     (<NotificationPanel />) that lists the 20 latest unread rows.
 *   - The dropdown closes on:
 *       - clicking the bell again
 *       - pressing Escape
 *       - clicking outside the panel
 *
 * Socket.io bridge: this component mounts the
 * `useNotificationSocket` hook so the bell + toast update in
 * real-time.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  useUnreadNotifications,
} from '../hooks/useNotifications';
import { useNotificationSocket } from '../hooks/useNotificationSocket';
import NotificationPanel from './NotificationPanel';

function BellIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Real-time push: bumps the unread count + emits a toast on every
  // server-emitted `notification:new` event.
  useNotificationSocket({ enabled: Boolean(user) });

  // Drive the badge from the same cache slice the panel reads.
  const { data } = useUnreadNotifications({ enabled: Boolean(user) });
  const unreadCount = data?.unreadCount ?? 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
        data-testid="whu-notification-bell"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            data-testid="whu-notification-badge"
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-alert-700 px-1 text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white"
          >
            {badgeText}
          </span>
        )}
      </button>
      {open && (
        <NotificationPanel user={user} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}