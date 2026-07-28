/**
 * MostUsedTable — Module 8.2.
 *
 * Top-N table for GET /api/analytics/most-used-resources. Each row
 * carries:
 *   - resource: { id, category, title, status, areaId, createdAt, updatedAt }
 *   - requestCount
 *   - completedCount (COLLECTED + RETURNED)
 *
 * The server sorts by `completedCount` DESC, then `requestCount` DESC.
 * The table mirrors that order so the most-used resource sits at the
 * top of the list. The privacy-stripped `resource` summary carries no
 * owner contact info (the 8.1 controller never populates the request's
 * resource field beyond the publicResource() shape).
 *
 * The component is purely presentational — it consumes the data shape
 * as-is and never reaches for /users/:id or /auth/me.
 */

import { getCategoryEmoji, getCategoryLabel } from '../../utils/categories';
import { RESOURCE_STATUS } from '../../utils/constants';

const STATUS_COLOR = {
  safe: 'bg-safe-100 text-safe-800 ring-safe-300',
  caution: 'bg-caution-100 text-caution-800 ring-caution-300',
  alert: 'bg-alert-100 text-alert-800 ring-alert-300',
  slate: 'bg-slate-100 text-slate-700 ring-slate-300',
};

export default function MostUsedTable({ items, total }) {
  const rows = Array.isArray(items) ? items : [];
  const safeTotal = typeof total === 'number' ? total : 0;

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
        No completed requests yet — the table will populate once
        volunteers pick up and return resources.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          Sorted by completed requests (COLLECTED + RETURNED).{' '}
          <span className="font-mono text-xs text-slate-500">
            {safeTotal} total request{safeTotal === 1 ? '' : 's'} across the
            current top-N.
          </span>
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Resource</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Requests</th>
              <th className="px-3 py-2 text-right font-semibold">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => {
              const status = RESOURCE_STATUS[row.resource?.status];
              const palette = STATUS_COLOR[status?.color || 'slate'];
              return (
                <tr key={row.resourceId} className="align-middle">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="text-base"
                        title={getCategoryLabel(row.resource?.category)}
                      >
                        {getCategoryEmoji(row.resource?.category)}
                      </span>
                      <span className="truncate font-medium text-slate-900">
                        {row.resource?.title || 'Untitled resource'}
                      </span>
                      <span className="hidden text-xs text-slate-500 sm:inline">
                        · {getCategoryLabel(row.resource?.category)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {status && (
                      <span
                        className={
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ' +
                          palette
                        }
                      >
                        {status.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {row.requestCount}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-alert-700">
                    {row.completedCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}