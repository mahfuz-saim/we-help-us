/**
 * Resource enums — client side mirror (Module 3.4).
 *
 * The server's Resource model defines two enums beyond `CATEGORIES`
 * (which already lives in client/src/utils/categories.js):
 *   - CONDITIONS (NEW | GOOD | FAIR | NEEDS_REPAIR)
 *   - STATUS     (AVAILABLE | RESERVED | IN_USE | UNAVAILABLE)
 *
 * STATUS already exists in client/src/utils/constants.js as
 * RESOURCE_STATUS — that's an object map with {value, label, color}.
 * For CONDITION the form needs just the raw array of values
 * (react-hook-form's <select> populates from an array of strings),
 * so we keep that separate.
 *
 * These are data-only mirrors — no Leaflet / no react-leaflet. They
 * are safe to import into the smoke test (the test strips the
 * categories module's leaflet import; for these there is no import
 * to strip).
 */

export const CONDITIONS = Object.freeze([
  'NEW',
  'GOOD',
  'FAIR',
  'NEEDS_REPAIR',
]);

export const DEFAULT_CONDITION = 'GOOD';
