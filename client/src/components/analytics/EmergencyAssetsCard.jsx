/**
 * EmergencyAssetsCard — Module 8.2.
 *
 * Card for GET /api/analytics/active-emergency-assets. Surfaces:
 *   - The areas currently in emergency mode (with name + level +
 *     activatedAt timestamp).
 *   - The count of resources deployed in those areas, broken down
 *     by status.
 *   - A small sample of the deployed resources (≤10) so the
 *     dashboard has something to drill into without a separate
 *     endpoint.
 *
 * The card consumes the 8.1 response shape as-is and never calls
 * /users/:id or /auth/me — the controller's `publicResource()` helper
 * (from 3.2) already strips owner contact info.
 *
 * When no area is in emergency mode the card flips into a "monitor"
 * state with a green border so the dashboard reader can tell at a
 * glance whether the platform is in response mode.
 */

import { getCategoryEmoji, getCategoryLabel } from '../../utils/categories';
import { RESOURCE_STATUS } from '../../utils/constants';

const STATUS_COLOR = {
  safe: 'bg-safe-100 text-safe-800',
  caution: 'bg-caution-100 text-caution-800',
  alert: 'bg-alert-100 text-alert-800',
  slate: 'bg-slate-100 text-slate-700',
};

export default function EmergencyAssetsCard({ data }) {
  const emergencyAreas = Array.isArray(data?.emergencyModeAreas)
    ? data.emergencyModeAreas
    : [];
  const byStatus = Array.isArray(data?.byStatus) ? data.byStatus : [];
  const sample = Array.isArray(data?.sample) ? data.sample : [];
  const total = typeof data?.total === 'number' ? data.total : 0;

  const active = emergencyAreas.length > 0;

  return (
    <div
      className={
        'rounded-lg border p-4 shadow-sm ' +
        (active
          ? 'border-alert-300 bg-alert-50'
          : 'border-safe-300 bg-safe-50')
      }
      data-testid="whu-emergency-assets-card"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Emergency mode
        </h3>
        <span
          className={
            'rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ' +
            (active
              ? 'bg-alert-700 text-white ring-alert-700'
              : 'bg-safe-700 text-white ring-safe-700')
          }
        >
          {active ? `${emergencyAreas.length} active` : 'monitor'}
        </span>
      </header>

      {!active && (
        <p className="text-sm text-slate-700">
          No areas are currently in emergency mode. Resource counts below
          reflect the full platform.
        </p>
      )}

      {active && (
        <div className="space-y-3 text-sm text-slate-800">
          <ul className="space-y-1">
            {emergencyAreas.map((a) => (
              <li
                key={a.areaId}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded bg-white/70 px-2 py-1"
              >
                <span className="font-medium">
                  {a.name}
                  <span className="ml-2 rounded bg-alert-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-alert-800">
                    {a.level}
                  </span>
                </span>
                <span className="text-xs text-slate-600">
                  {a.activatedAt
                    ? `Activated ${formatDateTime(a.activatedAt)}`
                    : 'Activation time unknown'}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Resources deployed
            </span>
            <span className="font-mono text-base font-semibold text-alert-800">
              {total}
            </span>
          </div>

          {byStatus.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {byStatus.map((s) => {
                const meta = RESOURCE_STATUS[s.status];
                const palette = STATUS_COLOR[meta?.color || 'slate'];
                return (
                  <li
                    key={s.status}
                    className={
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ' +
                      palette
                    }
                  >
                    <span>{meta?.label || s.status}</span>
                    <span className="font-mono">{s.count}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {sample.length > 0 && (
            <details className="rounded-md bg-white/70 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                Sample of {sample.length} deployed resource
                {sample.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-1">
                {sample.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 text-xs text-slate-700"
                  >
                    <span aria-hidden>{getCategoryEmoji(r.category)}</span>
                    <span className="truncate">{r.title}</span>
                    <span className="text-slate-500">
                      · {getCategoryLabel(r.category)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}