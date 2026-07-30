/**
 * MapViewPage — Module 4.3 (Interactive Map View).
 *
 * Read-only Leaflet map that plots every registered resource as a
 * color-coded DivIcon (Module 3.3's `getCategoryIcon(category, status)`
 * factory). Each marker has a popup with title + status badge + an
 * "Open details" link to /resources/:id (Module 4.2).
 *
 * Why a separate hook (useMapResources) instead of useResourceSearch:
 *   The map needs to render EVERY resource that has a location, not
 *   just the first page of search results. Pagination + filter scoping
 *   are fine for the list view, but the map view needs a single
 *   bulk GET. The server already exposes GET /api/resources with the
 *   same shape — we just lift the page limit by passing a big `limit`.
 *   The same hook also forwards `lat`/`lng`/`radius` when a search
 *   location is active so the server's `$geoWithin` filter narrows
 *   the result set to nearby resources.
 *
 * Status color-coding (Module 4.3 spec — "green/yellow/red/black"):
 *   AVAILABLE    → safe    (green)
 *   RESERVED     → caution (yellow)
 *   IN_USE       → caution (yellow/orange)
 *   UNAVAILABLE  → alert   (red) + slight desaturation
 *
 * Filter integration:
 *   - Category chips + status chips at the top, mirror the list
 *     page's filter surface (Module 4.1's URL-driven pattern).
 *   - A "Search location" section just below the FilterBar uses the
 *     same `useNominatimSearch` hook the profile page's AreaSelector
 *     uses. Picking a result writes `place`, `lat`, `lng`, `radius`
 *     to the URL; the map flies to the lat/lng and only nearby
 *     resources are plotted.
 *   - All filters live in URL search params so a deep link to a
 *     pre-filtered map works and the back-button is sane.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - The popup renders title + category + status badge + "Open
 *     details" link. It NEVER renders ownerId, owner email, owner
 *     phone, or owner name. The details page is the only place
 *     owner-related fields surface (and even there, contact info
 *     stays hidden until Module 5.2).
 *   - The smoke test asserts this statically.
 *
 * Geospatial:
 *   - Markers only render for resources with a valid `location`.
 *     When a search location is active, the server already filters
 *     to within `radius` meters of the chosen lat/lng; when there
 *     is no search location, the MapFitter fits bounds to whatever
 *     plotted markers exist.
 *   - The map auto-fits bounds to whatever is on screen; if there
 *     are zero plottable resources it falls back to DEFAULT_MAP_CENTER.
 *
 * Note on the route layout:
 *   - Path is /resources/map, sibling to /resources/:id. React Router
 *     v7's matcher is order-insensitive for sibling Routes — but to
 *     keep the matcher unambiguous we register /resources/map BEFORE
 *     /resources/:id in App.jsx so the literal "map" segment wins.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap, ZoomControl } from 'react-leaflet';

import '../utils/leaflet-icons';
import {
  CATEGORY_META,
  getCategoryEmoji,
  getCategoryIcon,
  getCategoryLabel,
} from '../utils/categories';
import { RESOURCE_STATUS } from '../utils/constants';
import { useMapResources } from '../hooks/useMapResources';
import { useNominatimSearch } from '../hooks/useNominatimSearch';

// Radius choices (km) shown in the location-search <select>. The values
// stay well under the server's 100 km cap (useMapResources).
const RADIUS_OPTIONS_KM = Object.freeze([1, 2, 5, 10, 25, 50]);
const DEFAULT_RADIUS_KM = 5;

// URL params this page persists across reloads:
//   - `category`, `status` — list-side filters from FilterBar.
//   - `place`              — human-readable label for the active location.
//   - `lat`, `lng`, `radius` — coordinates + km radius; the source of
//     truth for whether a search location is active. `place` is purely
//     cosmetic; the coordinates alone drive the API filter and the
//     map's fitBounds.

// Page size for the bulk fetch — bumped well above the search page's
// 12 so the map shows as many pins as possible without pagination.
const MAP_LIMIT = 200;

// Filter chip sets — narrower than the search page's full set so the
// map's filter UI stays compact. Status choices mirror RESOURCE_STATUS;
// category choices mirror CATEGORY_META.
const CATEGORY_CHOICES = Object.freeze([
  { value: null, label: 'Any category' },
  ...CATEGORY_META.map((c) => ({
    value: c.value,
    label: `${c.emoji} ${c.label}`,
  })),
]);

const STATUS_CHOICES = Object.freeze([
  { value: null, label: 'Any status' },
  { value: RESOURCE_STATUS.AVAILABLE.value, label: 'Available' },
  { value: RESOURCE_STATUS.RESERVED.value, label: 'Reserved' },
  { value: RESOURCE_STATUS.IN_USE.value, label: 'In Use' },
  { value: RESOURCE_STATUS.UNAVAILABLE.value, label: 'Unavailable' },
]);

export default function MapViewPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters for the API call. category/status stay simple.
  const filters = useMemo(
    () => ({
      category: searchParams.get('category') || null,
      status: searchParams.get('status') || null,
    }),
    [searchParams]
  );

  // Active search location, derived from the URL. Coordinates are the
  // source of truth — `place` is purely cosmetic display text.
  const location = useMemo(() => {
    const lat = Number(searchParams.get('lat'));
    const lng = Number(searchParams.get('lng'));
    const radius = Number(searchParams.get('radius'));
    const place = searchParams.get('place') || '';
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Number.isFinite(radius) &&
      radius > 0
    ) {
      return { lat, lng, radius, place };
    }
    return null;
  }, [searchParams]);

  const [draft, setDraft] = useState(() => filters);
  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Local mirror of the URL-based location text so the input can be
  // edited freely without resetting the active selection. Mirrors
  // AreaSelector's pattern: typing does NOT change the active place
  // until the user picks a result.
  const [placeInput, setPlaceInput] = useState(location ? location.place : '');
  useEffect(() => {
    setPlaceInput(location ? location.place : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function applyFilters(next) {
    const sp = new URLSearchParams(searchParams);
    // Update only the category/status keys (preserve any location keys).
    sp.delete('category');
    sp.delete('status');
    if (next.category) sp.set('category', String(next.category));
    if (next.status) sp.set('status', String(next.status));
    setSearchParams(sp, { replace: true });
  }

  function clearFilters() {
    // Category/status only — leave any active search location intact.
    const sp = new URLSearchParams(searchParams);
    sp.delete('category');
    sp.delete('status');
    setSearchParams(sp, { replace: true });
  }

  function pickLocationResult(result) {
    const lat = Number(result.lat);
    const lng = Number(result.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const sp = new URLSearchParams(searchParams);
    sp.set('place', result.displayName || '');
    sp.set('lat', String(lat));
    sp.set('lng', String(lng));
    if (!sp.get('radius')) sp.set('radius', String(DEFAULT_RADIUS_KM));
    setSearchParams(sp, { replace: true });
    setPlaceInput(result.displayName || '');
  }

  function changeRadius(km) {
    if (!location) return;
    const sp = new URLSearchParams(searchParams);
    sp.set('radius', String(km));
    setSearchParams(sp, { replace: true });
  }

  function clearLocation() {
    const sp = new URLSearchParams(searchParams);
    sp.delete('place');
    sp.delete('lat');
    sp.delete('lng');
    sp.delete('radius');
    setSearchParams(sp, { replace: true });
    setPlaceInput('');
  }

  const query = useMapResources(filters, location);

  const resources = useMemo(() => {
    if (!query.data) return [];
    return (query.data.resources || []).filter((r) => {
      // Server returns only geo-located resources when lat/lng/radius
      // is supplied; without a user-location filter we get all of
      // them and have to drop the unlocated ones client-side.
      if (!r.location) return false;
      if (!Array.isArray(r.location.coordinates)) return false;
      const [lng, lat] = r.location.coordinates;
      return Number.isFinite(lng) && Number.isFinite(lat);
    });
  }, [query.data]);

  const hasLocation = Boolean(location);

  return (
    <div className="space-y-4">
      <Header total={resources.length} hasLocation={hasLocation} />

      <FilterBar
        draft={draft}
        setDraft={setDraft}
        onApply={() => applyFilters(draft)}
        onClear={clearFilters}
        isFetching={query.isFetching}
      />

      <LocationSearch
        placeInput={placeInput}
        onPlaceInputChange={setPlaceInput}
        onPick={pickLocationResult}
        onClear={clearLocation}
        radius={location ? location.radius : DEFAULT_RADIUS_KM}
        onRadiusChange={changeRadius}
        hasLocation={hasLocation}
      />

      {query.isLoading && <LoadingState />}
      {query.error && <ErrorBanner message={query.error.message} />}
      {!query.isLoading && !query.error && resources.length === 0 && (
        <EmptyState
          hasLocation={hasLocation}
          place={location ? location.place : ''}
          radius={location ? location.radius : null}
          onClearFilters={clearFilters}
          onClearLocation={clearLocation}
        />
      )}
      {resources.length > 0 && (
        <ResourceMap resources={resources} location={location} />
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────

function Header({ total, hasLocation }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Resources on the map
        </h1>
        <p className="text-sm text-slate-600">
          {total > 0
            ? `${total} resource${total === 1 ? '' : 's'} plotted.`
            : hasLocation
            ? 'No resources within the searched area.'
            : 'No resources to plot yet.'}
        </p>
      </div>
      <Link
        to="/resources"
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        ← Back to list view
      </Link>
    </header>
  );
}

// ── Filter chips ─────────────────────────────────────────────────────────

function FilterBar({ draft, setDraft, onApply, onClear, isFetching }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="min-w-[10rem] flex-1">
        <label
          htmlFor="map-category"
          className="block text-xs font-medium text-slate-600"
        >
          Category
        </label>
        <select
          id="map-category"
          value={draft.category || ''}
          onChange={(e) =>
            setDraft({ ...draft, category: e.target.value || null })
          }
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        >
          {CATEGORY_CHOICES.map((c) => (
            <option key={c.label} value={c.value || ''}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[10rem] flex-1">
        <label
          htmlFor="map-status"
          className="block text-xs font-medium text-slate-600"
        >
          Status
        </label>
        <select
          id="map-status"
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

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 min-h-[44px]"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
        >
          Clear
        </button>
        {isFetching && (
          <span
            className="self-center text-xs text-slate-500"
            aria-live="polite"
          >
            Refreshing…
          </span>
        )}
      </div>
    </form>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────

function ResourceMap({ resources, location }) {
  // Auto-fit bounds whenever the resource list changes. The MapFitter
  // child reads the bounds via useMap() and runs fitBounds once.
  return (
    <div className="relative">
      <MapContainer
        className="whu-map"
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFitter resources={resources} location={location} />
        {/* Module 9.1 — move the zoom control to the bottom-right so it
            doesn't collide with the legend on small viewports. The
            .whu-zoom-* CSS in index.css forces both buttons to the
            44×44 iOS tap-target size. */}
        <ZoomControl position="bottomright" />
        <Legend />
        {resources.map((r) => (
          <ResourceMarker key={r.id} resource={r} />
        ))}
      </MapContainer>
    </div>
  );
}

function MapFitter({ resources, location }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    // 1. Active search location wins: fly to the lat/lng and fit the
    //    radius bounds so the whole search area is visible.
    if (
      location &&
      Number.isFinite(location.lat) &&
      Number.isFinite(location.lng) &&
      Number.isFinite(location.radius)
    ) {
      try {
        const center = L.latLng(location.lat, location.lng);
        const bounds = center.toBounds(location.radius * 1000); // km → m
        map.flyToBounds(bounds, {
          padding: [40, 40],
          maxZoom: 14,
          duration: 0.6,
        });
      } catch {
        /* map not ready — ignore */
      }
      return;
    }

    // 2. No active location — fit to whatever markers are plotted.
    if (!Array.isArray(resources) || resources.length === 0) return;
    const bounds = resources
      .map((r) => {
        if (!r.location || !Array.isArray(r.location.coordinates)) return null;
        const [lng, lat] = r.location.coordinates;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return [lat, lng];
      })
      .filter(Boolean);
    if (bounds.length === 0) return;
    try {
      if (bounds.length === 1) {
        map.setView(bounds[0], Math.max(map.getZoom(), 13));
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    } catch {
      /* map not ready — ignore */
    }
  }, [resources, location, map]);
  return null;
}

function ResourceMarker({ resource }) {
  const [lng, lat] = resource.location.coordinates;
  const icon = useMemo(
    () => getCategoryIcon(resource.category, resource.status),
    [resource.category, resource.status]
  );
  const status = RESOURCE_STATUS[resource.status] || null;
  return (
    <Marker position={[lat, lng]} icon={icon}>
      <Popup>
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <span aria-hidden className="text-xl leading-none">
              {getCategoryEmoji(resource.category)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">
                {resource.title || 'Untitled resource'}
              </p>
              <p className="text-xs text-slate-600">
                {getCategoryLabel(resource.category)}
              </p>
            </div>
            {status && <StatusBadge status={status} />}
          </div>
          <Link
            to={`/resources/${resource.id}`}
            className="inline-flex w-full justify-center rounded-md bg-alert-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-alert-800 min-h-[44px]"
          >
            Open details
          </Link>
        </div>
      </Popup>
    </Marker>
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

function Legend() {
  return (
    <div className="whu-map-legend">
      <p className="mb-1 font-semibold text-slate-700">Status</p>
      <ul className="space-y-0.5">
        {[
          { value: 'AVAILABLE', label: 'Available', tone: 'safe' },
          { value: 'RESERVED', label: 'Reserved', tone: 'caution' },
          { value: 'IN_USE', label: 'In Use', tone: 'caution' },
          { value: 'UNAVAILABLE', label: 'Unavailable', tone: 'alert' },
        ].map((s) => (
          <li key={s.value} className="flex items-center gap-2">
            <span
              aria-hidden
              className={
                'inline-block h-3 w-3 rounded-full ring-2 ' +
                (s.tone === 'safe'
                  ? 'bg-safe-100 ring-safe-600'
                  : s.tone === 'caution'
                  ? 'bg-caution-100 ring-caution-600'
                  : 'bg-alert-100 ring-alert-700')
              }
            />
            <span className="text-slate-700">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Empty / loading / error ──────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="whu-map flex items-center justify-center bg-slate-100"
    >
      <div className="flex flex-col items-center gap-2 text-sm text-slate-600">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
        <span>Loading map…</span>
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
      {message || 'Could not load the resource map.'}
    </div>
  );
}

function EmptyState({ hasLocation, place, radius, onClearFilters, onClearLocation }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      {hasLocation ? (
        <>
          <p className="text-base font-semibold text-slate-900">
            No resources found within {radius} km of {place || 'this location'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Try a wider radius, or clear the location to see every geo-located
            resource on the platform.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onClearLocation}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Clear location
            </button>
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Clear filters
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-slate-900">
            No resources match your filters
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Try widening the category / status filters, or browse the list view
            for resources without a saved location.
          </p>
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

// ── Location search (Nominatim) ───────────────────────────────────────────
//
// Mirrors the address-search UX from AreaSelector.jsx's MapPanel:
// search input → debounced Nominatim lookup → clickable result list
// → selecting a result writes lat/lng/radius to the URL. The radius
// <select> is independent so the user can widen/narrow after picking.
function LocationSearch({
  placeInput,
  onPlaceInputChange,
  onPick,
  onClear,
  radius,
  onRadiusChange,
  hasLocation,
}) {
  const search = useNominatimSearch(placeInput);

  return (
    <section
      aria-label="Search map location"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label
            htmlFor="map-place-search"
            className="block text-xs font-medium text-slate-600"
          >
            Search location
          </label>
          <input
            id="map-place-search"
            type="text"
            value={placeInput}
            onChange={(e) => onPlaceInputChange(e.target.value)}
            placeholder="E.g. Gulshan, Dhaka"
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>

        <div className="min-w-[10rem]">
          <label
            htmlFor="map-radius"
            className="block text-xs font-medium text-slate-600"
          >
            Radius
          </label>
          <select
            id="map-radius"
            value={radius}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onRadiusChange(next);
            }}
            disabled={!hasLocation}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          >
            {RADIUS_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                Within {km} km
              </option>
            ))}
          </select>
        </div>

        {hasLocation && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
          >
            Clear location
          </button>
        )}
      </div>

      {/* Result list — same dropdown UX as AreaSelector. */}
      {(search.isLoading ||
        search.error ||
        search.queryTooShort ||
        (search.results && search.results.length > 0)) && (
        <div className="mt-3">
          {search.queryTooShort && (
            <p className="text-xs text-slate-500">Keep typing to search…</p>
          )}
          {search.isLoading && (
            <p className="text-xs text-slate-500">Searching locations…</p>
          )}
          {search.error && (
            <p role="alert" className="text-xs text-alert-700">
              Location search is temporarily unavailable. Try again.
            </p>
          )}
          {search.results.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
              {search.results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick(r)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    {r.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* "No matches" only when the user has typed enough and we're
          not currently loading. Mirrors the AreaSelector pattern. */}
      {!search.isLoading &&
        !search.error &&
        !search.queryTooShort &&
        search.results.length === 0 &&
        placeInput.trim().length >= 3 && (
          <p className="mt-2 text-xs text-slate-500">No matching locations found.</p>
        )}

      {hasLocation && (
        <p className="mt-2 text-xs text-slate-600">
          Showing resources within {radius} km of{' '}
          <span className="font-medium text-slate-700">
            {placeInput || 'this location'}
          </span>
          .
        </p>
      )}
    </section>
  );
}

// ── Constants ────────────────────────────────────────────────────────────

// Dhaka-centered fallback when no resources are plottable. Matches
// utils/constants.js so the map's empty state matches the rest of
// the project's map views.
const DEFAULT_CENTER = [23.8103, 90.4125];
const DEFAULT_ZOOM = 7;