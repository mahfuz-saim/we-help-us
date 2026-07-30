/**
 * Area model — We Help Us
 *
 * Spec (plan.txt → Module 2.1):
 *   - Country, district, upazila, union, ward, village, boundary
 *   - Seed Bangladesh administrative hierarchy
 *   - GET /api/areas (cascading dropdown)
 *
 * Module 6.3 (Emergency Mode) adds a per-area emergency flag:
 *   - emergencyMode.isActive      — boolean, true while the area is
 *     in crisis-activation mode
 *   - emergencyMode.activatedAt   — Date, when the flag was last
 *     flipped to true (null while inactive)
 *   - emergencyMode.activatedBy   — ObjectId ref User, the moderator
 *     (or admin) who flipped the flag on
 *
 * The flag is intentionally per-area (NOT global). When a moderator
 * toggles emergency mode for their area, the dashboard switches to a
 * response-focused view for that area; other areas are unaffected.
 *
 * Design choice (cascading-friendly):
 *   Each Area document represents ONE node in the hierarchy. The
 *   `level` enum records where it sits; `parentId` points to the
 *   containing node (null for top-level districts). A cascading UI
 *   queries by `parent=<id>` + `level` to fetch the next slice.
 *
 *   The spec lists "country, district, upazila, union, ward, village"
 *   as fields — these are captured by the `country` field (always
 *   "Bangladesh" for now) and the `level` enum. We deliberately do
 *   NOT model Bangladesh's "division" tier above district: the spec
 *   cascades district → upazila → union → ward → village, so the
 *   top of our hierarchy is the district level.
 *
 *   Boundary polygons are optional (GeoJSON Polygon) — the seed ships
 *   without them for now, but the schema + 2dsphere index are wired
 *   so Module 4.3 (interactive map) can populate them later.
 *
 * Design reminders baked in:
 *   - **Geospatial**: `boundary` is GeoJSON Polygon with a sparse
 *     2dsphere index. Documents without a boundary are skipped by the
 *     index — same pattern User.js uses for `location`.
 *   - **Privacy**: areas are reference data, not user data. No PII
 *     lives on this collection. The `emergencyMode.activatedBy` field
 *     references a User doc; the controller exposes it as
 *     `toSafeObject()` (strips password; never email/phone).
 *   - **Cascading**: indexes on `parentId` and `(level, parentId)`
 *     keep the dropdown queries cheap even with 80k villages seeded.
 */

const mongoose = require('mongoose');

const LEVELS = Object.freeze({
  DISTRICT: 'DISTRICT',
  UPAZILA: 'UPAZILA',
  UNION: 'UNION',
  WARD: 'WARD',
  VILLAGE: 'VILLAGE',
});

const LEVEL_VALUES = Object.values(LEVELS);

const DEFAULT_COUNTRY = 'Bangladesh';

const areaSchema = new mongoose.Schema(
  {
    country: {
      // Currently only Bangladesh is supported. The field is here so
      // future expansion (India, Nepal, etc.) doesn't require a
      // schema migration.
      type: String,
      required: [true, 'country is required'],
      trim: true,
      default: DEFAULT_COUNTRY,
    },

    level: {
      type: String,
      required: [true, 'level is required'],
      enum: {
        values: LEVEL_VALUES,
        message: 'level must be one of: ' + LEVEL_VALUES.join(', '),
      },
      index: true,
    },

    name: {
      // The display name at this level — e.g. "Dhaka", "Gulshan",
      // "Mirpur". Trimmed + required.
      type: String,
      required: [true, 'name is required'],
      trim: true,
      maxlength: [120, 'name is too long'],
    },

    parentId: {
      // ObjectId ref Area — null/omitted for top-level (DISTRICT)
      // nodes. The `ref` lets Mongoose populate() resolve the chain.
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
      default: null,
      index: true,
    },

    boundary: {
      // Optional GeoJSON Polygon. The 2dsphere index is sparse, so
      // docs without a boundary don't break the index (same pattern
      // as User.location).
      type: {
        type: String,
        enum: ['Polygon'],
      },
      coordinates: {
        type: [[[Number]]], // [[lng, lat], [lng, lat], ...] (rings)
      },
    },

    emergencyMode: {
      // Module 6.3 — per-area emergency-activation flag. Subdocument
      // (rather than separate fields) so the inactive state is a
      // single `isActive: false` default and the activatedAt /
      // activatedBy fields are atomically cleared together when the
      // moderator toggles back to inactive.
      //
      // The flag is per-area, not global. A moderator in area A
      // activating emergency mode leaves area B's flag untouched.
      isActive: {
        type: Boolean,
        default: false,
      },
      activatedAt: {
        // Date the flag was last flipped to true. null while inactive
        // (so the dashboard can show "Activated never" / "Last
        // activated <date>" without a sentinel).
        type: Date,
        default: null,
      },
      activatedBy: {
        // ObjectId ref User (the moderator or admin who flipped the
        // flag). The controller surfaces this as the user's
        // `toSafeObject()` — see privacy stance in the controller.
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
  },
  {
    timestamps: true,
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
// Cascading dropdown queries look up children of a given parent at a
// given level (e.g. "give me all UPAZILAs whose parentId = <district>").
// Compound index makes that O(log n) without scanning the whole
// collection. The parentId-only index covers queries that omit `level`.
areaSchema.index({ level: 1, parentId: 1 }, { name: 'level_parent' });

// Prevent the same (country, level, parent, name) combination from
// being inserted twice. Top-level districts have parentId = null; the
// partial-filter keeps that case working while still blocking e.g.
// two "Dhaka" districts under the same country.
//
// Note: MongoDB partial indexes + null field values are a known sharp
// edge. We use parentId: null explicitly in the seed/controller so the
// unique rule applies to top-level nodes too. Without a partial
// filter the unique rule still treats `null` as a value, which is the
// desired behaviour here.
areaSchema.index(
  { country: 1, level: 1, parentId: 1, name: 1 },
  {
    name: 'unique_country_level_parent_name',
    unique: true,
  }
);

// Sparse 2dsphere index on boundary — same rationale as User.location:
// docs without a polygon don't carry coordinates, so we let the
// index skip them rather than reject the document.
areaSchema.index(
  { boundary: '2dsphere' },
  { name: 'geo_boundary', sparse: true }
);

// Module 6.3 — partial index on emergencyMode.isActive. Used by the
// future dashboard banner ("how many areas are currently in
// emergency mode") + any admin-side oversight listing. Partial
// because the dashboard cares about `isActive: true` rows only;
// inactive rows stay out of the index to keep it small.
areaSchema.index(
  { 'emergencyMode.isActive': 1 },
  {
    name: 'emergency_active',
    partialFilterExpression: { 'emergencyMode.isActive': true },
  }
);

// ── Static helpers ─────────────────────────────────────────────────────────
areaSchema.statics.LEVELS = LEVELS;
areaSchema.statics.LEVEL_VALUES = LEVEL_VALUES;
areaSchema.statics.DEFAULT_COUNTRY = DEFAULT_COUNTRY;

const Area = mongoose.model('Area', areaSchema);

module.exports = Area;
module.exports.LEVELS = LEVELS;
module.exports.LEVEL_VALUES = LEVEL_VALUES;
module.exports.DEFAULT_COUNTRY = DEFAULT_COUNTRY;