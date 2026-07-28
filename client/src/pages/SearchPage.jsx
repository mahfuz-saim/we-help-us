/**
 * SearchPage — Module 4.1 (Resource Search, List View).
 *
 * The discovery surface for any authenticated user. What this page does:
 *
 *   1. Renders a filter form (Category, Status, cascading Area, min
 *      Capacity, Distance from me, keyword). Filters live in URL
 *      search params so a search result is shareable and the back
 *      button works.
 *
 *   2. Calls GET /api/resources (the Module-3.2 list endpoint,
 *      extended in 4.1 with `minCapacity` and `lat/lng/radius`) via
 *      the `useResourceSearch` infinite query. "Load more" paginates.
 *
 *   3. Renders the result as a vertical stack of cards. Each card
 *      surfaces only PUBLIC fields from the Resource response
 *      (category, title, status, description, capacity, photos,
 *      location, areaId, timestamps) — ownerId / owner contact info
 *      is NEVER displayed (KEY DESIGN REMINDER: privacy boundary).
 *
 *   4. Computes "distance from me" client-side from the signed-in
 *      user's saved location + the resource's `location` via the
 *      haversine helper in utils/distance.js. The server doesn't
 *      pre-compute distance because `$geoWithin` (which the list
 *      endpoint uses) doesn't return a distance — and adding a
 *      separate aggregation would break skip/limit semantics.
 *
 *   5. Each card is wrapped in a `<Link to="/resources/:id">` so the
 *      user can drill into the full details page (Module 4.2). The
 *      details page exposes the photo gallery, full description, and
 *      a privacy-safe action row — owner contact info stays hidden
 *      until Module 5.2 (after APPROVED + COLLECTED).
 *
 * Role: any logged-in user (OWNER, VOLUNTEER, MODERATOR, ADMIN). The
 * route guard is the auth-only `ProtectedRoute` (no `roles` prop).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AreaCascadeFilter from '../components/AreaCascadeFilter';
import { useAuth } from '../context/AuthContext';
import { useResourceSearch } from '../hooks/useResourceSearch';
import {
  CATEGORY_META,
  getCategoryEmoji,
  getCategoryLabel,
} from '../utils/categories';
import { RESOURCE_STATUS } from '../utils/constants';
import { formatDistance, haversineMeters } from '../utils/distance';

// Status filter only shows the statuses the search experience exposes.
// RESERVED / IN_USE are intentionally absent: they're owned by the
// request lifecycle (Phase 5) and a public search shouldn't surface
// them as "available". An owner viewing their own resources still uses
// the dashboard (Module 3.5), not this page.
const STATUS_CHOICES = Object.freeze([
  { value: null, label: 'Any status' },
  { value: RESOURCE_STATUS.AVAILABLE.value, label: 'Available' },
  { value: RESOURCE_STATUS.UNAVAILABLE.value, label: 'Unavailable' },
]);

const DISTANCE_CHOICES = Object.freeze([
  { value: null, label: 'Any distance' },
  { value: 1, label: 'Within 1 km' },
  { value: 5, label: 'Within 5 km' },
  { value: 10, label: 'Within 10 km' },
  { value: 25, label: 'Within 25 km' },
  { value: 50, label: 'Within 50 km' },
  { value: 100, label: 'Within 100 km' },
]);

// Page size — drives the backend `limit`. The hook defaults to 12 too;
// we expose it as a constant so the UI copy ("showing N of M") lines
// up with what the server actually returned.
const PAGE_SIZE = 12;

// ── URL state ────────────────────────────────────────────────────────────
// Filter keys that we persist on the URL. Anything else is ephemeral.
const URL_KEYS = Object.freeze([
  'category',
  'status',
  'areaId',
  'minCapacity',
  'distanceKm',
  'q',
]);

export default function SearchPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  // Pull filter values out of the URL once. We re-derive on every
  // render so a back-button navigation doesn't need a reload.
  const filters = useMemo(
    () => ({
      category: searchParams.get('category') || null,
      status: searchParams.get('status') || null,
      areaId: searchParams.get('areaId') || null,
      minCapacity: searchParams.get('minCapacity') || '',
      distanceKm: searchParams.get('distanceKm') || '',
      q: searchParams.get('q') || '',
    }),
    [searchParams]
  );

  // Local "draft" state so the user can tweak a field without firing
  // a request on every keystroke. Pressing Apply (or Enter inside the
  // keyword input) commits the draft to the URL.
  const [draft, setDraft] = useState(() => filters);

  // Re-sync the draft when the URL changes (back/forward, or a fresh
  // share link landing on the page).
  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function applyFilters(next) {
    const sp = new URLSearchParams();
    for (const k of URL_KEYS) {
      const v = next[k];
      if (v === null || v === undefined || v === '') continue;
      sp.set(k, String(v));
    }
    setSearchParams(sp, { replace: true });
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  function handleSubmit(e) {
    e.preventDefault();
    applyFilters(draft);
  }

  // ── Query ────────────────────────────────────────────────────────────
  const search = useResourceSearch(filters, { user });
  const resources = useMemo(() => {
    if (!search.data) return [];
    return search.data.pages.flatMap((p) => p.resources || []);
  }, [search.data]);
  const total = search.data?.pages?.[0]?.pagination?.total ?? 0;

  const hasUserLocation = useMemo(() => {
    return (
      user &&
      user.location &&
      Array.isArray(user.location.coordinates) &&
      user.location.coordinates.length === 2
    );
  }, [user]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <Header
        user={user}
        hasUserLocation={Boolean(hasUserLocation)}
        total={total}
      />

      <div className="grid gap-6 lg:grid-cols-[18rem,1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <FiltersForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onClear={clearFilters}
            hasUserLocation={Boolean(hasUserLocation)}
          />
        </aside>

        <section>
          {search.isLoading && <LoadingState />}
          {search.error && <ErrorBanner message={search.error.message} />}
          {!search.isLoading && !search.error && resources.length === 0 && (
            <EmptyState hasFilters={hasAnyFilter(filters)} onClear={clearFilters} />
          )}
          {resources.length > 0 && (
            <>
              <ul className="grid gap-3">
                {resources.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    user={user}
                  />
                ))}
              </ul>
              <Pagination
                search={search}
                resourcesShown={resources.length}
                total={total}
                onRefresh={() =>
                  qc.invalidateQueries({ queryKey: ['resource-search'] })
                }
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({ user, hasUserLocation, total }) {
  return (
    <header className="space-y-1">
      <h1 className="text-xl font-semibold text-slate-900">Find resources</h1>
      <p className="text-sm text-slate-600">
        Browse what's available in your community. {total > 0 ? `${total} match your filters.` : ''}
      </p>
      {!hasUserLocation && (
        <p className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Add a saved location to your profile to enable the "distance from me"
          filter.
        </p>
      )}
    </header>
  );
}

// ── Filters form ────────────────────────────────────────────────────────

function FiltersForm({ draft, setDraft, onSubmit, onClear, hasUserLocation }) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div>
        <label
          htmlFor="f-q"
          className="block text-xs font-medium text-slate-600"
        >
          Keyword
        </label>
        <input
          id="f-q"
          type="search"
          value={draft.q}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
          placeholder="e.g. ambulance, generator"
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <div>
        <label
          htmlFor="f-category"
          className="block text-xs font-medium text-slate-600"
        >
          Category
        </label>
        <select
          id="f-category"
          value={draft.category || ''}
          onChange={(e) =>
            setDraft({ ...draft, category: e.target.value || null })
          }
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          <option value="">Any category</option>
          {CATEGORY_META.map((c) => (
            <option key={c.value} value={c.value}>
              {c.emoji} {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="f-status"
          className="block text-xs font-medium text-slate-600"
        >
          Availability
        </label>
        <select
          id="f-status"
          value={draft.status || ''}
          onChange={(e) =>
            setDraft({ ...draft, status: e.target.value || null })
          }
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          {STATUS_CHOICES.map((s) => (
            <option key={s.label} value={s.value || ''}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          Area (optional)
        </legend>
        <AreaCascadeFilter
          value={draft.areaId}
          onChange={(areaId) => setDraft({ ...draft, areaId })}
        />
      </fieldset>

      <div>
        <label
          htmlFor="f-min-capacity"
          className="block text-xs font-medium text-slate-600"
        >
          Minimum capacity
        </label>
        <input
          id="f-min-capacity"
          type="number"
          min={0}
          value={draft.minCapacity}
          onChange={(e) =>
            setDraft({ ...draft, minCapacity: e.target.value })
          }
          placeholder="e.g. 5 (people / units)"
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <div>
        <label
          htmlFor="f-distance"
          className="block text-xs font-medium text-slate-600"
        >
          Distance from me
        </label>
        <select
          id="f-distance"
          value={draft.distanceKm || ''}
          disabled={!hasUserLocation}
          onChange={(e) =>
            setDraft({ ...draft, distanceKm: e.target.value || '' })
          }
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {DISTANCE_CHOICES.map((d) => (
            <option key={d.label} value={d.value || ''}>
              {d.label}
            </option>
          ))}
        </select>
        {!hasUserLocation && (
          <p className="mt-1 text-xs text-slate-500">
            Add a saved location to use this filter.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="submit"
          className="flex-1 rounded-md bg-alert-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Clear
        </button>
      </div>
    </form>
  );
}

// ── Result card ─────────────────────────────────────────────────────────

function ResourceCard({ resource, user }) {
  const status = RESOURCE_STATUS[resource.status] || null;
  const distance = useMemo(() => {
    if (!user || !user.location || !resource.location) return null;
    if (!Array.isArray(resource.location.coordinates)) return null;
    return haversineMeters(
      user.location.coordinates,
      resource.location.coordinates
    );
  }, [user, resource.location]);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
      <Link
        to={`/resources/${resource.id}`}
        className="flex flex-wrap items-start gap-3"
        aria-label={`Open details for ${resource.title || 'resource'}`}
      >
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
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{getCategoryLabel(resource.category)}</span>
            {typeof resource.capacity === 'number' && (
              <>
                <span aria-hidden>·</span>
                <span>capacity {resource.capacity}</span>
              </>
            )}
            {distance != null && (
              <>
                <span aria-hidden>·</span>
                <span>{formatDistance(distance)} away</span>
              </>
            )}
            {resource.updatedAt && (
              <>
                <span aria-hidden>·</span>
                <span>updated {formatDate(resource.updatedAt)}</span>
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
      </Link>
    </li>
  );
}

function StatusBadge({ status }) {
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

// ── Pagination / load-more ──────────────────────────────────────────────

function Pagination({ search, resourcesShown, total, onRefresh }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <p>
        Showing {resourcesShown} of {total} resource{total === 1 ? '' : 's'}.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={search.isFetching}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {search.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        {search.hasNextPage && (
          <button
            type="button"
            onClick={() => search.fetchNextPage()}
            disabled={search.isFetchingNextPage}
            className="rounded-md bg-alert-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {search.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Empty / loading / error ─────────────────────────────────────────────

function EmptyState({ hasFilters, onClear }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">
        {hasFilters ? 'No resources match your filters' : 'No resources yet'}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {hasFilters
          ? 'Try widening the area or removing the keyword / capacity filter.'
          : 'Check back later — community resources appear here as owners register them.'}
      </p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Clear filters
        </button>
      )}
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
      {message || 'Could not load resources.'}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

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

function hasAnyFilter(filters) {
  return URL_KEYS.some((k) => {
    const v = filters[k];
    return v !== null && v !== undefined && v !== '';
  });
}