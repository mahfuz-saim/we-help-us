/**
 * VolunteerEmergencyPage — Module 9 dedicated emergency surface.
 *
 * Replaces the inline EmergencyActivationForm that previously lived at
 * the top of the My Requests page. Lives at /volunteer/emergency and
 * is reachable from the navbar (desktop + mobile drawer).
 *
 * What it shows:
 *   1. Header — explains the page.
 *   2. Active-emergency panel (when at least one of this volunteer's
 *      activations is live): the list of live rows with per-row
 *      deactivate. Activations are HIERARCHY (whole-area cascade) or
 *      CIRCLE (pin + radius). Each row describes its scope.
 *   3. Activate-emergency panel (only when NO active row exists):
 *      the same EmergencyActivationForm the dashboard used to embed.
 *      If the volunteer already has an active row, the form is
 *      hidden — the volunteer must deactivate first, mirroring the
 *      server's "one active activation per volunteer" gate.
 *   4. Gate hint (when canActivate is false): explains why the
 *      volunteer can't activate (e.g. not verified yet, no area
 *      assigned).
 *
 * Privacy boundary:
 *   - The page does NOT call /users/:id or /auth/me. The list
 *     endpoint returns public shape (activatedBy as id only).
 *   - The form's mutation hooks (useCreateVolunteerActivation,
 *     useDeactivateEmergencyActivation) carry no contact info.
 */

import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';
import EmergencyActivationForm from '../../components/emergency/EmergencyActivationForm';
import {
  useDeactivateEmergencyActivation,
  useEmergencyActivations,
} from '../../hooks/useEmergencyActivations';
import { useAreaChain } from '../../hooks/useAreas';

export default function VolunteerEmergencyPage() {
  const { user } = useAuth();

  // ── Eligibility ──────────────────────────────────────────────────────
  // The same gate as the prior inline form: verified volunteer with an
  // assigned area. We render the form section only when canActivate is
  // true AND the volunteer has no active row; otherwise the user gets a
  // helpful message instead of a hidden button.
  const canActivate =
    Boolean(user) &&
    user.role === 'VOLUNTEER' &&
    user.isVerified === true &&
    Boolean(user.areaId);

  // ── Activations list ─────────────────────────────────────────────────
  // The server returns any activation whose rootAreaId lies in the
  // volunteer's chain. We narrow further to rows where the activator
  // is THIS volunteer + role is VOLUNTEER so a volunteer never sees
  // (or accidentally deactivates) someone else's row.
  const myActivationsQuery = useEmergencyActivations(
    { active: true },
    { enabled: Boolean(user) }
  );
  const myActivations = useMemo(() => {
    const data = myActivationsQuery.data;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (a) =>
        a &&
        a.activatedByRole === 'VOLUNTEER' &&
        a.activatedBy &&
        user &&
        a.activatedBy === user.id
    );
  }, [myActivationsQuery.data, user]);

  const hasActive = myActivations.length > 0;

  // ── Ancestor chain for the form ──────────────────────────────────────
  const chainQuery = useAreaChain({
    areaId: user && user.areaId ? user.areaId : null,
    enabled: canActivate,
  });
  const volunteerAreaChain = useMemo(() => {
    const data = chainQuery.data;
    if (!data || !Array.isArray(data.chain)) return [];
    return data.chain.filter((n) => n && n.id && n.level);
  }, [chainQuery.data]);

  return (
    <div className="space-y-6">
      <Header />

      {!user && <NotLoggedInState />}

      {user && !canActivate && <GateState user={user} />}

      {user && canActivate && (
        <>
          <ActiveEmergencyPanel
            activations={myActivations}
            isLoading={myActivationsQuery.isLoading}
            error={myActivationsQuery.error}
          />

          {!hasActive && (
            <section
              aria-labelledby="emergency-form-title"
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2
                id="emergency-form-title"
                className="text-base font-semibold text-slate-900"
              >
                Activate emergency
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Pick any level of your address chain. Selecting a coarser
                level covers every area beneath it. You can also pin a
                point and radius to cover owners in a circle.
              </p>
              <div className="mt-3">
                <EmergencyActivationForm
                  volunteerAreaChain={volunteerAreaChain}
                  existingActivations={myActivations}
                  onActivated={() => {
                    /* hook invalidation already covers the list refetch */
                  }}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Emergency
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Activate emergency for your area or deactivate an active one.
        Owners inside the activation see a red badge on their resources
        and hear from you via notification.
      </p>
    </header>
  );
}

// ── Active emergency panel ────────────────────────────────────────────────

function ActiveEmergencyPanel({ activations, isLoading, error }) {
  const deactivate = useDeactivateEmergencyActivation();

  // Toast on successful deactivate so the volunteer gets explicit
  // feedback. The list hook already invalidates the family, so the
  // UI updates without manual refetch.
  useEffect(() => {
    if (deactivate.isSuccess) {
      toast.success('Emergency deactivated.');
      deactivate.reset?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deactivate.isSuccess]);

  async function handleDeactivate(id) {
    try {
      await deactivate.mutateAsync(id);
    } catch (err) {
      toast.error(
        (err && err.message) || 'Could not deactivate the emergency.'
      );
    }
  }

  return (
    <section
      aria-labelledby="active-emergency-title"
      className="rounded-lg border border-alert-300 bg-alert-50 p-4 shadow-sm"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="active-emergency-title"
          className="text-base font-semibold text-slate-900"
        >
          Your active emergencies
        </h2>
        <span
          className="inline-flex items-center gap-1 rounded-full bg-alert-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          aria-label={`${activations.length} active`}
        >
          {activations.length} active
        </span>
      </header>

      {isLoading && (
        <div
          aria-hidden
          className="mt-3 h-20 animate-pulse rounded-md bg-white/60"
        />
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-white px-3 py-2 text-xs text-alert-800"
        >
          Could not load your active emergencies (
          {(error && error.message) || 'unknown error'}).
        </p>
      )}

      {!isLoading && !error && activations.length === 0 && (
        <p className="mt-3 text-sm text-slate-700">
          You don't have any active emergency right now. Use the form
          below to start one.
        </p>
      )}

      {!isLoading && !error && activations.length > 0 && (
        <ul className="mt-3 space-y-2">
          {activations.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-alert-300 bg-white px-3 py-2 shadow-sm"
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
                <p className="mt-1 text-[11px] text-slate-500">
                  Activated{' '}
                  {a.activatedAt ? new Date(a.activatedAt).toLocaleString() : '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDeactivate(a.id)}
                disabled={deactivate.isPending && deactivate.variables === a.id}
                className="rounded-md border border-alert-700 bg-white px-3 py-2 text-xs font-semibold text-alert-700 hover:bg-alert-100 disabled:opacity-60 min-h-[44px]"
              >
                {deactivate.isPending && deactivate.variables === a.id
                  ? 'Deactivating…'
                  : 'Deactivate'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Gate / not-logged-in states ───────────────────────────────────────────

function GateState({ user }) {
  const reasons = [];
  if (user.role !== 'VOLUNTEER') {
    reasons.push('Only volunteers can activate emergency.');
  } else if (user.isVerified !== true) {
    reasons.push(
      'Your volunteer account is not verified yet. Verification is required to activate emergency.'
    );
  } else if (!user.areaId) {
    reasons.push(
      'Your account has no assigned area. Ask an admin to assign your address before activating emergency.'
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900">
        Emergency activation is unavailable
      </p>
      <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function NotLoggedInState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
      You need to{' '}
      <Link to="/login" className="font-medium text-brand-700 hover:underline">
        log in
      </Link>{' '}
      to manage emergency activations.
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ScopeBadge({ scope }) {
  const label = scope === 'CIRCLE' ? 'Circle' : 'Hierarchy';
  return (
    <span className="inline-flex items-center rounded-full bg-alert-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
      {label}
    </span>
  );
}

function describeScope(a) {
  if (a.scope === 'CIRCLE' && a.center && a.radiusMeters) {
    // Server returns `center` as a plain [lng, lat] tuple (see
    // server/models/EmergencyActivation.js publicShape). We also
    // tolerate the legacy `{ coordinates: [...] }` shape.
    let lng;
    let lat;
    if (Array.isArray(a.center)) {
      [lng, lat] = a.center;
    } else if (a.center && Array.isArray(a.center.coordinates)) {
      [lng, lat] = a.center.coordinates;
    } else {
      return `CIRCLE within ${(a.radiusMeters / 1000).toFixed(1)} km`;
    }
    const km = (a.radiusMeters / 1000).toFixed(1);
    return `Within ${km} km of ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  return `Hierarchy at root area ${a.rootAreaId}`;
}