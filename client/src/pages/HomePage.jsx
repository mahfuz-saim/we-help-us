/**
 * HomePage.
 *
 * In the skeleton this is a friendly landing page that links to the
 * other placeholder routes. The `placeholder` prop is used by the
 * protected-route demo pages to indicate which module will replace them.
 *
 * Logged-in users should never see the marketing surface — they get
 * redirected to a role-aware default (OWNER → /owner/resources,
 * VOLUNTEER → /volunteer/requests, MODERATOR/ADMIN → /moderator,
 * else → /profile). Mirrors the post-login redirect in LoginPage
 * and RegisterPage so any path that lands on `/` while authenticated
 * produces the same destination.
 */

import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function defaultPathForRole(role) {
  if (role === 'OWNER') return '/owner/resources';
  if (role === 'VOLUNTEER') return '/volunteer/requests';
  if (role === 'MODERATOR' || role === 'ADMIN') return '/moderator';
  return '/profile';
}

export default function HomePage({ placeholder }) {
  const { user, loading } = useAuth();

  // While the auth context is hydrating from /auth/me, render a neutral
  // skeleton rather than flashing the marketing page. This prevents
  // a logged-in user with a slow connection from seeing the homepage
  // for a frame before the redirect kicks in.
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

  // Logged-in users are bounced to their dashboard surface. The
  // `replace` flag keeps the homepage out of browser history so the
  // back button doesn't land them back on the marketing splash.
  if (user) {
    return <Navigate to={defaultPathForRole(user.role)} replace />;
  }


  if (placeholder) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm uppercase tracking-wide text-slate-500">
          Coming soon
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {placeholder}
        </h1>
        <p className="mt-2 text-slate-600">
          This route is wired up but its feature module is not yet implemented.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-alert-700 via-alert-800 to-slate-900 px-6 py-12 text-white shadow-lg sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-alert-100">
          Community Resource Intelligence
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          When disaster strikes, communities save themselves first.
        </h1>
        <p className="mt-3 max-w-2xl text-base text-slate-100 sm:text-lg">
          Map and share critical resources — transport, rescue gear, medical
          supplies, infrastructure, utilities, skilled professionals — so
          neighbours can help neighbours in the minutes that matter.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {user ? (
            <Link
              to="/profile"
              className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-alert-800 hover:bg-slate-100"
            >
              Go to your profile
            </Link>
          ) : (
            <>
              <Link
                to="/register"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-alert-800 hover:bg-slate-100"
              >
                Create an account
              </Link>
              <Link
                to="/login"
                className="rounded-md border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SKELETON_FEATURES.map((f) => (
          <article
            key={f.title}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="text-2xl" aria-hidden>
              {f.icon}
            </div>
            <h2 className="mt-2 text-base font-semibold text-slate-900">
              {f.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{f.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

const SKELETON_FEATURES = [
  {
    icon: '🔐',
    title: 'Account & roles',
    body:
      'Public registration is reserved for resource owners and volunteers. Moderators and admins are created out-of-band.',
    module: '1.x',
    status: 'Planned',
  },
  {
    icon: '🗺️',
    title: 'Resource search & map',
    body:
      'Find resources near you with cascading area filters, distance sort, and an interactive Leaflet map.',
    module: '3.x – 4.x',
    status: 'Planned',
  },
  {
    icon: '🤝',
    title: 'Reservation workflow',
    body:
      'Volunteers request, owners approve, both sides stay safe — owner contact is revealed only after a request is approved AND collected.',
    module: '5.x',
    status: 'Planned',
  },
  {
    icon: '🚨',
    title: 'Emergency mode',
    body:
      'Moderators can flip their area into emergency mode so the dashboard prioritises in-flight requests.',
    module: '6.3',
    status: 'Planned',
  },
  {
    icon: '🔔',
    title: 'Real-time updates',
    body:
      'Socket.io-driven notifications and live map markers so you see what changed the moment it changed.',
    module: '7.x',
    status: 'Planned',
  },
  {
    icon: '📊',
    title: 'Analytics & reports',
    body:
      'Category, area, and utilisation breakdowns to help coordinators understand coverage at a glance.',
    module: '8.x',
    status: 'Planned',
  },
];
