/**
 * Resource form helpers — Module 3.4 (Resource Registration Form).
 *
 * The registration form is multi-step, so each step carries its own
 * validation rules. We centralise those rules here so:
 *   1. The form, the smoke test, and any future server-side pre-flight
 *      check all agree on what "valid" means at each step.
 *   2. The bounds exactly mirror the zod validators in
 *      server/validators/resource.validators.js — see that file for the
 *      canonical source. We deliberately duplicate the rules so the
 *      client can give instant feedback without a server round-trip;
 *      the server is still the source of truth (the smoke test
 *      3.2-resource-api.test.js guards that the server actually
 *      accepts / rejects what we send).
 *   3. The payload builder knows the exact multipart field names
 *      (`photos`, `category`, `title`, etc.) so the form stays in sync
 *      with `middlewares/upload.js` + `resource.controller.js`.
 *
 * The step order is:
 *   1. CATEGORY  — pick one of the 6 enum values
 *   2. DETAILS   — title, description, capacity, condition
 *   3. PHOTOS    — up to 5 files, 5 MB each, image-only
 *   4. LOCATION  — areaId + lng/lat (both optional)
 *   5. REVIEW    — read-only summary + submit
 *
 * KEY DESIGN REMINDERS honored:
 *   - Photo uploads: 5 files × 5 MB × image-only — same limits the
 *     server enforces in `middlewares/upload.js`. The client-side
 *     checks happen BEFORE the form sends so users get instant
 *     feedback; the server checks happen AGAIN as defense-in-depth.
 *   - Owner contact info is never exposed or accepted here — only
 *     `ownerId` is set, and it comes from the JWT on the server.
 *   - The form is OWNER-only. The page lives behind a ProtectedRoute
 *     with `roles={['OWNER']}` and the server's createResourceSchema
 *     also rejects non-OWNER callers with a 403.
 */

import {
  CATEGORIES,
  CATEGORY_VALUES,
} from './categories';
import {
  UPLOAD_LIMITS,
} from './constants';
import {
  CONDITIONS,
  DEFAULT_CONDITION,
} from './resourceEnums';

// ── Constants that mirror server/validators/resource.validators.js ───────────
// Keep these in lockstep — see "Why two places" in the header above.

export const TITLE_MIN = 2;
export const TITLE_MAX = 120;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;
export const CAPACITY_MIN = 0;
export const CAPACITY_MAX = 100000;

// Re-export under both names so the page can use CONDITIONS (matching
// the server enum name) and the helpers below can use CONDITION_VALUES
// (matching the validator terminology).
export { CONDITIONS };
export const CONDITION_VALUES = CONDITIONS;

// Step order is fixed — used to drive the StepIndicator and to gate
// navigation. Don't reorder without updating the page's step buttons.
export const STEPS = Object.freeze([
  { id: 'category', label: 'Category', index: 0 },
  { id: 'details',  label: 'Details',  index: 1 },
  { id: 'photos',   label: 'Photos',   index: 2 },
  { id: 'location', label: 'Location', index: 3 },
  { id: 'review',   label: 'Review',   index: 4 },
]);

export function getStepIndex(stepId) {
  const step = STEPS.find((s) => s.id === stepId);
  return step ? step.index : 0;
}

// ── Per-step validators ─────────────────────────────────────────────────────
// Each function returns `null` on success or a `Record<fieldName, message>`
// mirroring react-hook-form's `setError` shape. Pure data → data; no side
// effects, no React, no DOM. Unit-testable in isolation (the smoke test
// exercises them).

/**
 * Step 1 — Category.
 *
 * Server: `category` must be one of CATEGORY_VALUES (zod enum). The
 * client refuses anything else before the form even moves on.
 */
export function validateCategoryStep(values) {
  const errors = {};
  if (!values.category) {
    errors.category = 'Pick a category';
  } else if (!CATEGORY_VALUES.includes(values.category)) {
    errors.category = `Pick one of: ${CATEGORY_VALUES.join(', ')}`;
  }
  return Object.keys(errors).length ? errors : null;
}

/**
 * Step 2 — Details (title, description, capacity, condition).
 *
 * Server:
 *   - title: string, trim, min 2, max 120
 *   - description: string, trim, min 10, max 2000
 *   - capacity: int, min 0, max 100000, optional
 *   - condition: enum, optional (defaults to GOOD server-side)
 */
export function validateDetailsStep(values) {
  const errors = {};

  // Title — required, trimmed, length-bounded.
  const title = (values.title || '').trim();
  if (!title) {
    errors.title = 'Title is required';
  } else if (title.length < TITLE_MIN) {
    errors.title = `Title must be at least ${TITLE_MIN} characters`;
  } else if (title.length > TITLE_MAX) {
    errors.title = `Title must be at most ${TITLE_MAX} characters`;
  }

  // Description — required, trimmed, length-bounded.
  const description = (values.description || '').trim();
  if (!description) {
    errors.description = 'Description is required';
  } else if (description.length < DESCRIPTION_MIN) {
    errors.description = `Description must be at least ${DESCRIPTION_MIN} characters`;
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX} characters`;
  }

  // Capacity — optional but if present must be an integer in [0, 100000].
  // Empty string / null / undefined all mean "not provided".
  if (values.capacity !== undefined && values.capacity !== null &&
      values.capacity !== '') {
    const raw = String(values.capacity).trim();
    if (!/^-?\d+$/.test(raw)) {
      errors.capacity = 'Capacity must be a whole number';
    } else {
      const n = parseInt(raw, 10);
      if (n < CAPACITY_MIN || n > CAPACITY_MAX) {
        errors.capacity = `Capacity must be between ${CAPACITY_MIN} and ${CAPACITY_MAX}`;
      }
    }
  }

  // Condition — optional but if present must be one of the enum values.
  if (values.condition && !CONDITION_VALUES.includes(values.condition)) {
    errors.condition = `Pick one of: ${CONDITION_VALUES.join(', ')}`;
  }

  return Object.keys(errors).length ? errors : null;
}

/**
 * Step 3 — Photos (file array).
 *
 * Server: 5 files max, 5 MB each, image/* mime only. We mirror those
 * rules here so the user sees friendly errors before we even hit the
 * network.
 *
 * Returns an array of error messages (one per offending file) plus an
 * optional top-level message for the over-the-cap case.
 */
export function validatePhotosStep(files) {
  const errors = [];
  const list = Array.isArray(files) ? files : [];
  const max = UPLOAD_LIMITS.MAX_FILES;
  const maxBytes = UPLOAD_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024;
  const allowed = UPLOAD_LIMITS.ACCEPTED_MIME_TYPES;

  if (list.length > max) {
    errors.push(
      `You can upload at most ${max} photos (you picked ${list.length}).`
    );
  }
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    if (!f) continue;
    if (!allowed.includes(f.type)) {
      errors.push(
        `Photo #${i + 1}: unsupported type "${f.type || 'unknown'}". Allowed: ${UPLOAD_LIMITS.ACCEPTED_EXTENSIONS}.`
      );
    }
    if (typeof f.size === 'number' && f.size > maxBytes) {
      errors.push(
        `Photo #${i + 1}: must be under ${UPLOAD_LIMITS.MAX_FILE_SIZE_MB} MB.`
      );
    }
  }
  return errors.length ? errors : null;
}

/**
 * Step 4 — Location (areaId + lng/lat).
 *
 * Server: location is OPTIONAL — an OWNER can register a resource
 * without picking a location (e.g. for distribution channels that
 * don't have a pin). areaId is optional too. When BOTH are absent
 * the resource just has no geographic hint.
 *
 * If `lng` is set without `lat` (or vice versa) it's an invalid
 * partial pin and we reject.
 */
export function validateLocationStep(values) {
  const errors = {};
  const area = values.area || {};
  const lng = area.lng;
  const lat = area.lat;

  // Partial pin is invalid — both must be present or both absent.
  const hasLng = lng !== null && lng !== undefined && lng !== '';
  const hasLat = lat !== null && lat !== undefined && lat !== '';
  if (hasLng && !hasLat) {
    errors.location = 'Pick both latitude and longitude, or neither.';
  } else if (hasLat && !hasLng) {
    errors.location = 'Pick both latitude and longitude, or neither.';
  }
  if (hasLng && hasLat) {
    const nLng = Number(lng);
    const nLat = Number(lat);
    if (!Number.isFinite(nLng) || nLng < -180 || nLng > 180) {
      errors.location = 'Longitude must be between -180 and 180';
    } else if (!Number.isFinite(nLat) || nLat < -90 || nLat > 90) {
      errors.location = 'Latitude must be between -90 and 90';
    }
  }

  return Object.keys(errors).length ? errors : null;
}

/**
 * Run all four step validators in sequence. Returns a flat
 * `{ stepId, errors }` array — the page iterates over it and pushes
 * the user back to the first failing step.
 */
export function validateAll(values, files) {
  const out = [];
  const c = validateCategoryStep(values);
  if (c) out.push({ stepId: 'category', errors: c });
  const d = validateDetailsStep(values);
  if (d) out.push({ stepId: 'details', errors: d });
  const p = validatePhotosStep(files);
  if (p) out.push({ stepId: 'photos', errors: p });
  const l = validateLocationStep(values);
  if (l) out.push({ stepId: 'location', errors: l });
  return out;
}

// ── Payload builder ─────────────────────────────────────────────────────────
// Translates the form's flat shape into the multipart `FormData` the
// server expects. Photos become `photos` parts; everything else is a
// string part. The server's multer middleware reads `photos`; the zod
// validator reads the rest.

/**
 * Build a FormData payload for POST /api/resources.
 *
 * @param {object} values  Flat form values: { category, title,
 *                         description, capacity, condition, area: {...} }
 * @param {FileList|File[]} [photos=[]] Files picked in step 3.
 * @returns {FormData}
 */
export function buildCreatePayload(values, photos = []) {
  const fd = new FormData();
  const v = values || {};

  // Required textual fields.
  if (v.category) fd.append('category', v.category);
  if (v.title) fd.append('title', String(v.title).trim());
  if (v.description) fd.append('description', String(v.description).trim());

  // Optional textual fields — append only when set so we don't ship
  // empty strings (the server validator doesn't treat '' as undefined
  // and would 400 on a non-integer capacity).
  if (v.capacity !== undefined && v.capacity !== null && v.capacity !== '') {
    fd.append('capacity', String(parseInt(v.capacity, 10)));
  }
  if (v.condition) fd.append('condition', v.condition);

  // Location — GeoJSON Point. Only sent when BOTH coords present so we
  // never hand the server a half-point.
  const area = v.area || {};
  if (area.areaId) fd.append('areaId', area.areaId);
  if (area.lng !== null && area.lng !== undefined && area.lng !== '' &&
      area.lat !== null && area.lat !== undefined && area.lat !== '') {
    const lng = Number(area.lng);
    const lat = Number(area.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      // Server expects { type: 'Point', coordinates: [lng, lat] } — JSON-encoded.
      fd.append(
        'location',
        JSON.stringify({ type: 'Point', coordinates: [lng, lat] })
      );
    }
  }

  // Photos — multipart parts named `photos` to match the multer field name
  // (middlewares/upload.js + resource.routes.js use uploadPhotos('photos')).
  const fileList = Array.isArray(photos)
    ? photos
    : photos && typeof photos.length === 'number'
    ? Array.from(photos)
    : [];
  for (const f of fileList) {
    if (f) fd.append('photos', f);
  }

  return fd;
}

// ── Default values for the whole form ───────────────────────────────────────

export function blankResourceDefaults() {
  return {
    category: '',
    title: '',
    description: '',
    capacity: '',
    condition: DEFAULT_CONDITION,
    area: {
      areaId: null,
      lng: null,
      lat: null,
      areaLabel: null,
    },
  };
}

// Re-export the categories enum for convenience so callers don't have
// to pull from two places.
export { CATEGORIES, CATEGORY_VALUES };
