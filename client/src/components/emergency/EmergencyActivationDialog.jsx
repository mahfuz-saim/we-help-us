/**
 * EmergencyActivationDialog — Module 9 (moderator side).
 *
 * The moderator's UI for activating / deactivating emergency. Mirrors
 * the volunteer `EmergencyActivationForm` but:
 *   - rootAreaId is locked to `moderator.areaId`. The moderator cannot
 *     target an ancestor — the server enforces this and the dialog
 *     never offers a picker for it.
 *   - Optional map pin + radius (CIRCLE scope) — same UX as the
 *     volunteer form.
 *   - Deactivate path posts PATCH /:id/deactivate on the chosen row.
 *
 * Submitting POSTs /api/moderator/emergency-activations. The shim
 * keeps the legacy PATCH /moderator/emergency-mode response shape
 * intact so useEmergencyMode keeps working (server
 * controllers/moderator.controller.js shim).
 *
 * Props:
 *   - moderatorAreaLabel: human-readable label for the locked root
 *     area (e.g. "Dhaka > Gulshan").
 *   - existingActivations: array of active rows (filtered to the
 *     moderator's scope by the server).
 *   - isOpen: boolean — when false, the dialog renders nothing.
 *   - onClose(): called after a successful activate/deactivate OR
 *     when the user dismisses without changes.
 *   - onActivated(), onDeactivated(): optional callbacks for parents
 *     that want to refresh other surfaces (the mutation hooks already
 *     invalidate the emergency-activations query family).
 *
 * Module 9 replaces the previous note-only `EmergencyModeDialog`
 * flow (6.3) with this richer dialog. The 6.3 toggle still works via
 * the server shim — the moderator can keep using the simple
 * "Activate / Deactivate" button on the toggle card and ignore this
 * dialog. The dialog surfaces when the moderator opens the toggle
 * with intent to write a coordination message + optional pin.
 */

import { useState } from 'react';
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
  useCreateModeratorActivation,
  useDeactivateEmergencyActivation,
} from '../../hooks/useEmergencyActivations';

const MAX_MESSAGE_CHARS = 1000;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 50000;
const DEFAULT_RADIUS_METERS = 5000; // 5 km

export default function EmergencyActivationDialog({
  moderatorAreaLabel,
  existingActivations = [],
  isOpen,
  onClose,
}) {
  const [mode, setMode] = useState('activate'); // 'activate' | 'deactivate'
  const [message, setMessage] = useState('');
  const [useCircle, setUseCircle] = useState(false);
  const [pin, setPin] = useState(null);
  const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS_METERS);

  const create = useCreateModeratorActivation();
  const deactivate = useDeactivateEmergencyActivation();

  if (!isOpen) return null;

  const messageInvalid = message.length > MAX_MESSAGE_CHARS;
  const radiusInvalid = !Number.isFinite(radiusMeters) ||
    radiusMeters < MIN_RADIUS_METERS ||
    radiusMeters > MAX_RADIUS_METERS;
  const circleInvalid = useCircle && (!pin || radiusInvalid);

  const canSubmitActivate = !messageInvalid && !circleInvalid;
  const canSubmitDeactivate = Array.isArray(existingActivations) &&
    existingActivations.length > 0;

  async function handleActivate(event) {
    event.preventDefault();
    if (!canSubmitActivate) return;
    const body = { message: message.trim() };
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
      if (typeof onClose === 'function') onClose();
    } catch {
      /* create.error surfaces below */
    }
  }

  async function handleDeactivateOne(id) {
    try {
      await deactivate.mutateAsync(id);
      if (typeof onClose === 'function') onClose();
    } catch {
      /* deactivate.error surfaces below */
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="moderator-emergency-dialog-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-4"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2
              id="moderator-emergency-dialog-title"
              className="text-lg font-semibold text-slate-900"
            >
              Emergency mode
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {moderatorAreaLabel
                ? `Scoped to your assigned area: ${moderatorAreaLabel}.`
                : 'Scoped to your assigned area.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Mode"
          className="mt-4 flex border-b border-slate-200"
        >
          {[
            { id: 'activate', label: 'Activate' },
            { id: 'deactivate', label: 'Deactivate' },
          ].map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(tab.id)}
                className={
                  'flex-1 px-3 py-2 text-sm font-medium transition ' +
                  (active
                    ? 'border-b-2 border-alert-700 text-alert-800'
                    : 'text-slate-600 hover:bg-slate-50')
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          {mode === 'activate' ? (
            <form onSubmit={handleActivate} className="space-y-4">
              <div>
                <label
                  htmlFor="moderator-emergency-message"
                  className="block text-xs font-medium text-slate-700"
                >
                  Coordination message
                </label>
                <textarea
                  id="moderator-emergency-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={MAX_MESSAGE_CHARS}
                  placeholder="e.g. Flash flood in the eastern unions — activating for 24 hours."
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alert-500 focus:outline-none focus:ring-1 focus:ring-alert-500"
                />
                <p
                  className={
                    'mt-1 text-xs ' +
                    (messageInvalid ? 'text-alert-700' : 'text-slate-500')
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
                  type="button"
                  onClick={onClose}
                  disabled={create.isPending}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitActivate || create.isPending}
                  className="rounded-md bg-alert-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-alert-800 disabled:cursor-not-allowed disabled:bg-alert-300 min-h-[44px]"
                >
                  {create.isPending ? 'Activating…' : 'Activate'}
                </button>
              </div>
            </form>
          ) : (
            <DeactivateList
              activations={existingActivations}
              onDeactivate={handleDeactivateOne}
              pendingId={
                deactivate.isPending ? deactivate.variables : null
              }
              error={deactivate.error}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Deactivate list ────────────────────────────────────────────────────────

function DeactivateList({
  activations,
  onDeactivate,
  pendingId,
  error,
  onClose,
}) {
  if (!Array.isArray(activations) || activations.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">
          No active emergency in your area.
        </p>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        Pick the activation you want to deactivate. Each row is a
        separate row on the server — hierarchy and circle activations
        are independent.
      </p>
      <ul className="space-y-2">
        {activations.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-alert-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {a.scope === 'CIRCLE' ? 'Circle' : 'Hierarchy'}
                </span>
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
      {error && (
        <p role="alert" className="text-xs text-alert-700">
          {(error && error.message) || 'Could not deactivate.'}
        </p>
      )}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function describeScope(a) {
  if (a.scope === 'CIRCLE' && a.center && a.radiusMeters) {
    // Server returns `center` as a plain [lng, lat] tuple. We
    // defensively accept the legacy `{ coordinates: [...] }` shape
    // too, in case any earlier round-trip cached that form.
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
          Optional. When enabled, every owner inside the circle also
          enters the emergency, regardless of hierarchy.
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
              htmlFor="moderator-emergency-radius"
              className="flex items-center justify-between text-xs font-medium text-slate-700"
            >
              <span>Radius</span>
              <span className="font-mono text-slate-900">
                {(radiusMeters / 1000).toFixed(1)} km
              </span>
            </label>
            <input
              id="moderator-emergency-radius"
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
              Cap is {MAX_RADIUS_METERS / 1000} km.
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