/**
 * OwnerRequestsPage — Module 5.4.
 *
 * The OWNER's inbox for incoming resource requests. The mirror of
 * Module 5.3's VolunteerDashboardPage but on the request-receiving
 * side. What this page does:
 *
 *   1. Lists the owner's incoming requests (GET /api/requests). The
 *      server's role-scoped list narrows the result to requests
 *      where ownerId === req.user._id for an OWNER caller (see
 *      server/controllers/request.controller.js — 5.2). The client
 *      never sends a "mine" flag; the server enforces the scope.
 *
 *   2. Shows a status badge per request (REQUESTED / APPROVED /
 *      REJECTED / COLLECTED / RETURNED / CANCELLED) — same palette
 *      the volunteer dashboard uses, so a request's status reads
 *      identically on both sides.
 *
 *   3. Three CTAs gated on status — these are the OWNER's actions:
 *        - REQUESTED → "Approve" + "Reject"
 *        - APPROVED  → "Reject" (a moderator-rejection-style
 *          cancel before the volunteer picks the resource up)
 *        - RETURNED  → "Confirm return" (re-list the resource)
 *      Other statuses intentionally render no action — the
 *      transition is owned by the other party (volunteer collect,
 *      volunteer return).
 *
 *   4. Owner-to-volunteer contact reveal — the OWNER's counterpart
 *      of Module 5.3's OwnerContactCard. The server's GET /api/requests/:id
 *      surfaces both parties' contact info when status === COLLECTED
 *      (the privacy gate). The list endpoint never reveals contact
 *      info — only summary fields (volunteerSummary.name, resource
 *      title/category). To show contact info to the OWNER, this page
 *      lazily fetches the single request when status === COLLECTED
 *      (a single round-trip per row, gated on the server's reveal
 *      rule — no extra endpoint needed).
 *
 *   5. Resource summary inline — the list endpoint populates
 *      `request.resource` (category + title + status) so the OWNER
 *      sees what resource the volunteer is asking about without
 *      drilling into the details page. Same pattern Module 5.3 used
 *      on the volunteer side.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The page source NEVER calls /users/:id or /auth/me to enrich
 *     the request — all data arrives via the server's response.
 *   - Contact info is only fetched via GET /api/requests/:id, and
 *     only for rows in status === COLLECTED. Before then, the
 *     OWNER sees only the volunteerSummary.name (id + name).
 *   - The list endpoint populates `volunteerSummary.name` but never
 *     email/phone; the privacy assertion is in the smoke test.
 *
 * Why approve / reject / confirm-return are plain verbs, not jargon:
 *   The OWNER in a crisis isn't a power user either. The CTA labels
 *   describe the action from the OWNER's point of view — "Approve"
 *   means "I'll let this person take it", "Reject" means "no", and
 *   "Confirm return" means "I have it back, mark it available".
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';
import {
  useApproveRequest,
  useCompleteRequest,
  useOwnerRequests,
  useRejectRequest,
} from '../../hooks/useOwnerRequests';
import {
  getCategoryEmoji,
  getCategoryLabel,
} from '../../utils/categories';

// Status filter chip set. "All" is the implicit "no filter". The
// OWNER-facing inbox exposes the same six status values the volunteer
// side does — including CANCELLED this time, because an OWNER can
// see a CANCELLED request if the volunteer manages to cancel one
// (Module 5.2 doesn't expose a cancel endpoint yet, but the schema
// supports the value).
const STATUS_FILTERS = Object.freeze([
  { value: null,        label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED',  label: 'Approved' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'RETURNED',  label: 'Returned' },
  { value: 'REJECTED',  label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
]);

// Map a request status → display metadata. Mirrors the volunteer
// dashboard's palette so a request's status reads identically across
// the two surfaces.
const REQUEST_STATUS_META = Object.freeze({
  REQUESTED: { label: 'Requested', color: 'slate' },
  APPROVED:  { label: 'Approved',  color: 'caution' },
  REJECTED:  { label: 'Rejected',  color: 'alert' },
  COLLECTED: { label: 'Collected', color: 'safe' },
  RETURNED:  { label: 'Returned',  color: 'caution' },
  CANCELLED: { label: 'Cancelled', color: 'alert' },
});

// Map a Resource.status (populated on list responses) to a tiny
// descriptor so the row can hint at the resource's current state
// without forcing the OWNER to drill into the resource details page.
const RESOURCE_STATUS_LABEL = Object.freeze({
  AVAILABLE:   'Available',
  RESERVED:    'Reserved',
  IN_USE:      'In use',
  UNAVAILABLE: 'Unavailable',
});

export default function OwnerRequestsPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState(null);

  // The list query. Server narrows to ownerId===me for OWNER callers.
  const list = useOwnerRequests({
    status: statusFilter,
    page: 1,
    limit: 50,
    enabled: Boolean(user),
  });

  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const complete = useCompleteRequest();

  useEffect(() => {
    if (approve.isSuccess) {
      toast.success('Request approved. The volunteer can pick the resource up.');
      approve.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approve.isSuccess]);

  useEffect(() => {
    if (reject.isSuccess) {
      toast.success('Request rejected.');
      reject.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reject.isSuccess]);

  useEffect(() => {
    if (complete.isSuccess) {
      toast.success('Return confirmed. The resource is back in your catalog.');
      complete.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete.isSuccess]);

  async function handleApprove(requestId) {
    try {
      await approve.mutateAsync(requestId);
    } catch (err) {
      toast.error((err && err.message) || 'Could not approve this request.');
    }
  }

  async function handleReject(requestId) {
    // We don't gate this behind a confirmation modal in 5.4 — a
    // confirm step would force an extra click on a stressed owner.
    // The reject endpoint is the safety net (it leaves the resource
    // AVAILABLE if the request hadn't reached APPROVED yet, and
    // un-RESERVES if it had — so a misclick costs at most a brief
    // re-list).
    try {
      await reject.mutateAsync({ id: requestId });
    } catch (err) {
      toast.error((err && err.message) || 'Could not reject this request.');
    }
  }

  async function handleComplete(requestId) {
    try {
      await complete.mutateAsync(requestId);
    } catch (err) {
      toast.error(
        (err && err.message) || 'Could not confirm the return.'
      );
    }
  }

  const requests = list.data?.requests || [];
  const total = list.data?.pagination?.total || 0;

  return (
    <div className="space-y-6">
      <Header />

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
            'Failed to load incoming requests.'
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
              onApprove={handleApprove}
              onReject={handleReject}
              onComplete={handleComplete}
              approvePending={
                approve.isPending && approve.variables === r.id
              }
              rejectPending={
                reject.isPending &&
                reject.variables &&
                reject.variables.id === r.id
              }
              completePending={
                complete.isPending && complete.variables === r.id
              }
            />
          ))}
        </ul>
      )}

      <PrivacyFooter />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Incoming requests
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Volunteers who've asked to take your resources. Approve a
          request to mark the resource as reserved, reject to release
          it back into the catalog. After the volunteer returns it,
          confirm the return so it can be requested again.
        </p>
      </div>
    </header>
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

function RequestRow({
  request: r,
  onApprove,
  onReject,
  onComplete,
  approvePending,
  rejectPending,
  completePending,
}) {
  const meta = REQUEST_STATUS_META[r.status] || {
    label: r.status,
    color: 'slate',
  };

  const canApprove = r.status === 'REQUESTED';
  const canReject = r.status === 'REQUESTED' || r.status === 'APPROVED';
  const canComplete = r.status === 'RETURNED';
  const isTerminal =
    r.status === 'REJECTED' ||
    r.status === 'CANCELLED' ||
    r.status === 'COLLECTED';

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
            </span>{' '}
            {volunteer && volunteer.isVerified && (
              <span
                title="Verified volunteer"
                aria-label="Verified volunteer"
                className="ml-1 inline-flex items-center gap-1 rounded-full bg-safe-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-safe-800"
              >
                <span aria-hidden>✓</span> Verified
              </span>
            )}{' '}
            · Submitted {formatDate(r.requestedAt)}
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
        status={r.status}
        canApprove={canApprove}
        canReject={canReject}
        canComplete={canComplete}
        isTerminal={isTerminal}
        onApprove={() => onApprove(r.id)}
        onReject={() => onReject(r.id)}
        onComplete={() => onComplete(r.id)}
        approvePending={approvePending}
        rejectPending={rejectPending}
        completePending={completePending}
      />

      {/* Volunteer contact card — gated on COLLECTED, mirroring 5.3's
          OwnerContactCard. List responses never carry email/phone,
          so when status===COLLECTED we lazily fetch the single
          request via GET /:id which DOES reveal contacts for the
          principal. The OWNER (the request's owner) is the principal
          here. */}
      {r.status === 'COLLECTED' && (
        <VolunteerContactCard requestId={r.id} />
      )}
    </li>
  );
}

// Server populates `request.resource` (category/title/status) on the
// list endpoint, and `request.volunteerSummary` (name + id). Fall
// back to hex id hints when either is missing.
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

// ── Action row + contact card ─────────────────────────────────────────────

function ActionRow({
  status,
  canApprove,
  canReject,
  canComplete,
  isTerminal,
  onApprove,
  onReject,
  onComplete,
  approvePending,
  rejectPending,
  completePending,
}) {
  const anyPending = approvePending || rejectPending || completePending;
  return (
    <div className="mt-3 space-y-3">
      {(canApprove || canReject) && (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove && (
            <button
              type="button"
              onClick={onApprove}
              disabled={anyPending}
              className="rounded-md bg-safe-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-safe-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approvePending ? 'Approving…' : 'Approve'}
            </button>
          )}
          {canReject && (
            <button
              type="button"
              onClick={onReject}
              disabled={anyPending}
              className="rounded-md border border-alert-300 bg-white px-3 py-1.5 text-sm font-medium text-alert-700 hover:bg-alert-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {rejectPending ? 'Rejecting…' : 'Reject'}
            </button>
          )}
          <p className="text-xs text-slate-500">
            Approving reserves the resource. Rejecting releases it
            back into the catalog for other volunteers.
          </p>
        </div>
      )}

      {canComplete && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onComplete}
            disabled={anyPending}
            className="rounded-md bg-safe-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-safe-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {completePending ? 'Confirming…' : 'Confirm return'}
          </button>
          <p className="text-xs text-slate-500">
            The volunteer marked the resource returned. Confirm so it
            can be requested again.
          </p>
        </div>
      )}

      {isTerminal && (
        <p className="text-xs text-slate-500">
          {status === 'COLLECTED'
            ? 'Resource is in the volunteer\u2019s hands. No owner action needed until they mark it returned.'
            : 'This request is closed. No further actions are available.'}
        </p>
      )}
    </div>
  );
}

/**
 * The OWNER's counterpart of Module 5.3's OwnerContactCard. When the
 * request is COLLECTED the server reveals both parties' contact info
 * via GET /api/requests/:id (the privacy gate). For the OWNER, this
 * surfaces the VOLUNTEER's name + email + phone so they can coordinate
 * the handover / return.
 *
 * Lazy fetch: we don't pre-fetch every row. The list endpoint never
 * carries email/phone (Module 5.2's privacy boundary); the single-
 * request endpoint is the only path that reveals contact info, and
 * we only call it for the rows the user actually needs to see (i.e.
 * COLLECTED).
 */
function VolunteerContactCard({ requestId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    import('../../services/api').then(({ default: api }) => {
      api
        .get(`/requests/${requestId}`)
        .then((resp) => {
          if (cancelled) return;
          setData(resp?.data?.data?.request || null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  if (loading) {
    return (
      <div className="rounded-md border border-safe-300 bg-safe-50 p-3">
        <p className="text-xs text-safe-800">Loading volunteer contact…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-600">
          Volunteer contact is hidden for this request.
        </p>
      </div>
    );
  }

  const v = data.volunteer;
  if (!v || (!v.email && !v.phone)) {
    return null;
  }

  return (
    <div className="rounded-md border border-safe-300 bg-safe-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-safe-800">
        Volunteer contact (revealed after collection)
      </p>
      <dl className="mt-2 space-y-1 text-sm text-safe-900">
        {v.name && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Name
            </dt>
            <dd>{v.name}</dd>
          </div>
        )}
        {v.email && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Email
            </dt>
            <dd>
              <a
                href={`mailto:${v.email}`}
                className="text-safe-800 underline hover:text-safe-900"
              >
                {v.email}
              </a>
            </dd>
          </div>
        )}
        {v.phone && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Phone
            </dt>
            <dd>
              <a
                href={`tel:${v.phone}`}
                className="text-safe-800 underline hover:text-safe-900"
              >
                {v.phone}
              </a>
            </dd>
          </div>
        )}
      </dl>
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
      <span className="sr-only">Loading incoming requests…</span>
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
        No incoming requests yet.
      </p>
      <p className="mt-1 text-xs text-slate-600">
        When a verified volunteer asks for one of your resources, it
        will appear here. Approve to reserve, reject to release.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to="/owner/resources"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Open my resources
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
      Volunteer contact info is only revealed after a request is
      collected. Until then, you only see the volunteer's name — no
      email or phone — so a request you reject can't lead to an
      unsolicited follow-up.
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
