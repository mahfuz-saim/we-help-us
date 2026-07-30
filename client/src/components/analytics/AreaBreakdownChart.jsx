/**
 * AreaBreakdownChart — Module 8.2.
 *
 * Horizontal bar chart for both `/api/analytics/distribution-by-area`
 * and `/api/analytics/coverage-by-village`. The two endpoints share a
 * response shape (`{ total, byArea: [{ areaId, name, level, count }] }`)
 * so a single component renders both.
 *
 * Pure CSS / SVG — no chart library. The bars use the project's
 * brand/caution color palette so the chart reads consistently with
 * the rest of the dashboard.
 */

export default function AreaBreakdownChart({
  data,
  total,
  emptyLabel = 'No areas have resources yet.',
  testId,
}) {
  const buckets = Array.isArray(data) ? data : [];
  const safeTotal =
    typeof total === 'number' && total > 0
      ? total
      : buckets.reduce((sum, b) => sum + (b.count || 0), 0);

  if (buckets.length === 0 || safeTotal === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
        {emptyLabel}
      </p>
    );
  }

  // The maximum bar width is set to the largest bucket, so the chart
  // rescales instead of overflowing on tall areas.
  const maxCount = buckets.reduce((m, b) => Math.max(m, b.count || 0), 0);

  return (
    <ul className="grid gap-2" data-testid={testId}>
      {buckets.map((b) => {
        const widthPct = maxCount > 0 ? ((b.count || 0) / maxCount) * 100 : 0;
        return (
          <li key={b.areaId} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-slate-900">
                {b.name}
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                  {b.level}
                </span>
              </span>
              <span className="font-mono text-xs text-slate-700">
                {b.count || 0}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                role="presentation"
                className="h-full rounded-full bg-alert-700/80"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}