/**
 * EmergencyActivationForm — Module 9 (volunteer side).
 *
 * The volunteer's UI for activating emergency mode. Lets them:
 *   1. Pick any level of their own address chain (DISTRICT, UPAZILA,
 *      UNION, WARD, or VILLAGE). Selecting a coarser level cascades
 *      the activation to every area beneath it.
 *   2. Optionally toggle a map pin + radius (CIRCLE scope). When set,
 *      every owner whose resource sits inside the circle enters the
 *      emergency in addition to the hierarchy sweep.
 *   3. Write a coordination message (≤1000 chars, mirrors the server
 *      validator at server/validators/emergency.validators.js).
 *
 * Both modes can be active simultaneously — the server models them as
 * two separate `EmergencyActivation` rows, but the volunteer flow
 * only ever sends ONE request per "Activate" click. To activate both,
 * the user clicks Activate twice (once for hierarchy, once for the
 * pin). The volunteer dashboard then shows two banners.
 *
 * Props:
 *   - volunteerAreaChain: array of `{ id, level, name }` from root →
 *     leaf. The component seeds the hierarchy dropdown to the
 *     volunteer's own leaf.
 *   - existingActivations: array returned from
 *     useEmergencyActivations. The form renders a list of active rows
 *     with a "Deactivate" button for each.
 *   - onSubmit({ rootAreaId, message, center?, radiusMeters? })
 *
 * Validation:
 *   - message is required (1..1000 chars).
 *   - rootAreaId must be one of the entries in `volunteerAreaChain`
 *     (server re-validates ancestor-set membership).
 *   - If `useCircle` is true, center + radiusMeters must BOTH be set.
 *     radiusMeters is 1..50000 (50 km cap).
 *
 * Submitting POSTs /api/emergency-activations. The hooks in
 * useEmergencyActivations handle invalidation, so the row list +
 * analytics map + resource list all refresh on success.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  Marker,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';

import '../../utils/leaflet-icons';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from '../../utils/constants';
import {
  useCreateVolunteerActivation,
  useDeactivateEmergencyActivation,
} from '../../hooks/useEmergencyActivations';

const MAX_MESSAGE_CHARS = 1000;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 50000;
const DEFAULT_RADIUS_METERS = 5000; // 5 km

export default function EmergencyActivationForm({
  volunteerAreaChain = [],
  existingActivations = [],
  onActivated,
  onDeactivated,
}) {
  const [selectedRootId, setSelectedRootId] = useState(
    pickLeafId(volunteerAreaChain)
  );
  const [message, setMessage] = useState('');
  const [useCircle, setUseCircle] = useState(false);
  const [pin, setPin] = useState(null);
  const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS_METERS);

  // When the volunteer area chain first resolves (or changes), seed
  // the selection to the leaf. Never overwrite a user-chosen value
  // after they've picked something else.
  useEffect(() => {
    if (!selectedRootId && volunteerAreaChain.length > 0) {
      setSelectedRootId(pickLeafId(volunteerAreaChain));
    }
  }, [volunteerAreaChain, selectedRootId]);

  const messageInvalid = message.trim().length === 0 ||
    message.length > MAX_MESSAGE_CHARS;
  const radiusInvalid = !Number.isFinite(radiusMeters) ||
    radiusMeters < MIN_RADIUS_METERS ||
    radiusMeters > MAX_RADIUS_METERS;
  const circleInvalid = useCircle && (!pin || radiusInvalid);

  const create = useCreateVolunteerActivation();
  const deactivate = useDeactivateEmergencyActivation();

  const canSubmit = Boolean(selectedRootId) && !messageInvalid && !circleInvalid;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const body = {
      rootAreaId: selectedRootId,
      message: message.trim(),
    };
    if (useCircle && pin) {
      body.center = {
        type: 'Point',
        coordinates: [pin.lng, pin.lat],
      };
      body.radiusMeters = radiusMeters;
    }
    try {
      await create.mutateAsync(body);
      setMessage('');
      setUseCircle(false);
      setPin(null);
      setRadiusMeters(DEFAULT_RADIUS_METERS);
      if (typeof onActivated === 'function') onActivated();
    } catch {
      /* create.error surfaces in the UI below */
    }
  }

  async function handleDeactivate(id) {
    try {
      await deactivate.mutateAsync(id);
      if (typeof onDeactivated === 'function') onDeactivated();
    } catch {
      /* deactivate.error surfaces in the UI below */
    }
  }

  return (
    <div className="space-y-4">
      <ActiveActivations
        activations={existingActivations}
        onDeactivate={handleDeactivate}
        pendingId={deactivate.isPending ? deactivate.variables : null}
        deactivateError={deactivate.error}
      />

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-alert-300 bg-alert-50 p-4"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Activate emergency
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Pick any level of your address. Selecting a coarser level
            covers every area beneath it. You can also pin a point and
            radius — every owner whose resource is inside the circle
            enters the emergency.
          </p>
        </div>

        <ChainSelect
          chain={volunteerAreaChain}
          value={selectedRootId}
          onChange={setSelectedRootId}
        />

        <div>
          <label
            htmlFor="emergency-message"
            className="block text-xs font-medium text-slate-700"
          >
            Coordination message
          </label>
          <textarea
            id="emergency-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="e.g. Flash flood in the eastern unions. Need boats and drinking water."
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alert-500 focus:outline-none focus:ring-1 focus:ring-alert-500"
          />
          <p
            className={
              'mt-1 text-xs ' +
              (message.length > MAX_MESSAGE_CHARS
                ? 'text-alert-700'
                : 'text-slate-500')
            }
          >
            {message.length} / {MAX_MESSAGE_CHARS} characters
          </p>
        </div>

        <CircleToggle
          enabled={useCircle}
          onChange={setUseCircle}
          pin={pin}
          onPinChange={setPin}
          radiusMeters={radiusMeters}
          onRadiusChange={setRadiusMeters}
          radiusInvalid={radiusInvalid}
        />

        {create.error && (
          <p role="alert" className="text-xs text-alert-700">
            {(create.error && create.error.message) ||
              'Could not activate emergency.'}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="submit"
            disabled={!canSubmit || create.isPending}
            className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-alert-800 disabled:cursor-not-allowed disabled:bg-alert-300 min-h-[44px]"
          >
            {create.isPending ? 'Activating…' : 'Activate emergency'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Active activations list ────────────────────────────────────────────────

function ActiveActivations({
  activations,
  onDeactivate,
  pendingId,
  deactivateError,
}) {
  if (!Array.isArray(activations) || activations.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
        Your active emergencies
      </p>
      <ul className="space-y-2">
        {activations.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-alert-300 bg-white px-3 py-2 shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ScopeBadge scope={a.scope} />
                <span className="text-sm font-medium text-slate-900">
                  {describeScope(a)}
                </span>
              </div>
              {a.message && (
                <p className="mt-1 text-xs text-slate-600">{a.message}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDeactivate(a.id)}
              disabled={pendingId === a.id}
              className="rounded-md border border-alert-700 bg-white px-3 py-2 text-xs font-semibold text-alert-700 hover:bg-alert-100 disabled:opacity-60 min-h-[44px]"
            >
              {pendingId === a.id ? 'Deactivating…' : 'Deactivate'}
            </button>
          </li>
        ))}
      </ul>
      {deactivateError && (
        <p role="alert" className="text-xs text-alert-700">
          {(deactivateError && deactivateError.message) ||
            'Could not deactivate.'}
        </p>
      )}
    </div>
  );
}

function ScopeBadge({ scope }) {
  const label = scope === 'CIRCLE' ? 'Circle' : 'Hierarchy';
  return (
    <span className="rounded-full bg-alert-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      {label}
    </span>
  );
}

function describeScope(a) {
  if (a.scope === 'CIRCLE' && a.center && a.radiusMeters) {
    // The server returns `center` as a plain [lng, lat] tuple (see
    // server/models/EmergencyActivation.js publicShape). We
    // defensively accept the legacy `{ coordinates: [...] }` shape
    // too, but the public API no longer emits that.
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
      return `CIRCLE within ${(a.radiusMeters / 1000).toFixed(1)} km`;
    }
    const km = (a.radiusMeters / 1000).toFixed(1);
    return `Within ${km} km of ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  return `Hierarchy at root area ${a.rootAreaId}`;
}

// ── Chain select ───────────────────────────────────────────────────────────

function ChainSelect({ chain, value, onChange }) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return (
      <p className="text-xs text-slate-600">
        Your account is not yet assigned to an area. Ask an admin to
        assign your address before activating emergency.
      </p>
    );
  }
  // chain is root → leaf; we render in the same order, which mirrors
  // the visual hierarchy in the rest of the app (district on top).
  return (
    <div>
      <label
        htmlFor="emergency-root-area"
        className="block text-xs font-medium text-slate-700"
      >
        Activate for
      </label>
      <select
        id="emergency-root-area"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-alert-500 focus:outline-none focus:ring-1 focus:ring-alert-500"
      >
        {chain.map((node) => (
          <option key={node.id} value={node.id}>
            {node.level}: {node.name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">
        Picking a coarser level covers every area beneath it. You can
        activate multiple scopes at once (hierarchy + circle).
      </p>
    </div>
  );
}

function pickLeafId(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  return chain[chain.length - 1].id;
}

// ── Circle toggle (Leaflet picker + radius slider) ─────────────────────────

function CircleToggle({
  enabled,
  onChange,
  pin,
  onPinChange,
  radiusMeters,
  onRadiusChange,
  radiusInvalid,
}) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-alert-700 focus:ring-alert-500"
        />
        Also pin a point + radius (CIRCLE scope)
      </label>
      {!enabled && (
        <p className="text-xs text-slate-500">
          When enabled, every owner whose resource sits inside the
          circle enters the emergency in addition to the hierarchy
          sweep.
        </p>
      )}
      {enabled && (
        <div className="space-y-3">
          <div className="h-64 overflow-hidden rounded-md border border-slate-200">
            <MapContainer
              center={
                pin ? { lat: pin.lat, lng: pin.lng } : DEFAULT_MAP_CENTER
              }
              zoom={DEFAULT_MAP_ZOOM}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickToMove onPick={onPinChange} />
              {pin && (
                <Marker
                  position={[pin.lat, pin.lng]}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => {
                      const m = e.target;
                      const ll = m.getLatLng();
                      onPinChange({ lng: ll.lng, lat: ll.lat });
                    },
                  }}
                />
              )}
            </MapContainer>
          </div>
          <p className="text-xs text-slate-500">
            {pin
              ? `Pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
              : 'Click anywhere on the map to drop the pin.'}
          </p>
          <div>
            <label
              htmlFor="emergency-radius"
              className="flex items-center justify-between text-xs font-medium text-slate-700"
            >
              <span>Radius</span>
              <span className="font-mono text-slate-900">
                {(radiusMeters / 1000).toFixed(1)} km
              </span>
            </label>
            <input
              id="emergency-radius"
              type="range"
              min={MIN_RADIUS_METERS}
              max={MAX_RADIUS_METERS}
              step={100}
              value={radiusMeters}
              onChange={(e) =>
                onRadiusChange(parseInt(e.target.value, 10))
              }
              className="mt-1 w-full accent-alert-700"
            />
            <p
              className={
                'mt-1 text-xs ' +
                (radiusInvalid ? 'text-alert-700' : 'text-slate-500')
              }
            >
              {radiusMeters < MIN_RADIUS_METERS
                ? `Minimum ${MIN_RADIUS_METERS / 1000} km.`
                : radiusMeters > MAX_RADIUS_METERS
                ? `Maximum ${MAX_RADIUS_METERS / 1000} km.`
                : `Cap is ${MAX_RADIUS_METERS / 1000} km.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ClickToMove({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lng: e.latlng.lng, lat: e.latlng.lat });
    },
  });
  return null;
}
