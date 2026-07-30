/**
 * ProtectedRoute — a route guard.
 *
 * - Without `roles`: requires any authenticated user.
 * - With `roles`:   requires the user's role to be in the list.
 *
 * Behavior:
 *   - loading → render a neutral skeleton (never blank, never bounce).
 *   - not authenticated → redirect to /login, preserving intended path.
 *   - authenticated but wrong role → redirect to / with a toast.
 *
 * Module 1.3 wires this up alongside the auth context (already wired
 * here in the skeleton).
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[40vh] items-center justify-center"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    toast.error('You do not have access to that page.');
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
