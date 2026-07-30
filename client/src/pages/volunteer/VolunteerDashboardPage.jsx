/**
 * VolunteerDashboardPage — Module 5.3.
 *
 * The volunteer's home for the requests they've submitted. Mirrors the
 * pattern Module 3.5 used for OwnerDashboardPage but on the
 * request-lifecycle side instead of the resource-lifecycle side.
 *
 * What this page does:
 *
 *   1. Lists the volunteer's own requests (GET /api/requests). The
 *      server's role-scoped list narrows the result to requests where
 *      volunteerId === req.user._id for a VOLUNTEER caller (see
 *      server/controllers/request.controller.js — 5.2). The client
 *      never sends a "mine" flag; the server enforces the scope.
 *
 *   2. Shows a status badge per request (REQUESTED / APPROVED /
 *      REJECTED / COLLECTED / RETURNED / CANCELLED). Each badge is
 *      colored from a request-status palette that's analogous to the
 *      resource-status palette (Module 3.5) but tuned for the request
 *      lifecycle.
 *
 *   3. Two action buttons per row, gated on status:
 *        - APPROVED → "I picked it up" (PATCH /:id/collect)
 *        - COLLECTED → "I've returned it" (PATCH /:id/return)
 *      Other statuses intentionally render no action — the transition
 *      is owned by the other party (owner approve/reject, owner
 *      complete).
 *
 *   4. Owner contact reveal — **the KEY DESIGN REMINDER privacy gate**.
 *      The server reveals the owner's name + email + phone ONLY when
 *      status === COLLECTED. We render a small "Owner contact" card
 *      for those rows so the volunteer can coordinate the handover.
 *      Before COLLECTED the response carries only the owner's id +
 *      summary name (no email, no phone) — we render the summary name
 *      only.
 *
 *   5. Resource summary — the server's GET /api/requests/:id populates
 *      `request.resource` (category/title/status) inline. The list
 *      endpoint does NOT populate (it stays lightweight), so list
 *      cards surface the resource id as a hex hint + a link to
 *      /resources/:id. Module 5.4's owner surface populates the
 *      resource; that's outside this module's scope.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The page source NEVER calls /users/:id or /auth/me. Owner/
 *     volunteer contact info only arrives via the response, and only
 *     after the COLLECTED gate. The smoke test strips JS comments
 *     before grepping so this assertion isn't tripped by the
 *     documentation block above.
 *   - The page's mutation hooks (`useCollectRequest` /
 *     `useReturnRequest` from useMyRequests.js) are the ONLY outbound
 *     calls; the list endpoint is a single GET.
 *
 * Why the "I picked it up" / "I've returned it" labels are plain
 *  verbs, not jargon:
 *   Volunteers in a crisis aren't power users. The two CTA labels
 *   describe the volunteer's action from their point of view, not
 *   the database status the request transitions to. The status pill
 *   below the card surfaces the underlying state for clarity.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';
import {
  useCollectRequest,
  useMyRequests,
  useReturnRequest,
} from '../../hooks/useMyRequests';

// Status filter chip set. "All" is the implicit "no filter".
// We don't surface CANCELLED in the chip set — the volunteer never
// cancels in 5.2 (no endpoint), so the chip would always be empty
// for the volunteer side.
const STATUS_FILTERS = Object.freeze([
  { value: null,        label: 'All' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED',  label: 'Approved' },
  { value: 'COLLECTED', label: 'Collected' },
  { value: 'RETURNED',  label: 'Returned' },
  { value: 'REJECTED',  label: 'Rejected' },
]);

// Map a request status → display metadata. The color mirrors the
// resource-status palette so the dashboard feels consistent across the
// app (safe for terminal-good outcomes, caution for in-progress,
// alert for terminal-bad outcomes).
const REQUEST_STATUS_META = Object.freeze({
  REQUESTED: { label: 'Requested', color: 'slate' },
  APPROVED:  { label: 'Approved',  color: 'caution' },
  REJECTED:  { label: 'Rejected',  color: 'alert' },
  COLLECTED: { label: 'Collected', color: 'safe' },
  RETURNED:  { label: 'Returned',  color: 'caution' },
  CANCELLED: { label: 'Cancelled', color: 'alert' },
});

export default function VolunteerDashboardPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState(null);

  // The list query. We don't send a "mine" flag — the server narrows
  // by req.user._id for VOLUNTEERs (5.2 listRequests).
  const list = useMyRequests({
    status: statusFilter,
    page: 1,
    limit: 50,
    enabled: Boolean(user),
  });

  const collect = useCollectRequest();
  const ret = useReturnRequest();

  // If the most recent collect succeeded, fire a one-shot toast so the
  // volunteer knows owner contact info is now available on the row.
  // We don't persist this — the server's status===COLLECTED is the
  // single source of truth for the privacy gate.
  useEffect(() => {
    if (collect.isSuccess && collect.data) {
      const r = collect.data;
      const owner = r?.owner;
      if (owner && owner.phone) {
        toast.success("Marked collected. Owner's contact info is now visible.");
      } else {
        toast.success('Marked collected.');
      }
      // Reset collect.idle so a refresh of the same id doesn't
      // re-toast. Returning to idle requires the next mutation cycle.
      collect.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collect.isSuccess]);

  useEffect(() => {
    if (ret.isSuccess) {
      toast.success("Marked returned. The owner will confirm when they're done.");
      ret.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ret.isSuccess]);

  // Action handlers — small wrappers so the row markup stays readable.
  async function handleCollect(requestId) {
    try {
      await collect.mutateAsync(requestId);
    } catch (err) {
      toast.error(
        (err && err.message) || 'Could not mark this request as collected.'
      );
    }
  }

  async function handleReturn(requestId) {
    try {
      await ret.mutateAsync(requestId);
    } catch (err) {
      toast.error(
        (err && err.message) || 'Could not mark this request as returned.'
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
      {list.error && list.error.status !== 404 && (
        <ErrorBanner message={(list.error && list.error.message) || 'Failed to load your requests.'} />
      )}

      {!list.isLoading && !list.error && requests.length === 0 && (
        <EmptyState hasFilter={Boolean(statusFilter)} onClear={() => setStatusFilter(null)} />
      )}

      {requests.length > 0 && (
        <ul className="space-y-3">
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              onCollect={handleCollect}
              onReturn={handleReturn}
              collectPending={collect.isPending && collect.variables === r.id}
              returnPending={ret.isPending && ret.variables === r.id}
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
          My Requests
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Track the resources you've requested. Owner contact info
          becomes visible only after a request is approved AND you've
          picked the resource up.
        </p>
      </div>
    </header>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────

function FilterBar({ value, onChange, total }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Filter by status">
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
  onCollect,
  onReturn,
  collectPending,
  returnPending,
}) {
  const meta = REQUEST_STATUS_META[r.status] || {
    label: r.status,
    color: 'slate',
  };

  const canCollect = r.status === 'APPROVED';
  const canReturn = r.status === 'COLLECTED';
  const isTerminal =
    r.status === 'REJECTED' ||
    r.status === 'RETURNED' ||
    r.status === 'CANCELLED';

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge meta={meta} />
            <p className="text-sm font-medium text-slate-900">
              {resourceTitleOrFallback(r)}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
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
              className="rounded-md border border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
            >
              View resource
            </Link>
          )}
        </div>
      </div>

      <ActionRow
        status={r.status}
        ownerSummary={r.ownerSummary}
        ownerFull={r.owner}
        resourceSummary={r.resource}
        canCollect={canCollect}
        canReturn={canReturn}
        isTerminal={isTerminal}
        areaEmergencyActive={r.areaEmergencyActive === true}
        onCollect={() => onCollect(r.id)}
        onReturn={() => onReturn(r.id)}
        collectPending={collectPending}
        returnPending={returnPending}
      />
    </li>
  );
}

// Server populates resource inline ONLY on GET /:id; the list
// endpoint keeps requests lightweight. Fall back to a hex id hint
// when the resource summary is missing.
function resourceTitleOrFallback(r) {
  if (r.resource && r.resource.title) return r.resource.title;
  if (r.resourceId) {
    return (
      <span className="font-mono text-xs text-slate-500">
        resource {(r.resourceId || '').slice(0, 8)}…
      </span>
    );
  }
  return 'Resource request';
}

// ── ActionRow + owner contact card ────────────────────────────────────────

/**
 * Renders the bottom row of every request. Wires:
 *   - The two CTAs the volunteer can fire (COLLECT, RETURN)
 *   - The owner-contact card (the privacy-gated reveal surface)
 *
 * The contact card is hidden unless status === COLLECTED — that's
 * the server's revealContacts gate. When status flips to COLLECTED
 * (after the volunteer clicks "I picked it up"), the page renders
 * `owner.name`, `owner.email`, `owner.phone`. Before that point the
 * server sends only `ownerSummary` (just a name + id) so we render
 * the summary-only line instead.
 */
function ActionRow({
  status,
  ownerSummary,
  ownerFull,
  resourceSummary,
  canCollect,
  canReturn,
  isTerminal,
  areaEmergencyActive,
  onCollect,
  onReturn,
  collectPending,
  returnPending,
}) {
  return (
    <div className="mt-3 space-y-3">
      {canCollect && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCollect}
            disabled={collectPending}
            className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {collectPending ? 'Marking…' : 'I picked it up'}
          </button>
          <p className="text-xs text-slate-500">
            Marking collected unlocks the owner's contact info so you can
            coordinate the handover.
          </p>
        </div>
      )}

      {canReturn && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReturn}
            disabled={returnPending}
            className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {returnPending ? 'Marking…' : "I've returned it"}
          </button>
          <p className="text-xs text-slate-500">
            The owner will confirm the return and re-list the resource.
          </p>
        </div>
      )}

      {isTerminal && (
        <p className="text-xs text-slate-500">
          This request is closed. No further actions are available.
        </p>
      )}

      {/* Owner contact card. Visible in two cases:
            1. status === COLLECTED (the standard COLLECTED gate — both
               parties can coordinate the handover)
            2. areaEmergencyActive === true (Module 6.3) — the
               volunteer's area matches the resource's area and that
               area has emergency mode active, so dispatch can happen
               quickly even before pickup.
          Before then we surface only the ownerSummary name (id + name,
          no contact info). The server enforces the same gate in
          `publicRequest()` — see request.controller.js. */}
      {((status === 'COLLECTED' || areaEmergencyActive) &&
        ownerFull &&
        (ownerFull.email || ownerFull.phone)) && (
        <OwnerContactCard
          owner={ownerFull}
          areaEmergencyActive={areaEmergencyActive}
        />
      )}
      {status !== 'COLLECTED' && !areaEmergencyActive && ownerSummary && (
        <p className="text-xs text-slate-500">
          Owner:{' '}
          <span className="font-medium text-slate-700">
            {ownerSummary.name || 'unknown'}
          </span>{' '}
          <span className="text-slate-400">(contact info hidden)</span>
        </p>
      )}
    </div>
  );
}

/**
 * The single privacy-gated surface in this entire module. The server
 * only includes `email` / `phone` on the response when the gate has
 * fired — either status === COLLECTED or (Module 6.3) the volunteer's
 * area is the same as the resource's area and that area is in
 * emergency mode. So rendering this card implies the gate already
 * fired. We render three rows:
 *
 *   - Name (display only)
 *   - Email (`mailto:` link, fall back to text if missing)
 *   - Phone (`tel:` link with a call glyph, fall back to text)
 *
 * We DO NOT render the volunteer's own contact info here. The
 * privacy gate is symmetric — when COLLECTED or in-area emergency,
 * both parties can see each other's info. The owner-facing surface
 * for that is Module 5.4, not this page.
 */
function OwnerContactCard({ owner, areaEmergencyActive }) {
  return (
    <div className="rounded-md border border-safe-300 bg-safe-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-safe-800">
        {areaEmergencyActive
          ? 'Owner contact (emergency mode in your area)'
          : 'Owner contact (revealed after collection)'}
      </p>
      <dl className="mt-2 space-y-1 text-sm text-safe-900">
        {owner.name && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Name
            </dt>
            <dd>{owner.name}</dd>
          </div>
        )}
        {owner.email && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Email
            </dt>
            <dd>
              <a
                href={`mailto:${owner.email}`}
                className="text-safe-800 underline hover:text-safe-900"
              >
                {owner.email}
              </a>
            </dd>
          </div>
        )}
        {owner.phone && (
          <div className="flex gap-2">
            <dt className="w-16 text-xs font-medium uppercase tracking-wide text-safe-700">
              Phone
            </dt>
            <dd>
              <a
                href={`tel:${owner.phone}`}
                className="inline-flex items-center gap-1.5 text-safe-800 underline hover:text-safe-900"
              >
                <span aria-hidden className="text-base leading-none">
                  {/* Call glyph — clicking the surrounding <a href="tel:…">
                      opens the platform dialer. The project has no icon
                      library installed, so we follow the existing
                      emoji + Tailwind text-size convention. */}
                  📞
                </span>
                <span>{owner.phone}</span>
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
      <span className="sr-only">Loading your requests…</span>
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
        You haven't made any requests yet.
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Browse the catalog and pick a resource — your active and past
        requests will appear here.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to="/resources"
          className="rounded-md bg-alert-700 px-3 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
        >
          Browse resources
        </Link>
        {hasFilter && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
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
      Owner contact info is only revealed after a request is approved
      and you've picked the resource up. This is a privacy safeguard —
      we don't want a stranger calling the owner without a confirmed
      pickup.
    </p>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}
