/**
 * OwnerDashboardPage — Module 3.5.
 *
 * The OWNER's home for the resources they've registered. What this page
 * does:
 *
 *   1. Lists the caller's own resources (GET /api/resources?mine=1).
 *      The `mine=1` filter is enforced server-side (resource.controller.js
 *      sets `filter.ownerId = req.user._id`); no client-side trust.
 *
 *   2. Shows a status badge per card (AVAILABLE / RESERVED / IN_USE /
 *      UNAVAILABLE), styled from RESOURCE_STATUS in utils/constants.js.
 *
 *   3. Toggles AVAILABLE ↔ UNAVAILABLE per card. RESERVED and IN_USE
 *      resources are NOT toggleable from the dashboard — those
 *      statuses are owned by Module 5.2's request lifecycle and a
 *      manual flip would race with the request controller. The UI
 *      reflects this so the owner knows why.
 *
 *   4. Edit / Delete actions per card. Delete calls
 *      DELETE /api/resources/:id (owner-or-moderator on the server);
 *      Edit is wired but defers to the registration form via
 *      /owner/resources/new?edit=<id> — see the README for why we
 *      don't inline a full edit form in 3.5.
 *
 * KEY DESIGN REMINDERS honored:
 *   - **Role restriction**: the route is OWNER-only
 *     (App.jsx → ProtectedRoute roles={['OWNER']}). The server also
 *     scopes `?mine=1` to req.user._id; a VOLUNTEER or MODERATOR
 *     who somehow bypassed the client guard gets an empty list.
 *   - **Privacy**: owner contact info is never on the resource
 *     response (KEY DESIGN REMINDER from 3.2). The list endpoint
 *     returns only ownerId (a string), title, description, photos,
 *     etc. We display ownerId nowhere here because the dashboard is
 *     for the owner themselves — they don't need to see their own id.
 *   - **Status flow**: AVAILABLE → RESERVED → IN_USE → AVAILABLE.
 *     RESERVED / IN_USE are set automatically by 5.2's request
 *     controller (transitions), so the dashboard only allows
 *     AVAILABLE ↔ UNAVAILABLE explicitly. RESERVED / IN_USE rows
 *     show a "Managed by request lifecycle" hint instead of a toggle.
 *   - **Status defaults**: a freshly created resource defaults to
 *     AVAILABLE (server/models/Resource.js), so the first paint of
 *     the dashboard shows it as available — that matches the
 *     registration form's behavior.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';
import { getCategoryEmoji, getCategoryLabel } from '../../utils/categories';
import { RESOURCE_STATUS } from '../../utils/constants';
import {
  useDeleteResource,
  useMyResources,
  useToggleAvailability,
} from '../../hooks/useMyResources';
import { useActiveRequestCount } from '../../hooks/useOwnerRequests';

const STATUS_FILTERS = Object.freeze([
  { value: null,         label: 'All' },
  { value: 'AVAILABLE',  label: 'Available' },
  { value: 'UNAVAILABLE', label: 'Unavailable' },
  { value: 'RESERVED',   label: 'Reserved' },
  { value: 'IN_USE',     label: 'In Use' },
]);

// Resources with these statuses are owned by Module 5.2 — the
// dashboard deliberately refuses to flip them out of paranoia about
// racing with the request controller.
const LIFECYCLE_STATUSES = new Set(['RESERVED', 'IN_USE']);

export default function OwnerDashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const newId = searchParams.get('new'); // set by the register form post-success
  const [statusFilter, setStatusFilter] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ── List ─────────────────────────────────────────────────────────────
  const list = useMyResources({
    status: statusFilter,
    page: 1,
    limit: 50,
    enabled: Boolean(user),
  });

  const resources = list.data?.resources || [];

  // ── Mutations ────────────────────────────────────────────────────────
  const toggle = useToggleAvailability();
  const del = useDeleteResource();
  const qc = useQueryClient();

  // ── Active request counter (Module 5.4) ─────────────────────────────
  // The OWNER's "incoming requests" inbox lives at /owner/requests; we
  // surface a tiny badge on this dashboard so the OWNER sees pending
  // request volume at a glance without having to drill into the inbox.
  // The hook fetches with a 1-minute staleTime so toggling a resource's
  // status doesn't re-fetch the counter.
  const activeCountQuery = useActiveRequestCount({
    enabled: Boolean(user),
  });

  // If we just landed from the registration form, refresh the list once
  // and surface a confirmation toast. The URL `?new=<id>` is the only
  // signal the register page passes — we don't add the new resource
  // optimistically because the server is already authoritative.
  useMemo(() => {
    if (newId) {
      toast.success('Resource registered');
      // Strip ?new from the URL so a refresh doesn't re-toast.
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
    // We only want to react once per `newId`, so depend on it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newId]);

  function onToggle(r) {
    const next =
      r.status === RESOURCE_STATUS.AVAILABLE.value
        ? RESOURCE_STATUS.UNAVAILABLE.value
        : RESOURCE_STATUS.AVAILABLE.value;
    toggle.mutate(
      { id: r.id, nextStatus: next },
      {
        onSuccess: () => {
          toast.success(
            next === RESOURCE_STATUS.AVAILABLE.value
              ? 'Marked as available'
              : 'Marked as unavailable'
          );
        },
        onError: (err) => {
          toast.error(err.message || 'Could not update availability');
        },
      }
    );
  }

  function onConfirmDelete() {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    del.mutate(id, {
      onSuccess: () => {
        toast.success('Resource deleted');
      },
      onError: (err) => {
        toast.error(err.message || 'Could not delete resource');
      },
    });
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Header
        user={user}
        onRefresh={() => qc.invalidateQueries({ queryKey: ['my-resources'] })}
        activeCount={activeCountQuery.data?.total || 0}
        activeCountLoading={activeCountQuery.isLoading}
      />

      <StatusFilters value={statusFilter} onChange={setStatusFilter} />

      {list.isLoading && <LoadingState />}

      {list.error && <ErrorBanner message={list.error.message || 'Could not load resources'} />}

      {!list.isLoading && !list.error && resources.length === 0 && (
        <EmptyState
          hasFilter={Boolean(statusFilter)}
          onClearFilter={() => setStatusFilter(null)}
        />
      )}

      {resources.length > 0 && (
        <ul className="grid gap-3">
          {resources.map((r) => (
            <ResourceCard
              key={r.id}
              resource={r}
              onToggle={() => onToggle(r)}
              onDelete={() => setConfirmDeleteId(r.id)}
              toggling={toggle.isPending && toggle.variables?.id === r.id}
              deleting={del.isPending && del.variables === r.id}
            />
          ))}
        </ul>
      )}

      {/* Pagination stub — the dashboard fits at most 50 resources per
          page by default; if the owner has more, we could add a "Load
          more" button. For 3.5 we just show the total count. */}
      {list.data?.pagination && resources.length > 0 && (
        <p className="text-xs text-slate-500">
          Showing {resources.length} of {list.data.pagination.total} resource
          {list.data.pagination.total === 1 ? '' : 's'}.
        </p>
      )}

      {confirmDeleteId && (
        <DeleteConfirmModal
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={onConfirmDelete}
          deleting={del.isPending}
        />
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({ user, onRefresh, activeCount = 0, activeCountLoading = false }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">My resources</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user ? (
            <>
              Everything you've registered,{' '}
              <span className="font-medium">{user.name || user.email}</span>.
            </>
          ) : (
            'Loading…'
          )}
        </p>
        {/* Module 5.4 — pending-requests counter. The badge links to
            the OWNER's inbox so a one-tap "see what's pending" path
            is always available from the dashboard. We render the
            link as a single block (no separate counter / link split)
            so screen-readers don't have to navigate two elements. */}
        <div className="mt-2">
          <Link
            to="/owner/requests"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 min-h-[44px]"
          >
            <span>Incoming requests</span>
            <span
              aria-label={
                activeCount === 0
                  ? 'No pending incoming requests'
                  : `${activeCount} pending incoming request${activeCount === 1 ? '' : 's'}`
              }
              className={
                'inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold ' +
                (activeCount > 0
                  ? 'bg-alert-700 text-white'
                  : 'bg-slate-100 text-slate-600')
              }
            >
              {activeCountLoading ? '…' : activeCount}
            </span>
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
        >
          Refresh
        </button>
        <Link
          to="/owner/resources/new"
          className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
        >
          + Register new
        </Link>
      </div>
    </header>
  );
}

// ── Status filter chips ───────────────────────────────────────────────────

function StatusFilters({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_FILTERS.map((f) => {
        const isActive = value === f.value;
        return (
          <button
            key={f.label}
            type="button"
            onClick={() => onChange(f.value)}
            aria-pressed={isActive}
            className={
              'rounded-full px-3 py-1 text-xs font-semibold transition ' +
              (isActive
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
            }
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Per-resource card ─────────────────────────────────────────────────────

function ResourceCard({ resource, onToggle, onDelete, toggling, deleting }) {
  const status = RESOURCE_STATUS[resource.status] || null;
  const isLifecycle = LIFECYCLE_STATUSES.has(resource.status);
  const toggleable = !isLifecycle;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="text-2xl leading-none"
          aria-hidden
          title={getCategoryLabel(resource.category)}
        >
          {getCategoryEmoji(resource.category)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              {resource.title || 'Untitled resource'}
            </h2>
            {status && <StatusBadge status={status} />}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            <span>{getCategoryLabel(resource.category)}</span>
            {typeof resource.capacity === 'number' && (
              <>
                {' · '}
                <span>capacity {resource.capacity}</span>
              </>
            )}
            {resource.createdAt && (
              <>
                {' · '}
                <span>added {formatDate(resource.createdAt)}</span>
              </>
            )}
          </p>
          {resource.description && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-700">
              {resource.description}
            </p>
          )}
          {(resource.photos && resource.photos.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {resource.photos.slice(0, 4).map((p, i) => (
                <img
                  key={i}
                  src={p.url}
                  alt=""
                  className="h-12 w-12 rounded-md border border-slate-200 object-cover"
                />
              ))}
              {resource.photos.length > 4 && (
                <span className="grid h-12 w-12 place-items-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-600">
                  +{resource.photos.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {toggleable ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={toggling}
              className={
                'rounded-md px-3 py-2.5 text-xs font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px] ' +
                (resource.status === RESOURCE_STATUS.AVAILABLE.value
                  ? 'border border-caution-300 bg-caution-50 text-caution-800 hover:bg-caution-100'
                  : 'border border-safe-300 bg-safe-50 text-safe-800 hover:bg-safe-100')
              }
            >
              {toggling
                ? 'Updating…'
                : resource.status === RESOURCE_STATUS.AVAILABLE.value
                ? 'Mark unavailable'
                : 'Mark available'}
            </button>
          ) : (
            <span
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 min-h-[44px]"
              title="Status is managed by the request lifecycle (Module 5.2)"
            >
              Managed by requests
            </span>
          )}
          <div className="flex items-center gap-2">
            <Link
              to={`/owner/resources/new?edit=${encodeURIComponent(resource.id)}`}
              onClick={(e) => {
                // The registration form (3.4) doesn't yet support an
                // edit mode. We still keep the link in the markup so
                // the UI matches the spec ("Edit/Delete actions") and
                // so a future extension can wire it without a layout
                // reflow. For 3.5 we surface a soft notice instead of
                // sending the user to a half-baked edit form.
                e.preventDefault();
                toast('Editing a resource will land in a future module.', {
                  icon: '🛠️',
                });
              }}
              className="rounded-md border border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="rounded-md border border-alert-300 px-3 py-2.5 text-xs font-medium text-alert-700 hover:bg-alert-50 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  // RESOURCE_STATUS keys match Resource.status enum values; the `color`
  // field is a Tailwind token (safe / caution / alert). We map to a
  // bg+text pair keyed off that token so the existing color palette
  // defined in index.css (@theme) carries through.
  const styleMap = {
    safe: 'bg-safe-100 text-safe-800 ring-1 ring-safe-300',
    caution: 'bg-caution-100 text-caution-800 ring-1 ring-caution-300',
    alert: 'bg-alert-100 text-alert-800 ring-1 ring-alert-300',
  };
  const className = styleMap[status.color] || 'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
  return (
    <span
      className={'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ' + className}
    >
      {status.label}
    </span>
  );
}

// ── Empty / loading / error ───────────────────────────────────────────────

function EmptyState({ hasFilter, onClearFilter }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">
        {hasFilter ? 'No resources in this status' : 'You haven\u2019t registered any resources yet'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {hasFilter
          ? 'Try a different filter or clear it to see everything.'
          : 'List vehicles, equipment, space, or skills you can share during a crisis.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {hasFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded-md border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
          >
            Clear filter
          </button>
        )}
        <Link
          to="/owner/resources/new"
          className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
        >
          Register your first resource
        </Link>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <ul className="grid gap-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100"
        />
      ))}
    </ul>
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

// ── Delete confirmation modal (lightweight — no portal) ────────────────────

function DeleteConfirmModal({ onCancel, onConfirm, deleting }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      onClick={(e) => {
        // Backdrop click cancels; the button stops propagation so
        // clicking the dialog box itself doesn't close it.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg">
        <h2
          id="delete-confirm-title"
          className="text-base font-semibold text-slate-900"
        >
          Delete this resource?
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          This is permanent. Any active or pending requests against this
          resource will fail because their reference becomes invalid.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-md bg-alert-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
