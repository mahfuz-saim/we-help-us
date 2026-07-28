/**
 * Resource model — We Help Us
 *
 * Spec (plan.txt → Module 3.1):
 *   - ownerId, category, title, description, photos[] (max 5 items),
 *     capacity, condition, status (AVAILABLE|RESERVED|IN_USE|UNAVAILABLE),
 *     location (GeoJSON Point), areaId, createdAt
 *   - Add 2dsphere index on location
 *
 * Module 3.2 will mount the CRUD endpoints. Module 3.3 will promote the
 * `category` enum to a shared constants file (with icon mappings). For
 * 3.1 the enum is defined inline here using the 6 categories listed in
 * 3.3's spec — 3.3 can re-export them without changing the schema.
 *
 * Design reminders baked into this model:
 *   - **Privacy**: owner contact info (phone/email) is NEVER stored on
 *     this collection — only ownerId. The resource-listing endpoints in
 *     Module 3.2/4.1 deliberately exclude owner fields; full contact
 *     reveal is gated by the request lifecycle in Module 5.2 (only after
 *     APPROVED + COLLECTED).
 *   - **Status flow**: AVAILABLE → RESERVED → IN_USE → AVAILABLE (after
 *     return). The enum is fixed here; the controller-level transitions
 *     land in Module 5.2. `RESERVED` is set when a request is APPROVED
 *     but not yet collected; `IN_USE` is set at COLLECTED.
 *   - **Geospatial**: `location` is a GeoJSON Point just like User.location.
 *     2dsphere is sparse so docs without a location (e.g. a draft
 *     resource created before the owner pins it) don't break the index.
 *   - **Photo uploads**: enforced at the API layer (5 files × 5MB,
 *     image-only — see middlewares/upload.js). The schema enforces the
 *     per-document cap of 5 via validators.maxlength on `photos`.
 *   - **Capacity**: optional, numeric, non-negative. A "vehicle" might
 *     have capacity 7, a "first-aid kit" might omit it. The list view
 *     in 4.1 sorts by capacity when the user filters for it.
 *
 * Note: this module only ships the schema. The actual CRUD endpoints,
 * Cloudinary upload, and nearby search land in Module 3.2.
 */

const mongoose = require('mongoose');

// ── Enums ──────────────────────────────────────────────────────────────────

// Categories. 3.3 will move these into a shared constants file along
// with emoji + Leaflet icon mappings. The string values must stay
// stable across that refactor — they're part of the on-disk contract.
const CATEGORIES = Object.freeze({
  TRANSPORTATION: 'TRANSPORTATION',
  RESCUE_EQUIPMENT: 'RESCUE_EQUIPMENT',
  MEDICAL: 'MEDICAL',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  UTILITIES: 'UTILITIES',
  SKILLED_PROFESSIONALS: 'SKILLED_PROFESSIONALS',
});

const CATEGORY_VALUES = Object.values(CATEGORIES);

// Status reflects the lifecycle. The transitions are enforced by the
// request controller in Module 5.2 — the schema only validates that
// the value is one of these four.
const STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  IN_USE: 'IN_USE',
  UNAVAILABLE: 'UNAVAILABLE',
});

const STATUS_VALUES = Object.values(STATUS);

// Physical condition of the resource. Optional but recommended so
// volunteers can filter for "good" items during a crisis.
const CONDITIONS = Object.freeze({
  NEW: 'NEW',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  NEEDS_REPAIR: 'NEEDS_REPAIR',
});

const CONDITION_VALUES = Object.values(CONDITIONS);

const MAX_PHOTOS = 5;

const resourceSchema = new mongoose.Schema(
  {
    ownerId: {
      // The User who registered this resource. Only OWNERs can register
      // (Module 1.2 restricts public registration to OWNER/VOLUNTEER
      // and Module 3.2's POST handler will check that the caller is an
      // OWNER and that ownerId === req.user.id).
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId is required'],
      index: true,
    },

    category: {
      // See CATEGORIES above. Module 3.3 will add emoji + Leaflet icon
      // mappings, but the schema value stays the same.
      type: String,
      required: [true, 'category is required'],
      enum: {
        values: CATEGORY_VALUES,
        message: 'category must be one of: ' + CATEGORY_VALUES.join(', '),
      },
    },

    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      minlength: [2, 'title must be at least 2 characters'],
      maxlength: [120, 'title must be at most 120 characters'],
    },

    description: {
      type: String,
      required: [true, 'description is required'],
      trim: true,
      minlength: [10, 'description must be at least 10 characters'],
      maxlength: [2000, 'description must be at most 2000 characters'],
    },

    photos: {
      // URLs returned by Cloudinary (Module 3.2). The upload pipeline
      // enforces 5 files / 5MB each at the API layer; the schema caps
      // the array length at 5 so a direct DB write can't bypass it.
      type: [
        {
          url: { type: String, required: true, trim: true },
          publicId: { type: String, required: true, trim: true },
        },
      ],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= MAX_PHOTOS,
        message: `photos can contain at most ${MAX_PHOTOS} items`,
      },
    },

    capacity: {
      // Optional. For vehicles: passenger count. For shelters: people
      // supported. For equipment: units (e.g. "10 blankets"). Omitted
      // for resources where the concept doesn't apply.
      type: Number,
      min: [0, 'capacity cannot be negative'],
      max: [100000, 'capacity is unrealistically large'],
      default: null,
    },

    condition: {
      type: String,
      enum: {
        values: CONDITION_VALUES,
        message: 'condition must be one of: ' + CONDITION_VALUES.join(', '),
      },
      default: CONDITIONS.GOOD,
    },

    status: {
      // See STATUS above. New resources default to AVAILABLE — the
      // owner can flip to UNAVAILABLE via the dashboard (3.5); RESERVED
      // and IN_USE are set automatically by the request controller (5.2).
      type: String,
      enum: {
        values: STATUS_VALUES,
        message: 'status must be one of: ' + STATUS_VALUES.join(', '),
      },
      default: STATUS.AVAILABLE,
      required: true,
      index: true,
    },

    areaId: {
      // Reference to Area (Module 2.1). Stores the lowest level the
      // owner picked (typically a union or village). The cascading
      // selector in 3.4 will populate this.
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
      default: null,
      index: true,
    },

    location: {
      // Optional at creation time so the owner can sketch a resource
      // and finish the location later. Same GeoJSON Point shape as
      // User.location — and the same reason for NOT setting a default
      // on the inner `type` field (the 2dsphere index would otherwise
      // reject empty points).
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        validate: {
          validator: (arr) =>
            arr === undefined ||
            arr === null ||
            (Array.isArray(arr) &&
              arr.length === 2 &&
              Number.isFinite(arr[0]) &&
              Number.isFinite(arr[1]) &&
              arr[0] >= -180 &&
              arr[0] <= 180 &&
              arr[1] >= -90 &&
              arr[1] <= 90),
          message:
            'location.coordinates must be [lng, lat] within valid ranges',
        },
      },
    },
  },
  {
    timestamps: true, // createdAt, updatedAt — used by the "last updated" badge in 4.2
    toJSON: {
      virtuals: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: false },
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
// 2dsphere index on location — powers the nearby-search endpoint
// (Module 3.2's GET /api/resources/nearby) and the map view in 4.3.
// `sparse: true` so docs without a location don't break the index
// (same pattern User.js / Area.js use).
resourceSchema.index(
  { location: '2dsphere' },
  { name: 'geo_location', sparse: true }
);

// Compound index for the search/list endpoint (3.2 / 4.1). The most
// common filter is "give me available resources in this category in
// this area" — the compound keeps it cheap.
resourceSchema.index(
  { status: 1, category: 1, areaId: 1 },
  { name: 'status_category_area' }
);

// ownerId-only index is implicit via the `index: true` on the field.

// ── Static helpers ─────────────────────────────────────────────────────────
// Exposed on the model so the controller / validators / front-end
// (via a future constants file) can never drift apart.
resourceSchema.statics.CATEGORIES = CATEGORIES;
resourceSchema.statics.CATEGORY_VALUES = CATEGORY_VALUES;
resourceSchema.statics.STATUS = STATUS;
resourceSchema.statics.STATUS_VALUES = STATUS_VALUES;
resourceSchema.statics.CONDITIONS = CONDITIONS;
resourceSchema.statics.CONDITION_VALUES = CONDITION_VALUES;
resourceSchema.statics.MAX_PHOTOS = MAX_PHOTOS;

const Resource = mongoose.model('Resource', resourceSchema);

module.exports = Resource;
module.exports.CATEGORIES = CATEGORIES;
module.exports.CATEGORY_VALUES = CATEGORY_VALUES;
module.exports.STATUS = STATUS;
module.exports.STATUS_VALUES = STATUS_VALUES;
module.exports.CONDITIONS = CONDITIONS;
module.exports.CONDITION_VALUES = CONDITION_VALUES;
module.exports.MAX_PHOTOS = MAX_PHOTOS;
