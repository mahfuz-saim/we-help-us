/**
 * analyticsCategories — Module 8.2.
 *
 * Helper module that translates the category color token (e.g. 'safe',
 * 'caution', 'alert', 'brand', 'slate') from utils/categories.js into
 * concrete hex values the SVG charts can paint with. The project's
 * Tailwind tokens (--color-safe-700, --color-caution-700, etc.) live
 * in CSS and aren't directly readable from JS at runtime, so we keep
 * a sibling hex map here.
 *
 * The category color source-of-truth is still utils/categories.js's
 * `CATEGORY_META[].color` token — this file only maps that token to
 * a hex equivalent. The smoke test asserts that every CATEGORY_VALUES
 * entry has a hex color here so a missing category fails loudly.
 */

import { CATEGORIES, CATEGORY_META, getCategoryByValue } from './categories';

const COLOR_HEX = Object.freeze({
  brand:   '#be123c', // --color-brand-700
  caution: '#a16207', // --color-caution-700
  alert:   '#b91c1c', // --color-alert-700
  safe:    '#15803d', // --color-safe-700
  slate:   '#475569', // --color-slate-600
});

/**
 * Look up the hex color for a category value. Falls back to slate
 * for unknown categories so the chart renders something rather than
 * crashing.
 */
export function getCategoryColor(value) {
  const meta = getCategoryByValue(value);
  if (!meta) return COLOR_HEX.slate;
  return COLOR_HEX[meta.color] || COLOR_HEX.slate;
}

/**
 * Look up the hex color for a Tailwind color token directly. Used by
 * the legend swatch + the donut segment fill.
 */
export function getColorTokenHex(token) {
  return COLOR_HEX[token] || COLOR_HEX.slate;
}

export { CATEGORIES, CATEGORY_META };