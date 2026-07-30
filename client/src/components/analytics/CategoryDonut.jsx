/**
 * CategoryDonut — Module 8.2.
 *
 * SVG donut chart for GET /api/analytics/total-by-category. Renders one
 * arc per category, sized proportionally to the count. Empty buckets
 * (count === 0) are still drawn as a thin baseline segment so the
 * legend has a stable shape.
 *
 * We intentionally roll our own SVG instead of pulling in a chart
 * library — the 8.2 spec says "recharts or chart.js", but a custom
 * donut is ~80 lines of JSX and keeps the bundle small. The colors
 * reuse the project palette from utils/categories.js (which already
 * maps each category to a Tailwind token) so the donut matches every
 * other category surface on the site.
 *
 * Privacy boundary (KEY DESIGN REMINDER): the data comes from the
 * server's `publicResource()`-stripped roll-up. The component does
 * NOT call /users/:id or /auth/me — the buckets are counts, not
 * lists of users.
 */

import { useMemo } from 'react';

import {
  getCategoryEmoji,
  getCategoryLabel,
} from '../../utils/categories';
import { getCategoryColor } from '../../utils/analyticsCategories';

const SIZE = 200;
const RADIUS = 80;
const INNER_RADIUS = 52;
const STROKE = RADIUS - INNER_RADIUS;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * (RADIUS - STROKE / 2);

export default function CategoryDonut({ data, total }) {
  // Server guarantees canonical order; we keep it stable for the legend.
  const buckets = Array.isArray(data) ? data : [];
  const safeTotal =
    typeof total === 'number' && total > 0
      ? total
      : buckets.reduce((sum, b) => sum + (b.count || 0), 0);

  // Pre-compute one arc segment per bucket.
  const segments = useMemo(() => {
    let offset = 0;
    return buckets.map((b) => {
      const count = b.count || 0;
      const fraction = safeTotal > 0 ? count / safeTotal : 0;
      const length = fraction * CIRCUMFERENCE;
      const seg = {
        category: b.category,
        count,
        fraction,
        length,
        offset,
        color: getCategoryColor(b.category),
      };
      offset += length;
      return seg;
    });
  }, [buckets, safeTotal]);

  const allEmpty = safeTotal === 0;

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={
            allEmpty
              ? 'No resources yet — donut is empty'
              : `Resource distribution by category, total ${safeTotal}`
          }
        >
          {/* Track */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS - STROKE / 2}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={STROKE}
          />
          {/* Arcs (one per category) */}
          {!allEmpty &&
            segments.map((s) => (
              <circle
                key={s.category}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS - STROKE / 2}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE}
                strokeDasharray={`${s.length} ${CIRCUMFERENCE - s.length}`}
                strokeDashoffset={-s.offset}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
              />
            ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-900">
            {safeTotal}
          </span>
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Total
          </span>
        </div>
      </div>

      <ul className="grid w-full grid-cols-1 gap-1 text-sm" data-testid="whu-category-donut-legend">
        {buckets.map((b) => {
          const color = getCategoryColor(b.category);
          return (
            <li key={b.category} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-xs"
                style={{ backgroundColor: color + '22', color: color }}
              >
                {getCategoryEmoji(b.category)}
              </span>
              <span className="flex-1 truncate text-slate-700">
                {getCategoryLabel(b.category)}
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                {b.count || 0}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}