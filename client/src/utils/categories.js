/**
 * Resource categories — client mirror (Module 3.3).
 *
 * Mirrors server/utils/categories.js. The server is the source of
 * truth for enum values; this file adds the visual layer (Leaflet
 * DivIcons) the client needs.
 *
 * The two files are kept in sync by code review (no shared build
 * step — the project is small and we don't want to introduce a
 * workspace / monorepo tooling chain for one constants file). The
 * smoke test asserts that the value arrays match exactly so a drift
 * fails loudly.
 *
 * The `getCategoryIcon(category, status)` factory returns a Leaflet
 * `L.divIcon` instance rendered as a colored emoji circle. Module 4.3
 * (interactive map view) will use this factory for every resource
 * marker. The factory is defined here — not in the map view — so
 * the same icon is reused everywhere (list cards, search dropdowns,
 * etc.).
 */

import L from 'leaflet';

// ── Enum (must match server/utils/categories.js) ───────────────────────────

export const CATEGORIES = Object.freeze({
  TRANSPORTATION: 'TRANSPORTATION',
  RESCUE_EQUIPMENT: 'RESCUE_EQUIPMENT',
  MEDICAL: 'MEDICAL',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  UTILITIES: 'UTILITIES',
  SKILLED_PROFESSIONALS: 'SKILLED_PROFESSIONALS',
});

export const CATEGORY_VALUES = Object.values(CATEGORIES);

/**
 * Category metadata. The order here is the canonical display order
 * (used by dropdowns, filter chips, and the legend on the map view).
 *
 * `color` is a Tailwind-style token from the project's design system
 * (defined in index.css under `@theme`). Module 4.3 maps this token
 * to a CSS class on the DivIcon container; the smoke test verifies
 * the tokens are valid project colors.
 */
export const CATEGORY_META = Object.freeze([
  {
    value: CATEGORIES.TRANSPORTATION,
    label: 'Transportation',
    emoji: '🚗',
    color: 'brand',
  },
  {
    value: CATEGORIES.RESCUE_EQUIPMENT,
    label: 'Rescue Equipment',
    emoji: '🛟',
    color: 'caution',
  },
  {
    value: CATEGORIES.MEDICAL,
    label: 'Medical',
    emoji: '⛑️',
    color: 'alert',
  },
  {
    value: CATEGORIES.INFRASTRUCTURE,
    label: 'Infrastructure',
    emoji: '🏗️',
    color: 'slate',
  },
  {
    value: CATEGORIES.UTILITIES,
    label: 'Utilities',
    emoji: '💡',
    color: 'caution',
  },
  {
    value: CATEGORIES.SKILLED_PROFESSIONALS,
    label: 'Skilled Professionals',
    emoji: '🧑‍🔧',
    color: 'safe',
  },
]);

// ── Lookup helpers ─────────────────────────────────────────────────────────

export function getCategoryByValue(value) {
  return CATEGORY_META.find((m) => m.value === value) || null;
}

export function getCategoryLabel(value) {
  const meta = getCategoryByValue(value);
  return meta ? meta.label : value;
}

export function getCategoryEmoji(value) {
  const meta = getCategoryByValue(value);
  return meta ? meta.emoji : '📦';
}

/**
 * Per-category background + foreground colors used by the default
 * placeholder image. The keys are the same color tokens used by
 * `getCategoryIcon` so the placeholder stays visually consistent with
 * the map pin (e.g. a transportation resource shows the same brand
 * tint whether it's a pin on the map or the fallback image in the
 * details page).
 *
 * Tailwind v4 makes these colors available as `bg-{token}-50` and
 * `text-{token}-700`. We need the literal hex values here because we
 * build the SVG by hand — we can't reference Tailwind classes inside
 * an inline data URI.
 */
const PLACEHOLDER_COLORS = Object.freeze({
  brand: { bg: '#eff6ff', fg: '#1d4ed8' }, // brand-50 / brand-700
  caution: { bg: '#fef9c3', fg: '#a16207' }, // caution-100 / caution-700
  alert: { bg: '#fee2e2', fg: '#b91c1c' }, // alert-100 / alert-700
  safe: { bg: '#dcfce7', fg: '#15803d' }, // safe-100 / safe-700
  slate: { bg: '#f1f5f9', fg: '#475569' }, // slate-100 / slate-600
});

/**
 * Build a default placeholder image (data URI) for a category. Used by
 * the resource details page when a resource has no uploaded photos —
 * instead of an empty "No photos uploaded" panel, the gallery shows a
 * tinted SVG with the category emoji and label so the page still has
 * a recognisable visual.
 *
 * The SVG is generated inline so the project doesn't need a static
 * asset pipeline for one-off placeholder images. The output is a
 * `data:image/svg+xml;utf8,…` URI that can be used as an `<img src>`.
 *
 * @param {string|null|undefined} categoryValue
 * @param {object} [opts]
 * @param {string} [opts.label] - Resource label (e.g. resource.title).
 *                                Falls back to the category label.
 * @returns {string} SVG data URI.
 */
export function getCategoryPlaceholderImage(categoryValue, opts = {}) {
  const meta = getCategoryByValue(categoryValue);
  const fallback = {
    emoji: '📦',
    color: 'slate',
    label: 'Resource',
  };
  const cat = meta || fallback;
  const colors = PLACEHOLDER_COLORS[cat.color] || PLACEHOLDER_COLORS.slate;
  const label = (opts.label || cat.label || 'Resource').toString();
  const emoji = cat.emoji || fallback.emoji;

  // The SVG is square (1:1) so the gallery's `aspect-[4/3]` wrapper
  // letterboxes it without distortion. We render the emoji large in
  // the center and the label as a small caption underneath.
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${escapeXml(label)} placeholder">
  <rect width="400" height="400" fill="${colors.bg}"/>
  <text x="200" y="190" text-anchor="middle" font-size="140" font-family="system-ui, -apple-system, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif">${escapeXml(emoji)}</text>
  <text x="200" y="290" text-anchor="middle" font-size="28" font-family="system-ui, -apple-system, sans-serif" fill="${colors.fg}" font-weight="600">${escapeXml(label)}</text>
  <text x="200" y="330" text-anchor="middle" font-size="16" font-family="system-ui, -apple-system, sans-serif" fill="${colors.fg}" opacity="0.7">No photo uploaded</text>
</svg>`.trim();

  // The `#` in hex colors is fine inside an SVG attribute, but the
  // raw `<` and `>` would otherwise blow up an `<img src>` parser
  // if we skipped the encoding. We URL-encode the parts that need it.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Leaflet icon factory ───────────────────────────────────────────────────

/**
 * Tailwind's ring + bg combinations keyed by category color. These
 * classes are referenced by the DivIcon HTML below; the smoke test
 * asserts each color token appears here so a missing class fails
 * loudly instead of rendering an unstyled pin at runtime.
 */
const COLOR_CLASSES = Object.freeze({
  brand: { ring: 'ring-brand-500', bg: 'bg-brand-50', text: 'text-brand-700' },
  caution: { ring: 'ring-caution-500', bg: 'bg-caution-50', text: 'text-caution-700' },
  alert: { ring: 'ring-alert-500', bg: 'bg-alert-50', text: 'text-alert-700' },
  safe: { ring: 'ring-safe-500', bg: 'bg-safe-50', text: 'text-safe-700' },
  slate: { ring: 'ring-slate-400', bg: 'bg-slate-50', text: 'text-slate-700' },
});

/**
 * Build a Leaflet `L.divIcon` for a resource marker. The icon is a
 * white circle with the category emoji inside and a colored ring
 * matching the resource's status (Module 4.3 will use status to
 * decide the ring color; for now we use the category color as the
 * default ring so a missing status doesn't break the map).
 *
 * The returned icon is memoized per (category, status) pair — Leaflet
 * creates a fresh `divIcon` on every `L.marker(...)` call otherwise,
 * which thrashes React-Leaflet's reconciliation. Modules 4.3 / 4.2
 * can safely call this in render() without worrying about churn.
 */
const iconCache = new Map();

export function getCategoryIcon(categoryValue, statusValue = null) {
  const cacheKey = `${categoryValue}::${statusValue || 'default'}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const meta = getCategoryByValue(categoryValue);
  if (!meta) {
    // Fallback: neutral pin. Should never happen for valid server data,
    // but failing closed (rather than crashing the map) is friendlier.
    const fallback = L.divIcon({
      className: 'whu-category-icon whu-category-icon--unknown',
      html: '<div class="whu-pin whu-pin--slate">📦</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    iconCache.set(cacheKey, fallback);
    return fallback;
  }

  const colors = COLOR_CLASSES[meta.color] || COLOR_CLASSES.slate;
  // Status ring (Module 4.3 lights this up). For 3.3 the ring color
  // matches the category color so the icons look consistent on the
  // map regardless of status until that module lands.
  const statusClass = statusValue
    ? `whu-pin--status-${statusValue.toLowerCase()}`
    : '';

  const html =
    `<div class="whu-pin ${colors.bg} ${colors.ring} ${statusClass}">` +
    `<span class="whu-pin__emoji ${colors.text}" aria-hidden="true">${meta.emoji}</span>` +
    `</div>`;

  const icon = L.divIcon({
    className: `whu-category-icon whu-category-icon--${meta.value}`,
    html,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });

  iconCache.set(cacheKey, icon);
  return icon;
}

/**
 * Convenience for tests / non-Leaflet contexts: returns the raw HTML
 * used inside a category icon. Used by the smoke test to assert the
 * emoji + classes are wired correctly without spinning up Leaflet.
 */
export function getCategoryIconHtml(categoryValue) {
  const meta = getCategoryByValue(categoryValue);
  if (!meta) return '';
  const colors = COLOR_CLASSES[meta.color] || COLOR_CLASSES.slate;
  return (
    `<div class="whu-pin ${colors.bg} ${colors.ring}">` +
    `<span class="whu-pin__emoji ${colors.text}">${meta.emoji}</span>` +
    `</div>`
  );
}
