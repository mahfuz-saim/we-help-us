/**
 * AreaSelector — the location picker (Module 2.2).
 *
 * Two operating modes:
 *
 *   - Interactive (default, `displayMode === false`):
 *       Two input surfaces for the same `value`:
 *         - "By hierarchy" — five cascading <select> dropdowns that
 *           walk district → upazila → union → ward → village.
 *         - "Pick on map" — Leaflet map with a draggable pin. A
 *           debounced Nominatim search box sits ABOVE the map and
 *           helps the user recenter on a known address; clicking a
 *           result drops the pin there so the user can drag/refine
 *           it. The pin (not the search result) is the source of
 *           truth for `lng/lat`.
 *
 *   - Read-only (`displayMode === true`):
 *       Renders a compact summary showing the saved hierarchy label
 *       and a NON-INTERACTIVE Leaflet map with a single fixed marker
 *       at the saved lat/lng. No tabs, no dropdowns, no draggable
 *       pin, no search input. The parent is expected to render an
 *       "Edit" button next to this; clicking it flips the mode back
 *       to interactive (caller lowers `displayMode` to `false`).
 *
 * Output shape (passed to `onChange`):
 *   {
 *     areaId:    string | null,    // Deepest node selected via hierarchy
 *     lng:       number | null,    // [longitude, latitude] from map pin
 *     lat:       number | null,
 *     areaLabel: string | null,    // Human-readable summary "District > Upazila"
 *   }
 *
 * The component expects `initialAreaId`, `initialLng`, `initialLat`, and
 * `initialAreaLabel` props so it can be controlled from a parent form.
 * It never asks the parent to pre-resolve the chain backwards; the
 * profile page passes the leaf id and label directly.
 *
 * KEY DESIGN REMINDERS honored:
 *   - The map / search are user-initiated. No silent geolocation.
 *   - The two interactive surfaces are independent — picking a pin
 *     doesn't reset the dropdown chain and vice versa.
 *   - Display mode is purely cosmetic; no PII is leaked. The marker
 *     shows lat/lng, the summary shows the area name (already in the
 *     user's profile record).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';

import '../utils/leaflet-icons'; // side-effect: fixes default marker icons
import { useDistricts, useChildren } from '../hooks/useAreas';
import { useNominatimSearch } from '../hooks/useNominatimSearch';
import {
  AREA_LEVELS,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from '../utils/constants';

const TABS = Object.freeze([
  { id: 'hierarchy', label: 'By hierarchy' },
  { id: 'map', label: 'Pick on map' },
]);

// When the user clicks a search result we center the map at this zoom
// level so the marker drops over recognizable streets/buildings.
const SEARCH_RESULT_ZOOM = 16;

/**
 * @param {object}  props
 * @param {string}  [props.initialAreaId]
 * @param {number}  [props.initialLng]
 * @param {number}  [props.initialLat]
 * @param {string}  [props.initialAreaLabel]  Read-only hint shown on first paint
 * @param {Array<{id, level, name}>} [props.initialChain]
 *        Full ancestor chain (root → leaf) for the saved areaId. When
 *        provided, every dropdown is pre-seeded with the saved level
 *        so the user can see exactly what hierarchy they had selected.
 *        When absent, only the leaf is shown (legacy behavior).
 * @param {boolean} [props.disabled=false]
 * @param {boolean} [props.displayMode=false] When true, render the
 *                                          read-only summary (label +
 *                                          static map with marker).
 *                                          No inputs, no tabs.
 * @param {(value: {areaId, lng, lat, areaLabel}) => void} props.onChange
 */
export default function AreaSelector({
  initialAreaId = null,
  initialLng = null,
  initialLat = null,
  initialAreaLabel = null,
  initialChain = null,
  disabled = false,
  displayMode = false,
  onChange,
}) {
  // ── Read-only branch ──────────────────────────────────────────────────
  // When the parent says "just show me what's saved", we skip all the
  // state machinery and render a single summary panel. Nothing in here
  // emits onChange — the parent controls when to flip back to edit.
  if (displayMode) {
    return (
      <ReadOnlySummary
        areaLabel={initialAreaLabel}
        lng={initialLng}
        lat={initialLat}
      />
    );
  }

  const [activeTab, setActiveTab] = useState('hierarchy');

  // ── Hierarchy state ────────────────────────────────────────────────────
  // `chain` maps level → { id, name } so the summary can render labels.
  // We seed it from `initialChain` when the parent provides the full
  // ancestor chain (preferred) — that way every dropdown is pre-selected
  // with the saved level. Fallback: if only `initialAreaId` + label are
  // available, we seed just the VILLAGE slot so the user can still
  // re-walk the chain forward from the leaf.
  const [chain, setChain] = useState(() => {
    const seed = {
      DISTRICT: null,
      UPAZILA: null,
      UNION: null,
      WARD: null,
      VILLAGE: null,
    };
    if (Array.isArray(initialChain) && initialChain.length > 0) {
      // initialChain is root → leaf. Copy each node into its level.
      // We tolerate unknown levels by ignoring them.
      for (const node of initialChain) {
        if (!node || !node.level) continue;
        if (node.level in seed) {
          seed[node.level] = { id: node.id, name: node.name };
        }
      }
    } else if (initialAreaId && initialAreaLabel) {
      // Legacy fallback: parent only knows the leaf id + a single label.
      // Place it in VILLAGE so the user can correct it by re-selecting
      // in the dropdowns.
      seed.VILLAGE = { id: initialAreaId, name: initialAreaLabel };
    }
    return seed;
  });

  const deepest = useMemo(() => {
    for (let i = AREA_LEVELS.length - 1; i >= 0; i -= 1) {
      const node = chain[AREA_LEVELS[i].value];
      if (node) return { ...node, level: AREA_LEVELS[i].value };
    }
    return null;
  }, [chain]);

  // ── Map state ──────────────────────────────────────────────────────────
  const [pin, setPin] = useState(() => pointOrNull(initialLng, initialLat));

  // ── Search state ───────────────────────────────────────────────────────
  // Lives on the map tab now. The map auto-pans when the user picks a
  // result so they can refine the position with drag/click.
  const [searchQuery, setSearchQuery] = useState('');
  const search = useNominatimSearch(searchQuery);

  // ── Emit changes ───────────────────────────────────────────────────────
  // Memoize the last-emitted payload so we don't loop the parent.
  const lastEmittedRef = useRef(null);
  useEffect(() => {
    if (typeof onChange !== 'function') return;
    const payload = {
      areaId: deepest ? deepest.id : null,
      lng: pin ? pin.lng : null,
      lat: pin ? pin.lat : null,
      areaLabel: buildLabel(chain),
    };
    const sig = JSON.stringify(payload);
    if (lastEmittedRef.current === sig) return;
    lastEmittedRef.current = sig;
    onChange(payload);
  }, [deepest, pin, chain, onChange]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <TabBar active={activeTab} onChange={setActiveTab} disabled={disabled} />

      <div className="p-4">
        {activeTab === 'hierarchy' && (
          <HierarchyPanel
            chain={chain}
            onChange={setChain}
            disabled={disabled}
          />
        )}
        {activeTab === 'map' && (
          <MapPanel
            pin={pin}
            onChange={setPin}
            disabled={disabled}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={search.results}
            searchIsLoading={search.isLoading}
            searchError={search.error}
            searchQueryTooShort={search.queryTooShort}
          />
        )}
      </div>

      <Summary chain={chain} pin={pin} />
    </div>
  );
}

// ── Read-only summary (used when displayMode === true) ────────────────────
function ReadOnlySummary({ areaLabel, lng, lat }) {
  const point = pointOrNull(lng, lat);
  const hasLabel = Boolean(areaLabel);
  const hasPoint = Boolean(point);

  if (!hasLabel && !hasPoint) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
        No location saved yet. Click <span className="font-medium">Edit</span>{' '}
        to pick where you live.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasLabel && (
        <div className="flex items-start gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Area
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-sm text-slate-800">
            {areaLabel}
          </span>
        </div>
      )}

      {hasPoint && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Map
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
            </span>
          </div>
          <div className="h-64 overflow-hidden rounded-md border border-slate-200">
            <MapContainer
              center={[point.lat, point.lng]}
              zoom={SEARCH_RESULT_ZOOM}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
              dragging={false}
              doubleClickZoom={false}
              zoomControl={false}
              keyboard={false}
              attributionControl={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker
                position={[point.lat, point.lng]}
                // Not draggable — read-only.
                draggable={false}
                eventHandlers={{ click: () => {} }}
              />
            </MapContainer>
          </div>
          <p className="text-xs text-slate-500">
            This is the saved location. Click <span className="font-medium">Edit</span>{' '}
            to change it.
          </p>
        </div>
      )}

      {!hasLabel && hasPoint && (
        <p className="text-xs text-slate-500">
          No hierarchy area selected — only a map pin is saved.
        </p>
      )}
      {hasLabel && !hasPoint && (
        <p className="text-xs text-slate-500">
          No map pin saved — only the area hierarchy.
        </p>
      )}
    </div>
  );
}

// ── Tab bar ────────────────────────────────────────────────────────────────
function TabBar({ active, onChange, disabled }) {
  return (
    <div className="flex border-b border-slate-200">
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            disabled={disabled}
            className={
              'flex-1 px-3 py-2 text-sm font-medium transition ' +
              (isActive
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-600 hover:bg-slate-50 disabled:opacity-60')
            }
            aria-pressed={isActive}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Hierarchy panel ────────────────────────────────────────────────────────
function HierarchyPanel({ chain, onChange, disabled }) {
  return (
    <div className="space-y-3">
      {AREA_LEVELS.map((level, idx) => (
        <LevelSelect
          key={level.value}
          level={level}
          parentId={idx === 0 ? null : chain[AREA_LEVELS[idx - 1].value]?.id || null}
          value={chain[level.value]?.id || null}
          onChange={(id, name) => {
            // Picking a new value at depth N resets everything below.
            const next = { ...chain };
            if (id) {
              next[level.value] = { id, name };
            } else {
              next[level.value] = null;
            }
            for (let i = idx + 1; i < AREA_LEVELS.length; i += 1) {
              next[AREA_LEVELS[i].value] = null;
            }
            onChange(next);
          }}
          enabled={
            idx === 0 ? true : Boolean(chain[AREA_LEVELS[idx - 1].value])
          }
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function LevelSelect({ level, parentId, value, onChange, enabled, disabled }) {
  // `useChildren` now passes `enabled` straight through so the DISTRICT
  // level (which has no parent) still fires its query.
  const query = useChildren({
    parentId,
    level: level.value,
    enabled: enabled && !disabled,
  });
  const options = (query.data && query.data.areas) || [];

  return (
    <div>
      <label
        htmlFor={`area-${level.value.toLowerCase()}`}
        className="block text-xs font-medium text-slate-600"
      >
        {level.label}
      </label>
      <select
        id={`area-${level.value.toLowerCase()}`}
        value={value || ''}
        onChange={(e) => {
          const id = e.target.value || null;
          const opt = options.find((o) => o.id === id);
          onChange(id, opt ? opt.name : null);
        }}
        disabled={disabled || !enabled}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
      >
        <option value="">
          {query.isFetching
            ? 'Loading…'
            : enabled
            ? `Select ${level.label.toLowerCase()}`
            : `Select ${prevLabel(level.value)} first`}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function prevLabel(levelValue) {
  const idx = AREA_LEVELS.findIndex((l) => l.value === levelValue);
  if (idx <= 0) return 'parent';
  return AREA_LEVELS[idx - 1].label.toLowerCase();
}

// ── Map panel (search box + map) ───────────────────────────────────────────
function MapPanel({
  pin,
  onChange,
  disabled,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchIsLoading,
  searchError,
  searchQueryTooShort,
}) {
  // The map's center is owned by the map instance; we keep a ref to the
  // fly-to function exposed by MapController. When the user picks a
  // search result, the map animates over to that lat/lng and drops the
  // pin there so they can drag/refine it.
  const flyToRef = useRef(null);

  function handlePickResult(r) {
    // Drop the pin at the search result, then ask the map to fly there.
    onChange({ lng: r.lng, lat: r.lat });
    if (flyToRef.current) {
      flyToRef.current(r.lat, r.lng, SEARCH_RESULT_ZOOM);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="area-search"
          className="block text-xs font-medium text-slate-600"
        >
          Search by name or address
        </label>
        <input
          id="area-search"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="E.g. Gulshan, Dhaka, 1212"
          disabled={disabled}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-slate-500">
          Powered by OpenStreetMap (Nominatim). Type 3+ characters, then drag
          the pin to set your exact location.
        </p>
      </div>

      {searchQueryTooShort && (
        <p className="text-xs text-slate-500">Keep typing to search…</p>
      )}
      {searchIsLoading && <p className="text-xs text-slate-500">Searching…</p>}
      {searchError && (
        <p role="alert" className="text-xs text-alert-700">
          Search failed. Check your connection and try again.
        </p>
      )}
      {searchResults.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {searchResults.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => handlePickResult(r)}
                disabled={disabled}
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {r.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searchIsLoading &&
        !searchError &&
        !searchQueryTooShort &&
        searchResults.length === 0 &&
        searchQuery.trim().length >= 3 && (
          <p className="text-xs text-slate-500">No matches.</p>
        )}

      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          Click anywhere on the map or drag the pin to set your location.
        </p>
        <div className="h-64 overflow-hidden rounded-md border border-slate-200">
          <MapContainer
            center={pin ? { lat: pin.lat, lng: pin.lng } : DEFAULT_MAP_CENTER}
            zoom={DEFAULT_MAP_ZOOM}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController flyToRef={flyToRef} />
            <ClickToMove onPick={onChange} disabled={disabled} />
            {pin && (
              <Marker
                position={[pin.lat, pin.lng]}
                draggable={!disabled}
                eventHandlers={{
                  dragend: (e) => {
                    const m = e.target;
                    const ll = m.getLatLng();
                    onChange({ lng: ll.lng, lat: ll.lat });
                  },
                }}
              />
            )}
          </MapContainer>
        </div>
        <p className="text-xs text-slate-500">
          {pin
            ? `Pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
            : 'No pin set yet.'}
        </p>
      </div>
    </div>
  );
}

/**
 * Bridge between react-leaflet and our parent — exposes a `flyTo`
 * function the parent can call to recenter the map (e.g. after the
 * user picks a search result).
 */
function MapController({ flyToRef }) {
  const map = useMapEvents({});
  useEffect(() => {
    flyToRef.current = (lat, lng, zoom) => {
      try {
        map.flyTo([lat, lng], zoom || map.getZoom(), { duration: 0.6 });
      } catch {
        /* map not ready — ignore */
      }
    };
    return () => {
      flyToRef.current = null;
    };
  }, [map, flyToRef]);
  return null;
}

function ClickToMove({ onPick, disabled }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onPick({ lng: e.latlng.lng, lat: e.latlng.lat });
    },
  });
  return null;
}

// ── Summary footer ─────────────────────────────────────────────────────────
function Summary({ chain, pin }) {
  const label = buildLabel(chain);
  return (
    <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-slate-700">Selected:</span>
        {label ? (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
            {label}
          </span>
        ) : (
          <span className="text-slate-500">No area selected</span>
        )}
        {pin && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function pointOrNull(lng, lat) {
  if (lng == null || lat == null) return null;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function buildLabel(chain) {
  // Render "A > B > C" for the non-null levels in order.
  const parts = [];
  for (const lvl of AREA_LEVELS) {
    const node = chain[lvl.value];
    if (node && node.name) parts.push(node.name);
  }
  return parts.length ? parts.join(' › ') : null;
}