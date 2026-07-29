import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RoleBadge from '../components/RoleBadge';
import NotificationBell from '../components/NotificationBell';
import MobileNavDrawer from '../components/MobileNavDrawer';
import { navLinkClass } from '../utils/navLinkClass';

export default function MainLayout() {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-alert-700 text-base font-bold text-white"
            >
              !
            </span>
            <span className="text-lg font-semibold tracking-tight">
              We Help Us
            </span>
          </Link>

          {/* Desktop navigation — the complete menu remains unchanged above md. */}
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <DesktopNavLinks user={user} />
            {user && (
              <button
                type="button"
                onClick={logout}
                className="ml-2 min-h-[44px] rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Log out
              </button>
            )}
          </nav>

          {/* Compact mobile header — the full menu opens in MobileNavDrawer. */}
          <div className="flex items-center gap-1 md:hidden">
            {user && <NotificationBell />}
            {user && <RoleBadge role={user.role} className="ml-1" />}
            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-drawer"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="ml-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
              data-testid="whu-mobile-menu-toggle"
            >
              {mobileMenuOpen ? (
                <span aria-hidden className="text-2xl leading-none">×</span>
              ) : (
                <span aria-hidden className="text-2xl leading-none">☰</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <MobileNavDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
          <p>
            &copy; {new Date().getFullYear()} We Help Us — Community Resource
            Intelligence &amp; Emergency Coordination.
          </p>
          <p className="mt-1 italic">
            “When disaster strikes, communities save themselves first.”
          </p>
        </div>
      </footer>
    </div>
  );
}

function DesktopNavLinks({ user }) {
  return (
    <>
      <NavLink to="/" end className={({ isActive }) => navLinkClass(isActive)}>
        Home
      </NavLink>
      <NavLink to="/health" className={({ isActive }) => navLinkClass(isActive)}>
        Health
      </NavLink>

      {user ? (
        <>
          <NavLink to="/resources" className={({ isActive }) => navLinkClass(isActive)}>
            Resources
          </NavLink>
          <NavLink to="/resources/map" className={({ isActive }) => navLinkClass(isActive)}>
            Map
          </NavLink>
          {user.role === 'VOLUNTEER' && (
            <NavLink to="/volunteer/requests" className={({ isActive }) => navLinkClass(isActive)}>
              My Requests
            </NavLink>
          )}
          {user.role === 'OWNER' && (
            <NavLink to="/owner/requests" className={({ isActive }) => navLinkClass(isActive)}>
              Incoming
            </NavLink>
          )}
          {(user.role === 'MODERATOR' || user.role === 'ADMIN') && (
            <>
              <NavLink to="/moderator" className={({ isActive }) => navLinkClass(isActive)}>Moderation</NavLink>
              <NavLink to="/analytics" className={({ isActive }) => navLinkClass(isActive)}>Analytics</NavLink>
            </>
          )}
          <NotificationBell />
          <NavLink to="/profile" className={({ isActive }) => navLinkClass(isActive)}>
            <span className="hidden sm:inline">{user.name || user.email || 'Profile'}</span>
            <span className="sm:hidden">Profile</span>
          </NavLink>
          <RoleBadge role={user.role} className="ml-2" />
        </>
      ) : (
        <>
          <NavLink to="/login" className={({ isActive }) => navLinkClass(isActive)}>
            Log in
          </NavLink>
          <Link to="/register" className="ml-1 min-h-[44px] rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-alert-800">
            Sign up
          </Link>
        </>
      )}
    </>
  );
}
