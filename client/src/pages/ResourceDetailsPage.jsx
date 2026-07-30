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
 *   2. Description — full text, full width.
 *   3. Two-column grid (md+):
 *        - LEFT  → DetailsGrid (category, capacity, condition, status,
 *                  area, distance, listed date, owner hint) +
 *                  ActionRow (role-aware CTA).
 *        - RIGHT → PhotoGallery. When the resource has uploaded photos
 *                  the gallery shows them with thumbnails + click-to-
 *                  enlarge; when no photos exist it falls back to a
 *                  per-category default image generated inline by
 *                  `getCategoryPlaceholderImage()`.
 *
 * 4. Action row — primary CTA:
 *      - VOLUNTEER (verified): "Request this resource" — calls
 *        POST /api/requests (Module 5.2). Disabled with a friendly
 *        message when the resource is not AVAILABLE.
 *      - VOLUNTEER (unverified): a "Go to profile" prompt — the
 *        server gates create-request on isVerified so we mirror it
 *        here rather than letting the user see a 403 on click.
 *      - OWNER who owns the resource: "Open dashboard" link to
 *        /owner/resources.
 *      - MODERATOR / ADMIN: a neutral "no actions for your role"
 *        card.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The server's `publicResource()` strips owner contact info
 *     before the response leaves — we get `ownerId` only.
 *   - This page never tries to render `owner.email`, `owner.phone`,
 *     `owner.name`, or `resource.owner`. The smoke test asserts that
 *     statically (see `client/smoke-tests/4.2-resource-details.test.cjs`).
 *   - The "Request" CTA sends ONLY the resource id; contact reveal
 *     happens server-side after APPROVED + COLLECTED (per the
 *     KEY DESIGN REMINDER "Privacy: NEVER expose owner contact until
 *     request is APPROVED + COLLECTED"). The mutation's success
 *     response here also does not include contact info — the
 *     volunteer sees a "Request sent" card pointing them to
 *     /volunteer/requests.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import '../utils/leaflet-icons';

import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { useAreaChain } from '../hooks/useAreas';
import { useCreateRequest } from '../hooks/useMyRequests';
import {
  getCategoryEmoji,
  getCategoryLabel,
  getCategoryPlaceholderImage,
} from '../utils/categories';
import { RESOURCE_STATUS } from '../utils/constants';
import { formatDistance, haversineMeters } from '../utils/distance';
import { extractFormError } from '../utils/formErrors';

const SEARCH_RESULT_ZOOM = 16;

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

  // Photo / map view toggle. Defaults to photo. Auto-resets to
  // 'photo' if the resource has no location so the toggle can't get
  // stuck in an empty-map state.
  const hasLocation =
    !!resource &&
    !!resource.location &&
    Array.isArray(resource.location.coordinates) &&
    resource.location.coordinates.length === 2 &&
    Number.isFinite(resource.location.coordinates[0]) &&
    Number.isFinite(resource.location.coordinates[1]);
  const [viewMode, setViewMode] = useState('photo');
  useEffect(() => {
    if (!hasLocation && viewMode === 'map') {
      setViewMode('photo');
    }
  }, [hasLocation, viewMode]);

  // Full address chain (district > upazila > union > ...). Fetches
  // from GET /api/areas/:id via the existing useAreaChain hook.
  const areaChainQuery = useAreaChain({
    areaId: (resource && resource.areaId) || null,
    enabled: Boolean(resource && resource.areaId),
  });
  const areaChainLabel = useMemo(() => {
    const data = areaChainQuery.data;
    if (!data || !Array.isArray(data.chain) || data.chain.length === 0) {
      return null;
    }
    return data.chain
      .map((n) => (n && n.name ? String(n.name) : null))
      .filter(Boolean)
      .join(' › ')
      || null;
  }, [areaChainQuery.data]);

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
          <Description text={resource.description} />

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <DetailsGrid
                resource={resource}
                distance={distance}
                areaChainLabel={areaChainLabel}
                areaChainLoading={areaChainQuery.isLoading}
              />
              <ActionRow resource={resource} user={user} />
            </div>
            <div>
              {hasLocation && (
                <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-sm">
                  <button
                    type="button"
                    onClick={() => setViewMode('photo')}
                    aria-pressed={viewMode === 'photo'}
                    className={
                      'flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors ' +
                      (viewMode === 'photo'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100')
                    }
                  >
                    Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('map')}
                    aria-pressed={viewMode === 'map'}
                    className={
                      'flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors ' +
                      (viewMode === 'map'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100')
                    }
                  >
                    Show on map
                  </button>
                </div>
              )}
              {viewMode === 'map' && hasLocation ? (
                <ResourceMapPin resource={resource} />
              ) : (
                <PhotoGallery
                  photos={resource.photos || []}
                  title={resource.title}
                  category={resource.category}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Read-only map surface for a single resource — shows the location
 * coordinate pinned on the standard OSM tile layer. Modeled after
 * `AreaSelector`'s read-only branch so the project keeps a single
 * map style.
 */
function ResourceMapPin({ resource }) {
  const [lng, lat] = resource.location.coordinates;
  return (
    <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <MapContainer
        center={[lat, lng]}
        zoom={SEARCH_RESULT_ZOOM}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={[lat, lng]}
          draggable={false}
          eventHandlers={{ click: () => {} }}
        />
      </MapContainer>
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

function PhotoGallery({ photos, title, category }) {
  const list = Array.isArray(photos) ? photos : [];
  const [active, setActive] = useState(0);

  // Reset active index if the photo list shrinks under us.
  useEffect(() => {
    if (active > list.length - 1) setActive(0);
  }, [list.length, active]);

  if (list.length === 0) {
    return (
      <img
        src={getCategoryPlaceholderImage(category, { label: title })}
        alt={title ? `${title} placeholder` : 'Resource placeholder'}
        className="aspect-[4/3] w-full rounded-lg border border-slate-200 bg-white object-contain shadow-sm"
      />
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

function DetailsGrid({ resource, distance, areaChainLabel, areaChainLoading }) {
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
    // Render the full hierarchy ("district › upazila › union") when
    // the chain is available, the leaf name while the chain is still
    // loading, the hex hint as a last resort fallback.
    let areaValue;
    if (areaChainLabel) {
      areaValue = areaChainLabel;
    } else if (areaChainLoading && resource.areaName) {
      areaValue = resource.areaName;
    } else {
      areaValue = (
        <span className="font-mono text-xs">{(resource.areaId || '').slice(0, 8)}…</span>
      );
    }
    rows.push({
      label: 'Address',
      value: areaValue,
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
  // The ownerId is shown by NAME on the public details page (it's
  // already a registered user; the resource itself is browseable).
  // Contact info (email/phone) NEVER appears here — Module 5.2
  // reveals the owner's contact info AFTER a request reaches
  // APPROVED + COLLECTED. Fall back to the hex hint when the name is
  // missing (older server versions).
  if (resource.ownerId) {
    rows.push({
      label: 'Registered by',
      value: resource.ownerName
        ? resource.ownerName
        : (
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
    return <VolunteerRequestCTA resource={resource} user={user} />;
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
          className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
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

function VolunteerRequestCTA({ resource, user }) {
  // Module 5.2 wires the request lifecycle end-to-end — POST /api/requests
  // exists server-side, plus approve / reject / collect / return / complete
  // endpoints. The volunteer can create a request directly from this page
  // as soon as they hit "Request this resource". Server-side gates:
  //   - role === VOLUNTEER (server enforces)
  //   - user.isVerified === true (server enforces — KEY DESIGN REMINDER)
  //   - resource.status === AVAILABLE
  //   - volunteer is not the resource's owner
  //   - no open request already exists for (volunteer, resource)
  // We mirror the volunteer + verified gates on the client so the
  // button is disabled up front with an honest message; the server's
  // 403/409 still acts as the source of truth.
  const navigate = useNavigate();
  const create = useCreateRequest();
  const [errorMessage, setErrorMessage] = useState(null);

  const isVerified = user?.isVerified === true;
  const isAvailable =
    (resource.status || '').toUpperCase() === 'AVAILABLE';
  const created = !!create.data;

  // If the user lands on the page after the owner flips the resource
  // away from AVAILABLE, the server would 409 — surface that locally
  // instead of letting the request fire.
  const disabledReason = !isVerified
    ? 'You need to be a verified volunteer to request resources.'
    : !isAvailable
      ? 'This resource is not currently available for new requests.'
      : null;

  // Unverified branch — short-circuit with a clear pointer to the
  // profile page (Module 6.2 explains what verification means).
  if (!isVerified) {
    return (
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Need this resource?
        </h2>
        <p className="text-sm text-slate-600">
          Only verified volunteers can request resources. Verification
          keeps the request flow trusted — see your profile for
          what's needed.
        </p>
        <Link
          to="/profile"
          className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
        >
          Go to profile
        </Link>
      </div>
    );
  }

  function handleRequest() {
    setErrorMessage(null);
    create.mutate(
      { resourceId: resource.id },
      {
        onError: (err) => {
          const { topMessage } = extractFormError(err);
          setErrorMessage(
            topMessage ||
              'Could not send your request. Please try again in a moment.'
          );
        },
      }
    );
  }

  if (created) {
    return (
      <div className="space-y-2 rounded-lg border border-safe-300 bg-safe-50 p-4 shadow-sm">
        <h2 className="text-base font-semibold text-safe-800">
          Request sent
        </h2>
        <p className="text-sm text-safe-800">
          The owner has been notified. You'll see updates on your{' '}
          <span className="font-medium">My Requests</span> dashboard —
          contact details are revealed only after the owner approves
          and you collect the resource.
        </p>
        <button
          type="button"
          onClick={() => navigate('/volunteer/requests')}
          className="inline-flex w-full justify-center rounded-md bg-safe-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-safe-800 min-h-[44px]"
        >
          View my requests
        </button>
      </div>
    );
  }

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
        onClick={handleRequest}
        disabled={create.isPending || !!disabledReason}
        title={disabledReason || undefined}
        className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
      >
        {create.isPending ? 'Sending request…' : 'Request this resource'}
      </button>
      {disabledReason && (
        <p className="text-xs text-slate-500">{disabledReason}</p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="rounded-md border border-alert-200 bg-alert-50 px-3 py-2 text-xs text-alert-800"
        >
          {errorMessage}
        </p>
      )}
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