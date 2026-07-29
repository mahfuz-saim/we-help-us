/**
 * MobileNavDrawer — Module 9.1.
 *
 * Hamburger-driven right-side drawer that gives phone users access to
 * the same nav surface the desktop top bar exposes (MainLayout.jsx).
 *
 * Visibility model:
 *   - Parent (MainLayout) renders <MobileNavDrawer open={...} onClose={...} />
 *     when its useIsDesktop() check goes false. On desktop the parent
 *     skips the renderer entirely (the hamburger button stays hidden).
 *   - The drawer is a fixed-position overlay with a backdrop. Tap on
 *     the backdrop OR the Escape key OR a NavLink click closes it.
 *   - NavLinks reuse the active-route styling via
 *     `navLinkClassMobile()` from utils/navLinkClass.js so the mobile
 *     surface agrees with the desktop top bar on which route is active.
 *
 * Role gating:
 *   - Resources + Map appear for any authenticated user.
 *   - "My Requests" appears for VOLUNTEER.
 *   - "Incoming" appears for OWNER.
 *   - "Moderation" + "Analytics" appear for MODERATOR / ADMIN.
 *   - Log out is always available when the user is logged in.
 *
 * KEY DESIGN REMINDER:
 *   - The drawer is purely a navigation surface; it does NOT introduce
 *     a new role or expose any new endpoint. The role gates mirror the
 *     top bar's gates 1:1 so a user can't reach a route via the drawer
 *     that the top bar would also gate.
 */

import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { navLinkClassMobile } from '../utils/navLinkClass';

export default function MobileNavDrawer({ open, onClose }) {
  const { user, logout } = useAuth();

  // Close on Escape (mirrors NotificationBell's keyboard handling).
  useEffect(() => {
    if (!open) return undefined;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Lock body scroll while the drawer is up.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  function close() {
    onClose();
  }

  function handleLogout() {
    close();
    logout();
  }

  return (
    <div
      className="fixed inset-0 z-40 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Main menu"
    >
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 bg-slate-900/50"
      />
      <aside className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <span className="text-base font-semibold tracking-tight text-slate-900">
            We Help Us
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <nav className="flex flex-col gap-1 p-3">
          {/* Home is hidden for logged-in users — they navigate via
              dashboards. The logo drives the OWNER back to /owner/resources. */}
          {!user && <DrawerNav to="/" onClose={close} label="Home" />}

          {user ? (
            <>
              {user.role === 'VOLUNTEER' && (
                <>
                  {/* `end` so the "List" link only highlights on the
                      exact /resources route, not on /resources/map. */}
                  <DrawerNav to="/resources" end onClose={close} label="List" />
                  <DrawerNav to="/resources/map" onClose={close} label="Map" />
                </>
              )}
              {user.role === 'VOLUNTEER' && (
                <DrawerNav
                  to="/volunteer/requests"
                  onClose={close}
                  label="My Requests"
                />
              )}
              {user.role === 'OWNER' && (
                <>
                  <DrawerNav
                    to="/owner/resources"
                    onClose={close}
                    label="My Resources"
                  />
                  <DrawerNav
                    to="/owner/requests"
                    onClose={close}
                    label="Incoming"
                  />
                </>
              )}
              {(user.role === 'MODERATOR' || user.role === 'ADMIN') && (
                <>
                  <DrawerNav
                    to="/moderator"
                    onClose={close}
                    label="Moderation"
                  />
                  {/* Volunteers directory (Module: Volunteers Tab) — visible
                      to both MODERATOR and ADMIN; the page dispatches on
                      role inside VolunteersTabDispatcher. */}
                  <DrawerNav
                    to="/moderator/volunteers"
                    onClose={close}
                    label="Volunteers"
                  />
                  <DrawerNav
                    to="/analytics"
                    onClose={close}
                    label="Analytics"
                  />
                </>
              )}
              {user.role === 'ADMIN' && (
                <DrawerNav
                  to="/admin/moderators"
                  onClose={close}
                  label="Moderators"
                />
              )}
              <DrawerNav to="/profile" onClose={close} label="Profile" />
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2 min-h-[44px] rounded-md px-4 py-3 text-left text-base font-medium text-alert-700 hover:bg-alert-50"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <DrawerNav to="/login" onClose={close} label="Log in" />
              <Link
                to="/register"
                onClick={close}
                className="mt-2 flex min-h-[44px] items-center justify-center rounded-md bg-alert-700 px-4 py-3 text-base font-semibold text-white hover:bg-alert-800"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </aside>
    </div>
  );
}

function DrawerNav({ to, label, onClose, end = false }) {
  // `end` is forwarded so callers can opt out of react-router's
  // prefix matching when two sibling routes share a path prefix
  // (e.g. /resources and /resources/map). Without it, both links
  // would be marked active at once.
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      className={({ isActive }) => navLinkClassMobile(isActive)}
    >
      {label}
    </NavLink>
  );
}
