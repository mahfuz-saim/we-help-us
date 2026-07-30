/**
 * ProfileMenu — Module: Navbar Profile Dropdown.
 *
 * Right-corner profile icon in the navbar. Shows the user's avatar
 * when `user.avatarUrl` is set, otherwise an initials placeholder on
 * a slate disc. Clicking the icon opens a small dropdown with two
 * items: "Profile" (links to /profile) and "Log out" (calls the
 * AuthContext `logout` callback).
 *
 * Dropdown behavior mirrors NotificationBell:
 *   - Closes on outside click.
 *   - Closes on Escape.
 *   - Anchored to the right edge of the trigger (`right-0 top-full`).
 *
 * Icon convention follows the project — no icon library is installed
 * (`client/package.json` declares none), so the icon is an inline
 * SVG-style element rendered via a circular Tailwind disc. The
 * avatar fallback uses the same initials helper shape as
 * `ProfilePage`'s `AvatarPreview` so the visual stays consistent.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  // Close on outside click + Escape (same pattern as NotificationBell).
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

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    // Send the user back to the public landing page after logout so
    // they don't sit on a stale authenticated surface (e.g. /owner).
    navigate('/', { replace: true });
  };

  const name = user.name || user.email || '?';
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || '?';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={open ? 'Close profile menu' : 'Open profile menu'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-slate-700 ring-2 ring-transparent hover:ring-slate-200"
        data-testid="whu-profile-icon"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-full w-full items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600"
          >
            {initials}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Profile actions"
          data-testid="whu-profile-menu"
          className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {name}
            </p>
            {user.email && user.email !== name && (
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            )}
          </div>
          <Link
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            data-testid="whu-profile-menu-profile"
          >
            <span aria-hidden className="text-base leading-none">👤</span>
            <span>Profile</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            data-testid="whu-profile-menu-logout"
          >
            <span aria-hidden className="text-base leading-none">↩</span>
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  );
}