/**
 * AdminModeratorsListPage — admin UI for viewing every moderator
 * account on the platform.
 *
 * Surfaces the global moderator directory (no area scoping — admins
 * are global). Data is fetched via the privacy-safe
 * `GET /api/admin/moderators` endpoint, which uses the server's
 * `publicUserDirectory()` helper to strip email / phone / password
 * before responding. So everything we render here is safe.
 *
 * Pages / filter:
 *   - Page number passed through query state.
 *   - "Verified" / "Active" badges are read-only — admins don't
 *     toggle these from this surface in v1. The table is a
 *     directory, not an editor.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The page source NEVER reads email / phone / password. There's
 *     no per-moderator detail card, no copy-to-clipboard, no
 *     mailto: link — those fields aren't in the response shape to
 *     begin with.
 *   - The only outbound traffic is GET /api/admin/moderators. The
 *     single navigation is the "Create moderator" CTA.
 */

import { Link } from 'react-router-dom';

import { useAdminModerators } from '../../hooks/useAdminModerators';

export default function AdminModeratorsListPage() {
  const list = useAdminModerators({ page: 1, limit: 50 });
  const moderators = list.data?.moderators || [];
  const total = list.data?.pagination?.total || 0;

  return (
    <div className="space-y-4">
      <Header />

      {list.isLoading && <LoadingState />}
      {list.isError && (
        <ErrorBanner
          message={
            list.error?.response?.data?.message ||
            list.error?.message ||
            'Failed to load moderators.'
          }
        />
      )}
      {!list.isLoading && !list.isError && moderators.length === 0 && (
        <EmptyState />
      )}
      {!list.isLoading && !list.isError && moderators.length > 0 && (
        <ModeratorTable moderators={moderators} total={total} />
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Moderators</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every moderator account on the platform. Use the create form to
          onboard a new moderator — they complete their area, location, and
          contact info from their profile after first login.
        </p>
      </div>
      <Link
        to="/admin/moderators/new"
        className="rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800"
      >
        + Create moderator
      </Link>
    </header>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md bg-slate-100"
          aria-hidden
        />
      ))}
      <span className="sr-only">Loading moderators…</span>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-alert-200 bg-alert-50 p-3 text-sm text-alert-800"
    >
      {message}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-base font-medium text-slate-700">
        No moderators yet
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Create your first moderator to get started.
      </p>
      <Link
        to="/admin/moderators/new"
        className="mt-4 inline-block rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800"
      >
        + Create moderator
      </Link>
    </div>
  );
}

function ModeratorTable({ moderators, total }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">
          {total} {total === 1 ? 'moderator' : 'moderators'}
        </p>
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              Area
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              Verified
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              Active
            </th>
            <th scope="col" className="px-4 py-3 text-left font-medium">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {moderators.map((m) => (
            <tr key={m.id} className="text-slate-700">
              <td className="px-4 py-3 font-medium text-slate-900">
                {m.name || '—'}
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                {m.areaId ? m.areaId : (
                  <span className="italic text-slate-400">
                    Not assigned
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <Pill ok={m.isVerified} label={m.isVerified ? 'Yes' : 'No'} />
              </td>
              <td className="px-4 py-3">
                <Pill ok={m.isActive} label={m.isActive ? 'Active' : 'Disabled'} />
              </td>
              <td className="px-4 py-3 text-slate-500">
                {formatDate(m.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ ok, label }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
        (ok
          ? 'bg-safe-100 text-safe-700'
          : 'bg-slate-100 text-slate-600')
      }
    >
      {label}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}