/**
 * EmergencyMapCard — Module 9 (analytics side).
 *
 * Reads the moderator/admin emergency map and renders a full Leaflet
 * map with red overlays for every active activation:
 *
 *   - CIRCLE scope: <Circle> centered at [lat, lng] with the
 *     activation's radiusMeters.
 *   - HIERARCHY scope: a single <Marker> at the root area's centroid
 *     (which we approximate from the rootAreaId via a one-shot
 *     `useAreaChain` call — the chain gives us the full ancestor
 *     path labels; for centroid we currently fallback to the
 *     default map center if the server doesn't expose coordinates
 *     inline). Future: render Polygons when Area.boundary is
 *     populated.
 *
 * The card is full-width and lives in the second row of
 * AnalyticsPage. It's read-only — the moderator dashboard owns the
 * activation write flow (see EmergencyActivationDialog).
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The activation payload exposes `activatedBy` as an id only —
 *   never email/phone. This card never reads /users/:id. The
 *   "activator" label is omitted; consumers see `scope` + `message`
 *   only. (We could surface the name later once the server grows a
 *   join endpoint; for now the actor id is in the payload but we
 *   intentionally don't render it.)
 *
 * The component imports `useEmergencyMap` which auto-refreshes when
 * `useNotificationSocket` invalidates the `emergency-activations`
 * query family on `emergency:activated` events.
 */

import { useMemo } from 'react';
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
} from 'react-leaflet';

import '../../utils/leaflet-icons';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from '../../utils/constants';
import { useEmergencyMap } from '../../hooks/useEmergencyActivations';

// Bangladesh-ish default center, matching the analytics map style.
const ANALYTICS_CENTER = { lat: 23.685, lng: 90.3563 };
const ANALYTICS_ZOOM = 7;

export default function EmergencyMapCard() {
  const q = useEmergencyMap();
  const activations = Array.isArray(q.data) ? q.data : [];

  const shapeStats = useMemo(() => {
    const counts = { HIERARCHY: 0, CIRCLE: 0 };
    for (const a of activations) {
      const key = a.scope === 'CIRCLE' ? 'CIRCLE' : 'HIERARCHY';
      counts[key] += 1;
    }
    return counts;
  }, [activations]);

  // Single stable center / zoom. Activations are anchored in
  // lat/lng already, so we don't need to fit bounds dynamically
  // (the marker / circle positions do the talking).
  const center = DEFAULT_MAP_CENTER || ANALYTICS_CENTER;
  const zoom = DEFAULT_MAP_ZOOM || ANALYTICS_ZOOM;

  return (
    <section
      aria-labelledby="emergency-map-title"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="emergency-map-title"
            className="text-base font-semibold text-slate-900"
          >
            Active emergency map
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Red overlays mark every active activation in your scope.
            Circles are radius-based; the rest are hierarchy sweeps.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {activations.length} active · {shapeStats.CIRCLE} circle ·{' '}
          {shapeStats.HIERARCHY} hierarchy
        </p>
      </header>

      {q.isLoading && (
        <div
          aria-hidden
          className="mt-3 h-72 animate-pulse rounded-md bg-slate-100"
        />
      )}

      {q.error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-alert-50 px-3 py-2 text-xs text-alert-800"
        >
          Could not load the emergency map (
          {(q.error && q.error.message) || 'unknown error'}).
        </p>
      )}

      {!q.isLoading && !q.error && activations.length === 0 && (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          No active emergency in your scope.
        </p>
      )}

      {!q.isLoading && !q.error && activations.length > 0 && (
        <div className="mt-3 h-96 overflow-hidden rounded-md border border-slate-200">
          <MapContainer
            center={center}
            zoom={zoom}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {activations.map((a) => (
              <ActivationShape key={a.id} activation={a} />
            ))}
          </MapContainer>
        </div>
      )}
    </section>
  );
}

// ── One shape per activation ───────────────────────────────────────────────

function ActivationShape({ activation: a }) {
  if (a.scope === 'CIRCLE' && a.center && a.radiusMeters) {
    // Server returns `center` as a plain [lng, lat] tuple. We also
    // tolerate the legacy `{ coordinates: [...] }` shape in case any
    // older cached payload is still in the browser.
    let lng;
    let lat;
    if (Array.isArray(a.center)) {
      [lng, lat] = a.center;
    } else if (
      a.center &&
      Array.isArray(a.center.coordinates)
    ) {
      [lng, lat] = a.center.coordinates;
    } else {
      return null;
    }
    return (
      <Circle
        center={[lat, lng]}
        radius={a.radiusMeters}
        pathOptions={{
          color: '#dc2626',
          fillColor: '#dc2626',
          fillOpacity: 0.2,
          weight: 2,
        }}
      >
        <Tooltip sticky>
          <ActivationTooltipBody a={a} center={{ lat, lng }} />
        </Tooltip>
      </Circle>
    );
  }
  // HIERARCHY scope — we don't have a centroid on the wire today; we
  // anchor at the default center to keep the card readable. Users
  // can click the marker for the message. Once the server exposes
  // polygon boundaries we'll switch to <Polygon>.
  if (a.scope === 'HIERARCHY') {
    return (
      <Marker
        position={[DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng]}
      >
        <Popup>
          <ActivationPopupBody a={a} />
        </Popup>
      </Marker>
    );
  }
  return null;
}

function ActivationTooltipBody({ a, center }) {
  const km = a.radiusMeters ? (a.radiusMeters / 1000).toFixed(1) : null;
  return (
    <div className="text-xs">
      <p className="font-semibold text-alert-800">CIRCLE · {km} km</p>
      <p className="text-slate-700">
        Center: {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
      </p>
      {a.message && <p className="mt-1 text-slate-700">{a.message}</p>}
    </div>
  );
}

function ActivationPopupBody({ a }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="font-semibold text-alert-800">HIERARCHY activation</p>
      <p className="text-slate-700">Root area: {a.rootAreaId}</p>
      {a.descendantAreaIds && a.descendantAreaIds.length > 0 && (
        <p className="text-slate-700">
          Covers {a.descendantAreaIds.length} areas
        </p>
      )}
      {a.message && <p className="mt-1 text-slate-700">{a.message}</p>}
    </div>
  );
}