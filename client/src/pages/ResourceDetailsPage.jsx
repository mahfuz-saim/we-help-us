/**
 * ResourceDetailsPage — Module 4.2 (Resource Details Page).
 *
 * The drill-down surface for a single resource. Reached from the
 * search list (Module 4.1, which now wraps cards in `<Link>`) and
 * from any future deep link sharing a resource URL.
 *
 * Layout:
 *   1. Header — back link to /resources, category emoji + title +
 *      StatusBadge + last updated.
 *   2. Photo gallery — main photo + thumbnails, lightbox-style "click
 *      to enlarge" via a simple full-image overlay (we don't pull in
 *      a modal library — a `<dialog>` element is enough).
 *   3. Details grid — category, capacity, condition, status,
 *      approximate area (areaId hex — Module 4.3 will resolve it),
 *      distance from the signed-in user (only when both user.location
 *      and resource.location exist), last updated, ownerId (shown as
 *      a short hex hint so the viewer sees that the resource is
 *      registered — but never reveals contact info).
 *   4. Description — full text, no line-clamp.
 *   5. Action row — primary CTA:
 *        - VOLUNTEER: "Request this resource" (Module 5.2 wires the
 *          request lifecycle; for 4.2 the button is rendered but
 *          disabled with a copy explaining the request flow ships
 *          in Phase 5 — see SPEC note below).
 *        - OWNER who owns the resource: "Edit on dashboard" (links
 *          to /owner/resources?edit=<id>) — the dashboard's edit
 *          surface lands in a follow-up module too, so for 4.2 the
 *          link is rendered but its target is the dashboard list.
 *        - Everyone else (including unauthenticated — though the
 *          route guard already redirects): "Browse more resources"
 *          link back to /resources.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The server's `publicResource()` strips owner contact info
 *     before the response leaves — we get `ownerId` only.
 *   - This page never tries to render `owner.email`, `owner.phone`,
 *     `owner.name`, or `resource.owner`. The smoke test asserts that
 *     statically (see `client/smoke-tests/4.2-resource-details.test.cjs`).
 *   - The "Request" CTA is volunteer-only and stays disabled until
 *     Module 5.2 — when it lands, the user will be able to send a
 *     real request and the server will reveal contact info ONLY
 *     after APPROVED + COLLECTED (per the KEY DESIGN REMINDER
 *     "Privacy: NEVER expose owner contact until request is
 *     APPROVED + COLLECTED").
 *
 * Why the Request button ships disabled:
 *   We could ship a live button that POSTs to /api/requests, but
 *   that endpoint doesn't exist yet. A live button that returns a
 *   404 from the future endpoint would mislead the user. A disabled
 *   button with a clear "Request flow ships in Phase 5" caption sets
 *   the right expectation and is the same pattern Module 1.4 used for
 *   the avatar upload 503 path (a clear "this isn't wired yet" UI).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import {
  getCategoryEmoji,
  getCategoryLabel,
} from '../utils/categories';
import { RESOURCE_STATUS } from '../utils/constants';
import { formatDistance, haversineMeters } from '../utils/distance';

export default function ResourceDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const query = useResource(id);

  // 404 navigation: if the server reports 404, kick the user back
  // to the search list. We do this in an effect so the API call's
  // promise resolves first.
  useEffect(() => {
    if (query.error && query.error.status === 404) {
      navigate('/resources', { replace: true });
    }
  }, [query.error, navigate]);

  const resource = query.data;

  // Distance from the signed-in user, if both locations exist.
  const distance = useMemo(() => {
    if (!user || !user.location || !resource || !resource.location) return null;
    if (!Array.isArray(resource.location.coordinates)) return null;
    return haversineMeters(
      user.location.coordinates,
      resource.location.coordinates
    );
  }, [user, resource]);

  return (
    <div className="space-y-6">
      <BackBar />

      {query.isLoading && <LoadingState />}
      {query.error && query.error.status !== 404 && (
        <ErrorBanner message={query.error.message} />
      )}
      {resource && (
        <>
          <Header resource={resource} />
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-6">
              <PhotoGallery photos={resource.photos || []} title={resource.title} />
              <Description text={resource.description} />
            </div>
            <aside className="space-y-6">
              <DetailsGrid
                resource={resource}
                distance={distance}
              />
              <ActionRow
                resource={resource}
                user={user}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// ── Back bar ──────────────────────────────────────────────────────────────

function BackBar() {
  return (
    <div>
      <Link
        to="/resources"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <span aria-hidden>←</span>
        <span>Back to resources</span>
      </Link>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────

function Header({ resource }) {
  const status = RESOURCE_STATUS[resource.status] || null;
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="text-3xl leading-none"
          aria-hidden
          title={getCategoryLabel(resource.category)}
        >
          {getCategoryEmoji(resource.category)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {resource.title || 'Untitled resource'}
            </h1>
            {status && <StatusBadge status={status} />}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {getCategoryLabel(resource.category)}
            {resource.updatedAt && (
              <>
                <span aria-hidden> · </span>
                <span>updated {formatDate(resource.updatedAt)}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </header>
  );
}

function StatusBadge({ status }) {
  const styleMap = {
    safe: 'bg-safe-100 text-safe-800 ring-1 ring-safe-300',
    caution: 'bg-caution-100 text-caution-800 ring-1 ring-caution-300',
    alert: 'bg-alert-100 text-alert-800 ring-1 ring-alert-300',
  };
  const className =
    styleMap[status.color] ||
    'bg-slate-100 text-slate-700 ring-1 ring-slate-300';
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ' +
        className
      }
    >
      {status.label}
    </span>
  );
}

// ── Photo gallery ────────────────────────────────────────────────────────

function PhotoGallery({ photos, title }) {
  const list = Array.isArray(photos) ? photos : [];
  const [active, setActive] = useState(0);

  // Reset active index if the photo list shrinks under us.
  useEffect(() => {
    if (active > list.length - 1) setActive(0);
  }, [list.length, active]);

  if (list.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        No photos uploaded
      </div>
    );
  }

  const current = list[Math.max(0, Math.min(active, list.length - 1))];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setActive(Math.max(0, Math.min(active, list.length - 1)))}
        className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        aria-label={`Photo ${active + 1} of ${list.length}`}
      >
        <img
          src={current.url}
          alt={title ? `${title} — photo ${active + 1}` : `Photo ${active + 1}`}
          className="aspect-[4/3] w-full object-cover"
        />
      </button>
      {list.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {list.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === active ? 'true' : undefined}
                className={
                  'overflow-hidden rounded-md border-2 ' +
                  (i === active
                    ? 'border-alert-700'
                    : 'border-transparent hover:border-slate-300')
                }
              >
                <img
                  src={p.url}
                  alt=""
                  className="h-16 w-16 object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Description ──────────────────────────────────────────────────────────

function Description({ text }) {
  if (!text) return null;
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-900">Description</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {text}
      </p>
    </section>
  );
}

// ── Details grid ─────────────────────────────────────────────────────────

function DetailsGrid({ resource, distance }) {
  const rows = [];
  rows.push({
    label: 'Category',
    value: (
      <span>
        <span aria-hidden>{getCategoryEmoji(resource.category)}</span>{' '}
        {getCategoryLabel(resource.category)}
      </span>
    ),
  });
  if (typeof resource.capacity === 'number') {
    rows.push({
      label: 'Capacity',
      value: `${resource.capacity}`,
    });
  }
  if (resource.condition) {
    rows.push({
      label: 'Condition',
      value: conditionLabel(resource.condition),
    });
  }
  rows.push({
    label: 'Status',
    value: (RESOURCE_STATUS[resource.status] || {}).label || resource.status,
  });
  if (resource.areaId) {
    rows.push({
      label: 'Area',
      // The 4.2 page intentionally surfaces the areaId hex truncated;
      // Module 4.3 (map view) will resolve the area label via the
      // cascading Area hook. Showing the hex keeps the page honest
      // about which admin node the owner picked.
      value: <span className="font-mono text-xs">{(resource.areaId || '').slice(0, 8)}…</span>,
    });
  }
  if (distance != null) {
    rows.push({
      label: 'Distance',
      value: `${formatDistance(distance)} away`,
    });
  }
  if (resource.createdAt) {
    rows.push({
      label: 'Listed',
      value: formatDate(resource.createdAt),
    });
  }
  // The ownerId is a server-side opaque id — we show a short hex hint
  // so the viewer can see "this resource is registered" but contact
  // info NEVER appears here. Module 5.2 reveals the owner's contact
  // info AFTER a request reaches APPROVED + COLLECTED.
  if (resource.ownerId) {
    rows.push({
      label: 'Registered by',
      value: (
        <span className="font-mono text-xs text-slate-500">
          user {(resource.ownerId || '').slice(0, 8)}…
        </span>
      ),
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Details</h2>
      <dl className="mt-3 divide-y divide-slate-100">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[7rem,1fr]"
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {row.label}
            </dt>
            <dd className="text-sm text-slate-800">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function conditionLabel(c) {
  switch (c) {
    case 'NEW':
      return 'New — unused';
    case 'GOOD':
      return 'Good — works as expected';
    case 'FAIR':
      return 'Fair — usable with minor wear';
    case 'NEEDS_REPAIR':
      return 'Needs repair — fixable';
    default:
      return c;
  }
}

// ── Action row ───────────────────────────────────────────────────────────

function ActionRow({ resource, user }) {
  // The page is auth-only, but if AuthContext hasn't resolved yet
  // we render a neutral placeholder rather than nothing.
  if (!user) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
        Loading…
      </div>
    );
  }

  const isVolunteer = user.role === 'VOLUNTEER';
  const isOwner =
    user.role === 'OWNER' && resource.ownerId === user.id;

  if (isVolunteer) {
    return <VolunteerRequestCTA />;
  }
  if (isOwner) {
    return (
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          You registered this resource
        </h2>
        <p className="text-sm text-slate-600">
          Manage it from your owner dashboard.
        </p>
        <Link
          to={`/owner/resources`}
          className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800"
        >
          Open dashboard
        </Link>
      </div>
    );
  }

  // MODERATOR / ADMIN — no request flow, but they have access to the
  // resource so we show a neutral note.
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">No actions for your role</h2>
      <p className="mt-1 text-sm">
        Requesting a resource is for volunteers. Moderators can manage
        requests from the moderator dashboard.
      </p>
    </div>
  );
}

function VolunteerRequestCTA() {
  // Phase 5 wires the request lifecycle (Module 5.2 — POST /api/requests,
  // approval/rejection flow). Until then the button is disabled so
  // users see the affordance without a misleading click that goes
  // nowhere. This matches the 1.4 avatar-upload 503 pattern: be
  // honest about what the UI can do today.
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">
        Need this resource?
      </h2>
      <p className="text-sm text-slate-600">
        Volunteers request resources through a brief workflow — the
        owner approves, you collect, and contact details are revealed
        after approval.
      </p>
      <button
        type="button"
        disabled
        title="Request workflow ships in Phase 5"
        className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2 text-sm font-semibold text-white opacity-60 shadow-sm"
      >
        Request this resource
      </button>
      <p className="text-xs text-slate-500">
        Request workflow ships in Phase 5 (Module 5.2). The button is
        here so you can see what's coming — it'll go live once the
        reservation APIs land.
      </p>
    </div>
  );
}

// ── Empty / loading / error ──────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-4"
    >
      <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
      <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-alert-200 bg-alert-50 p-3 text-sm text-alert-800"
    >
      {message || 'Could not load this resource.'}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

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