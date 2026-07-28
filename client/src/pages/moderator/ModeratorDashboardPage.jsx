/**
 * ModeratorDashboardPage — Module 5.5.
 *
 * The MODERATOR's surface for area-scoped request oversight. The
 * mirror of Module 5.4's OwnerRequestsPage on the oversight side:
 *
 *   1. Lists requests in the moderator's area (GET /api/requests).
 *      The server's role-scoped list joins through
 *      Resource.areaId === req.user.areaId for MODERATOR callers
 *      (see server/controllers/request.controller.js — 5.2). A
 *      moderator without an areaId sees an empty list — the controller
 *      returns { requests: [] } before hitting the database, so the
 *      empty-state UI is the correct fallback for that case. The
 *      client never sends a `mine` flag; the server enforces the
 *      scope.
 *
 *   2. Shows a status badge per request (REQUESTED / APPROVED /
 *      REJECTED / COLLECTED / RETURNED / CANCELLED) — same palette
 *      the owner + volunteer dashboards use, so a request's status
 *      reads identically on every surface.
 *
 *   3. ONE CTA gated on status — "Reject" — which fires from
 *      REQUESTED or APPROVED. The reject action opens an inline
 *      `ModeratorNoteDialog` that captures an optional
 *      `moderatorNote` (the same field the owner-side Reject uses).
 *      There is NO Approve / Collect / Return / Complete CTA: the
 *      server enforces 403 on every other PATCH endpoint for a
 *      moderator token (5.2 controller), and rendering those CTAs
 *      would invite actions the server will reject.
 *
 *   4. Resource allocation overview — the list populates
 *      `request.resource.{category,title,status}` so the moderator
 *      sees, per request, what category the resource belongs to
 *      and the resource's current lifecycle status. Aggregating
 *      across the list (e.g. "3 RESERVED, 1 IN_USE, 5 AVAILABLE")
 *      gives the moderator a snapshot of the area's allocation
 *      without a separate endpoint.
 *
 *   5. Privacy footer — the moderator's scope is summary-only by
 *      design. Contact info reveal (email/phone) is gated on the
 *      server's `publicRequest()` helper at status === COLLECTED,
 *      AND the GET /:id endpoint restricts to principal-or-admin
 *      (server controller line ~451) — moderators are neither.
 *      PrivacyFooter on this page explains that to the user so the
 *      design intent is legible.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The page source NEVER calls /users/:id or /auth/me. There is
 *     no volunteer / owner detail card, no mailto: link, no tel:
 *     link — moderators don't need them and the server wouldn't
 *     serve them.
 *   - There is no GET /api/requests/:id call on this surface. The
 *     moderator's reject action uses PATCH /:id/reject, which
 *     returns the updated request without the contact block
 *     (status is REJECTED after the call, so the helper still
 *     gates).
 *   - The only outbound traffic the page generates is GET /requests
 *     (list) + PATCH /requests/:id/reject (mutation).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';
import {
  useModeratorRequestCount,
  useModeratorRequests,
  useRejectModeratorRequest,
} from '../../hooks/useModeratorRequests';
import {
  getCategoryEmoji,
  getCategoryLabel,
} from '../../utils/categories';

// Status filter chip set. Moderators oversee every status — the
// dashboard isn't a personal action queue (that's the owner's), so
// all six REQUEST_STATUS values plus the implicit "All" chip are
// shown. Same shape as the 5.4 inbox for consistency.
const STATUS_FILTERS = Object.freeze([
  { value: null,        label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED',  label: 'Approved' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'RETURNED',  label: 'Returned' },
  { value: 'REJECTED',  label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
]);

// Status → display metadata. Shared palette across the volunteer,
// owner, and moderator dashboards so a request's status reads
// identically on every surface.
const REQUEST_STATUS_META = Object.freeze({
  REQUESTED: { label: 'Requested', color: 'slate' },
  APPROVED:  { label: 'Approved',  color: 'caution' },
  REJECTED:  { label: 'Rejected',  color: 'alert' },
  COLLECTED: { label: 'Collected', color: 'safe' },
  RETURNED:  { label: 'Returned',  color: 'caution' },
  CANCELLED: { label: 'Cancelled', color: 'alert' },
});

// Resource.status → tiny label so the row can hint at the resource's
// current lifecycle state. Mirrors 5.4's mapping.
const RESOURCE_STATUS_LABEL = Object.freeze({
  AVAILABLE:   'Available',
  RESERVED:    'Reserved',
  IN_USE:      'In use',
  UNAVAILABLE: 'Unavailable',
});

// Cap client-side on the moderatorNote so the user gets immediate
// feedback before the request goes out. The server enforces the
// same cap (server/validators/request.validators.js — actionBodySchema).
const MAX_NOTE_CHARS = 1000;

export default function ModeratorDashboardPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState(null);
  const [dialogRequestId, setDialogRequestId] = useState(null);

  // The list query — area-scoped server-side for MODERATOR callers.
  const list = useModeratorRequests({
    status: statusFilter,
    page: 1,
    limit: 50,
    enabled: Boolean(user),
  });

  // Pending-count badge — REQUESTED only.
  const pendingCount = useModeratorRequestCount({
    enabled: Boolean(user),
  });

  const reject = useRejectModeratorRequest();

  useEffect(() => {
    if (reject.isSuccess) {
      const hadNote = Boolean(
        reject.variables && reject.variables.moderatorNote
      );
      toast.success(
        hadNote
          ? 'Request rejected with note.'
          : 'Request rejected.'
      );
      reject.reset?.();
      setDialogRequestId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reject.isSuccess]);

  function handleOpenReject(requestId) {
    setDialogRequestId(requestId);
  }

  function handleCloseReject() {
    if (!reject.isPending) setDialogRequestId(null);
  }

  async function handleSubmitReject({ id, moderatorNote }) {
    try {
      await reject.mutateAsync({
        id,
        moderatorNote: moderatorNote || undefined,
      });
    } catch (err) {
      toast.error((err && err.message) || 'Could not reject this request.');
    }
  }

  const requests = list.data?.requests || [];
  const total = list.data?.pagination?.total || 0;
  const activeId = dialogRequestId;

  return (
    <div className="space-y-6">
      <Header
        areaId={user && user.areaId}
        pendingCount={pendingCount.data && pendingCount.data.total}
        pendingCountLoading={pendingCount.isLoading}
      />

      <FilterBar
        value={statusFilter}
        onChange={setStatusFilter}
        total={total}
      />

      {list.isLoading && <LoadingState />}
      {list.error && (
        <ErrorBanner
          message={
            (list.error && list.error.message) ||
            'Failed to load area requests.'
          }
        />
      )}

      {!list.isLoading && !list.error && requests.length === 0 && (
        <EmptyState
          hasFilter={Boolean(statusFilter)}
          onClear={() => setStatusFilter(null)}
        />
      )}

      {requests.length > 0 && (
        <ul className="space-y-3">
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              onOpenReject={handleOpenReject}
              rejectPending={
                reject.isPending &&
                reject.variables &&
                reject.variables.id === r.id
              }
            />
          ))}
        </ul>
      )}

      {activeId && (
        <ModeratorNoteDialog
          requestId={activeId}
          onCancel={handleCloseReject}
          onSubmit={handleSubmitReject}
          pending={reject.isPending}
        />
      )}

      <PrivacyFooter />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({ areaId, pendingCount, pendingCountLoading }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Request oversight
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Area-scoped view of every resource request in your assigned
          region. Use the status filter to focus on the queue you can
          act on. Reject when a request shouldn't move forward and
          leave a note explaining the decision.
        </p>
        <AreaScopeHint areaId={areaId} />
      </div>
      {typeof pendingCount === 'number' && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Pending
          </p>
          {pendingCountLoading ? (
            <span
              aria-hidden
              className="inline-block h-5 w-8 animate-pulse rounded bg-slate-200"
            />
          ) : (
            <span className="text-xl font-semibold text-slate-900">
              {pendingCount}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * Surfaces the moderator's assigned area or a "no area assigned"
 * hint. The server returns [] for moderators without an areaId —
 * the page handles that case via EmptyState, but it's friendlier
 * to surface the reason in the header too.
 */
function AreaScopeHint({ areaId }) {
  if (!areaId) {
    return (
      <p className="mt-2 rounded-md border border-caution-300 bg-caution-50 px-3 py-2 text-xs text-caution-800">
        <span className="font-medium">Area scope:</span> no area is
        assigned to your moderator account yet, so the list below is
        empty. Ask an admin to assign an area before continuing.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-slate-500">
      <span className="font-medium">Area scope:</span> showing
      requests for resources in your assigned area.
    </p>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────

function FilterBar({ value, onChange, total }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label="Filter by status"
      >
        {STATUS_FILTERS.map((opt) => {
          const active = (value || null) === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={
                'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
                (active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">
        {total} request{total === 1 ? '' : 's'}
      </p>
    </div>
  );
}

// ── Request row ───────────────────────────────────────────────────────────

function RequestRow({ request: r, onOpenReject, rejectPending }) {
  const meta = REQUEST_STATUS_META[r.status] || {
    label: r.status,
    color: 'slate',
  };

  const canReject = r.status === 'REQUESTED' || r.status === 'APPROVED';
  const isTerminal =
    r.status === 'REJECTED' ||
    r.status === 'CANCELLED' ||
    r.status === 'COLLECTED' ||
    r.status === 'RETURNED';

  const resource = r.resource || null;
  const volunteer = r.volunteerSummary || null;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge meta={meta} />
            <p className="text-sm font-medium text-slate-900">
              {resourceTitleOrFallback(r)}
            </p>
            {resource && resource.status && (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                Resource: {RESOURCE_STATUS_LABEL[resource.status] || resource.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Requested by{' '}
            <span className="font-medium text-slate-700">
              {volunteer ? volunteer.name : 'unknown volunteer'}
            </span>
            {' · '}
            Submitted {formatDate(r.requestedAt)}
            {r.approvedAt ? ` · Approved ${formatDate(r.approvedAt)}` : ''}
            {r.collectedAt ? ` · Collected ${formatDate(r.collectedAt)}` : ''}
            {r.returnedAt ? ` · Returned ${formatDate(r.returnedAt)}` : ''}
          </p>
          {r.moderatorNote && (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-700">Note:</span>{' '}
              {r.moderatorNote}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.resourceId && (
            <Link
              to={`/resources/${r.resourceId}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              View resource
            </Link>
          )}
        </div>
      </div>

      <ActionRow
        canReject={canReject}
        isTerminal={isTerminal}
        onReject={() => onOpenReject(r.id)}
        rejectPending={rejectPending}
      />
    </li>
  );
}

// Render a resource title + category emoji from the populated list
// summary. Falls back to a hex id hint when the resource isn't
// populated (shouldn't happen for moderator list responses since
// 5.4, but the guard keeps the UI resilient).
function resourceTitleOrFallback(r) {
  if (r.resource && r.resource.title) {
    return (
      <span className="flex items-center gap-1">
        {r.resource.category && (
          <span aria-hidden className="text-base leading-none">
            {getCategoryEmoji(r.resource.category)}
          </span>
        )}
        <span>{r.resource.title}</span>
      </span>
    );
  }
  if (r.resourceId) {
    return (
      <span className="font-mono text-xs text-slate-500">
        resource {(r.resourceId || '').slice(0, 8)}…
      </span>
    );
  }
  return 'Resource request';
}

// ── Action row ────────────────────────────────────────────────────────────

function ActionRow({ canReject, isTerminal, onReject, rejectPending }) {
  return (
    <div className="mt-3 space-y-3">
      {canReject && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            disabled={rejectPending}
            className="rounded-md border border-alert-300 bg-white px-3 py-1.5 text-sm font-medium text-alert-700 hover:bg-alert-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {rejectPending ? 'Rejecting…' : 'Reject with note'}
          </button>
          <p className="text-xs text-slate-500">
            Rejecting releases the resource back into the catalog.
            Add a note so the volunteer understands the decision.
          </p>
        </div>
      )}

      {isTerminal && (
        <p className="text-xs text-slate-500">
          This request is closed. No moderator action is available.
        </p>
      )}
    </div>
  );
}

// ── Reject note dialog ────────────────────────────────────────────────────

/**
 * Inline confirmation dialog for the moderator's reject action.
 * Captures an optional `moderatorNote` (≤1000 chars client-side;
 * the server enforces the same cap). On submit, fires the
 * `useRejectModeratorRequest` mutation.
 */
function ModeratorNoteDialog({ requestId, onCancel, onSubmit, pending }) {
  const [note, setNote] = useState('');

  // Reset the textarea when the dialog opens for a different
  // request so a stale note from a previous row never leaks.
  useEffect(() => {
    setNote('');
  }, [requestId]);

  const trimmed = note.trim();
  const tooLong = note.length > MAX_NOTE_CHARS;

  function handleSubmit(event) {
    event.preventDefault();
    if (tooLong) return;
    onSubmit({ id: requestId, moderatorNote: trimmed || undefined });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mod-reject-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
      >
        <h2
          id="mod-reject-title"
          className="text-lg font-semibold text-slate-900"
        >
          Reject this request
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          The request will move to REJECTED and the resource will be
          released back into the catalog (or un-RESERVED if it had
          already been approved).
        </p>

        <label className="mt-4 block">
          <span className="block text-xs font-medium text-slate-700">
            Note (optional, summaries only)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE_CHARS + 50}
            rows={4}
            placeholder="Why this request shouldn't move forward. The note is shared with the volunteer and the owner."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-safe-500 focus:outline-none focus:ring-1 focus:ring-safe-500"
          />
          <span
            className={
              'mt-1 block text-xs ' +
              (tooLong ? 'text-alert-700' : 'text-slate-500')
            }
          >
            {note.length}/{MAX_NOTE_CHARS} characters
            {tooLong ? ' — over the limit' : ''}
          </span>
        </label>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || tooLong}
            className="rounded-md bg-alert-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Rejecting…' : 'Reject request'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ meta }) {
  const palette = {
    safe: 'bg-safe-100 text-safe-800 ring-1 ring-safe-300',
    caution: 'bg-caution-100 text-caution-800 ring-1 ring-caution-300',
    alert: 'bg-alert-100 text-alert-800 ring-1 ring-alert-300',
    slate: 'bg-slate-100 text-slate-700 ring-1 ring-slate-300',
  };
  const cls = palette[meta.color] || palette.slate;
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ' +
        cls
      }
    >
      {meta.label}
    </span>
  );
}

// ── States ────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white"
        />
      ))}
      <span className="sr-only">Loading area requests…</span>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="rounded-md border border-alert-300 bg-alert-50 px-4 py-3 text-sm text-alert-800">
      {message}
    </div>
  );
}

function EmptyState({ hasFilter, onClear }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">
        No requests in your area.
      </p>
      <p className="mt-1 text-xs text-slate-600">
        When a verified volunteer asks for a resource in your assigned
        area, it will appear here. Filter the status to focus the queue,
        or clear the filter to see the full history.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to="/resources"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Browse resources
        </Link>
        {hasFilter && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Clear filter
          </button>
        )}
      </div>
    </div>
  );
}

function PrivacyFooter() {
  return (
    <p className="rounded-md bg-slate-50 px-4 py-3 text-xs text-slate-600">
      Moderator oversight works on <strong>summaries only</strong>.
      Volunteer and owner contact info is intentionally hidden on this
      dashboard — it's revealed to the request principals only after a
      resource is collected. This keeps moderator scope focused on
      triage, not outreach.
    </p>
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
    return '—';
  }
}