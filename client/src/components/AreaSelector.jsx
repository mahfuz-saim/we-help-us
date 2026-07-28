/**
 * AreaSelector — the three-in-one location picker (Module 2.2).
 *
 * Three input modes, all surfaces of the same `value`:
 *   - "By hierarchy" — five cascading <select> dropdowns that walk
 *     district → upazila → union → ward → village.
 *   - "Search address" — debounced Nominatim lookup.
 *   - "Pick on map" — Leaflet map with a draggable pin.
 *
 * Output shape (passed to `onChange`):
 *   {
 *     areaId:    string | null,    // Deepest node selected via hierarchy
 *     lng:       number | null,    // [longitude, latitude] from map or search
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
 *   - All three modes are independent — picking a pin doesn't reset
 *     the dropdown chain and vice versa.
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
  { id: 'search', label: 'Search address' },
  { id: 'map', label: 'Pick on map' },
]);

/**
 * @param {object}  props
 * @param {string}  [props.initialAreaId]
 * @param {number}  [props.initialLng]
 * @param {number}  [props.initialLat]
 * @param {string}  [props.initialAreaLabel]  Read-only hint shown on first paint
 *                                            (e.g. "Dhaka > Mirpur"). The
 *                                            component re-emits the chain
 *                                            it builds itself.
 * @param {boolean} [props.disabled=false]
 * @param {(value: {areaId, lng, lat, areaLabel}) => void} props.onChange
 */
export default function AreaSelector({
  initialAreaId = null,
  initialLng = null,
  initialLat = null,
  initialAreaLabel = null,
  disabled = false,
  onChange,
}) {
  const [activeTab, setActiveTab] = useState('hierarchy');

  // ── Hierarchy state ────────────────────────────────────────────────────
  // `chain` maps level → { id, name } so the summary can render labels.
  // We seed it with the parent's hint so the dropdowns can be re-opened
  // to "show me where I am" without a server round-trip.
  const [chain, setChain] = useState(() => {
    const seed = {
      DISTRICT: null,
      UPAZILA: null,
      UNION: null,
      WARD: null,
      VILLAGE: null,
    };
    if (initialAreaId && initialAreaLabel) {
      // We don't know which level initialAreaId sits at — but the seed
      // label tells us the deepest known node. The leaf sits in VILLAGE
      // semantically, but the user can correct it by re-selecting in
      // the dropdown. We seed VILLAGE so the next "deeper" picks keep
      // walking down.
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
        {activeTab === 'search' && (
          <SearchPanel
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={search.results}
            isLoading={search.isLoading}
            error={search.error}
            queryTooShort={search.queryTooShort}
            onPick={(r) => {
              setPin({ lng: r.lng, lat: r.lat });
              setActiveTab('map');
            }}
            disabled={disabled}
          />
        )}
        {activeTab === 'map' && (
          <MapPanel pin={pin} onChange={setPin} disabled={disabled} />
        )}
      </div>

      <Summary chain={chain} pin={pin} />
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

// ── Search panel ───────────────────────────────────────────────────────────
function SearchPanel({
  query,
  onQueryChange,
  results,
  isLoading,
  error,
  queryTooShort,
  onPick,
  disabled,
}) {
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
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="E.g. Gulshan, Dhaka, 1212"
          disabled={disabled}
          className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-slate-500">
          Powered by OpenStreetMap (Nominatim). Type 3+ characters.
        </p>
      </div>

      {queryTooShort && (
        <p className="text-xs text-slate-500">Keep typing to search…</p>
      )}
      {isLoading && <p className="text-xs text-slate-500">Searching…</p>}
      {error && (
        <p role="alert" className="text-xs text-alert-700">
          Search failed. Check your connection and try again.
        </p>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                disabled={disabled}
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {r.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isLoading && !error && !queryTooShort && results.length === 0 && query.trim().length >= 3 && (
        <p className="text-xs text-slate-500">No matches.</p>
      )}
    </div>
  );
}

// ── Map panel ──────────────────────────────────────────────────────────────
function MapPanel({ pin, onChange, disabled }) {
  const center = pin
    ? { lat: pin.lat, lng: pin.lng }
    : DEFAULT_MAP_CENTER;

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">
        Click anywhere on the map or drag the pin to set your location.
      </p>
      <div className="h-64 overflow-hidden rounded-md border border-slate-200">
        <MapContainer
          center={center}
          zoom={DEFAULT_MAP_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
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
  );
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