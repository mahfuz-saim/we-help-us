/**
 * MainLayout — header + outlet + footer. Wraps every route.
 */

import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RoleBadge from '../components/RoleBadge';

export default function MainLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
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

          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                navLinkClass(isActive)
              }
            >
              Home
            </NavLink>
            <NavLink to="/health" className={({ isActive }) => navLinkClass(isActive)}>
              Health
            </NavLink>

            {user ? (
              <>
                <NavLink
                  to="/resources"
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Resources
                </NavLink>
                <NavLink
                  to="/profile"
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <span className="hidden sm:inline">
                    {user.name || user.email || 'Profile'}
                  </span>
                  <span className="sm:hidden">Profile</span>
                </NavLink>
                <RoleBadge role={user.role} className="ml-2" />
                <button
                  type="button"
                  onClick={logout}
                  className="ml-2 rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink
                  to="/login"
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Log in
                </NavLink>
                <Link
                  to="/register"
                  className="ml-1 rounded-md bg-alert-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-alert-800"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

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

function navLinkClass(isActive) {
  return [
    'rounded-md px-3 py-1.5 text-sm font-medium',
    isActive
      ? 'bg-slate-900 text-white'
      : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');
}
