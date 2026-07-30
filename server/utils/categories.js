/**
 * Resource categories — We Help Us (Module 3.3).
 *
 * This is the canonical, server-side definition of the resource
 * categories. The Resource model (3.1) imports its enum from here,
 * validators (3.2) import their check from here, and the client
 * mirrors it in client/src/utils/categories.js.
 *
 * Why a separate file (instead of inline in the model):
 *   - The category list is shared data — the model only needs the enum,
 *     but the API responses, the future map view (4.3), and the
 *     client UI all need the same values + labels + colors + icons.
 *   - Keeping the enum in one place prevents drift: a typo in the
 *     model would silently fail validation against an `enum` the
 *     client never knew about.
 *   - The shape matches the client's `RESOURCE_CATEGORIES` already
 *     shipped in constants.js so the two files can be kept in sync
 *     by review (no shared build step — the project stays small and
 *     deployable to a 48-hour hackathon target).
 *
 * Why emoji + color (not full Leaflet icons):
 *   - The map view (4.3) is the consumer; emojis are a universal
 *     fallback that renders inside a Leaflet DivIcon and ships zero
 *     image assets. The status overlay (4.3) will pair the category
 *     emoji with a colored ring matching the resource status.
 */

const CATEGORIES = Object.freeze({
  TRANSPORTATION: 'TRANSPORTATION',
  RESCUE_EQUIPMENT: 'RESCUE_EQUIPMENT',
  MEDICAL: 'MEDICAL',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  UTILITIES: 'UTILITIES',
  SKILLED_PROFESSIONALS: 'SKILLED_PROFESSIONALS',
});

const CATEGORY_VALUES = Object.values(CATEGORIES);

/**
 * Each entry pairs the enum value with a human-readable label, an
 * emoji icon, and a Tailwind-style color token. The color is used by
 * the map view (4.3) to tint the category marker, and by the search
 * list (4.1) for category badges.
 *
 * The order here IS the canonical display order — the dropdown,
 * filter chips, and map legend all iterate from top to bottom.
 */
const CATEGORY_META = Object.freeze([
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

// Sanity: every entry in CATEGORY_VALUES must have a matching meta
// entry. This guard runs at module load time so a typo fails fast.
const _valuesSet = new Set(CATEGORY_VALUES);
const _metaValues = CATEGORY_META.map((m) => m.value);
const _missingMeta = CATEGORY_VALUES.filter((v) => !_valuesSet.has(v));
const _orphanMeta = _metaValues.filter((v) => !_valuesSet.has(v));
if (_missingMeta.length > 0 || _orphanMeta.length > 0) {
  throw new Error(
    `[categories] CATEGORIES / CATEGORY_META drift detected. ` +
      `missing meta for: ${JSON.stringify(_missingMeta)}; ` +
      `orphan meta for: ${JSON.stringify(_orphanMeta)}`
  );
}

/**
 * Look up the meta entry for a category value. Returns `null` for
 * unknown values (caller decides whether 400 / fallback / etc.).
 */
function getCategoryByValue(value) {
  return CATEGORY_META.find((m) => m.value === value) || null;
}

/**
 * Look up the label for a category value (or the value itself if no
 * meta entry exists). Useful for log lines + error messages.
 */
function getCategoryLabel(value) {
  const meta = getCategoryByValue(value);
  return meta ? meta.label : value;
}

module.exports = {
  CATEGORIES,
  CATEGORY_VALUES,
  CATEGORY_META,
  getCategoryByValue,
  getCategoryLabel,
};
