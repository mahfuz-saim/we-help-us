/**
 * EmergencyActivation model — Module 9 (Emergency System Rework).
 *
 * Replaces the single boolean `Area.emergencyMode.isActive` (Module
 * 6.3) with a first-class activation collection that supports:
 *
 *   - HIERARCHY scope: every area under `rootAreaId` (inclusive) is
 *     considered in emergency. The descendant set is denormalized
 *     onto the document at write time so the read path doesn't
 *     traverse the Area tree on every request.
 *
 *   - CIRCLE scope: a point + radius. Every resource (and User with a
 *     location) within the radius is in emergency. Geospatial
 *     matching is done by the read path (`server/utils/emergencyScope.js`),
 *     not by denormalizing recipient ids — the radius is a moving
 *     query, not a static set.
 *
 *   - Both modes may be active simultaneously as two separate rows
 *     (no `BOTH` enum value — same effect, simpler state machine).
 *
 *   - Actor authorization is split: VOLUNTEER (verified) can activate
 *     any ancestor of their own `User.areaId`; MODERATOR can activate
 *     only their own assigned area (or a hierarchy rooted there).
 *
 * Lifecycle:
 *   - The 6.3 back-compat shim (`PATCH /api/moderator/emergency-mode`)
 *     upserts one HIERARCHY row per `moderator.areaId`. The shim
 *     preserves the old response shape verbatim so the existing
 *     `useEmergencyMode` hook + 6.3 smoke keep working.
 *   - Deactivation is a soft delete (`isActive: false`) so audit
 *     trails + analytics history remain queryable. A future cron will
 *     hard-delete rows whose `expiresAt` is in the past and
 *     `isActive` is false (TTL is intentionally not used — TTL +
 *     partial index on the same key is unsupported in MongoDB).
 *
 * Privacy:
 *   - `message` is the volunteer's/mod's free-text description; it is
 *     intentionally NOT sanitised (phone numbers ARE the coordination
 *     channel in this context).
 *   - `activatedBy` is exposed via `publicEmergencyActivation()` as
 *     the `publicUserDirectory` shape (no email / phone / password).
 *
 * Denormalised fields at write time:
 *   - `descendantAreaIds` — `[rootAreaId, ...descendants]`. Read path
 *     uses `EmergencyActivation.find({ isActive: true,
 *     descendantAreaIds: <areaId> })` (single $in query against the
 *     sparse index) instead of walking the Area tree per resource.
 *   - `level` — the level of `rootAreaId`, captured so analytics can
 *     group / filter by activation level without re-reading Area.
 *   - `activatedByRole` — VOLUNTEER | MODERATOR (analytics will want
 *     this distinction later).
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

const SCOPES = Object.freeze({
  HIERARCHY: 'HIERARCHY',
  CIRCLE: 'CIRCLE',
});
const SCOPE_VALUES = Object.values(SCOPES);

const ACTOR_ROLES = Object.freeze({
  VOLUNTEER: 'VOLUNTEER',
  MODERATOR: 'MODERATOR',
});

const MAX_RADIUS_METERS = 50000; // 50 km — see plan §B

const emergencyActivationSchema = new mongoose.Schema(
  {
    rootAreaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
      required: [true, 'rootAreaId is required'],
      index: true,
    },

    level: {
      // Denormalised from the root area. Stored here so analytics
      // grouping doesn't need a second collection lookup.
      type: String,
      required: [true, 'level is required'],
      enum: {
        values: LEVEL_VALUES,
        message: 'level must be one of: ' + LEVEL_VALUES.join(', '),
      },
    },

    scope: {
      type: String,
      required: [true, 'scope is required'],
      enum: {
        values: SCOPE_VALUES,
        message: 'scope must be one of: ' + SCOPE_VALUES.join(', '),
      },
    },

    center: {
      // GeoJSON Point. Required for CIRCLE scope, must be absent
      // (or null) for HIERARCHY scope — enforced at the controller.
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        validate: {
          validator: (v) =>
            v == null ||
            (Array.isArray(v) &&
              v.length === 2 &&
              Number.isFinite(v[0]) &&
              Number.isFinite(v[1])),
          message: 'center.coordinates must be [lng, lat]',
        },
      },
    },

    radiusMeters: {
      type: Number,
      min: [1, 'radiusMeters must be at least 1'],
      max: [
        MAX_RADIUS_METERS,
        'radiusMeters must be at most ' + MAX_RADIUS_METERS,
      ],
      default: null,
    },

    descendantAreaIds: {
      // Denormalised at write time. Empty for CIRCLE scope (the
      // circle is dynamic, not a static subset). The sparse index
      // keeps the hot read (`EmergencyActivation.find({
      // isActive: true, descendantAreaIds: <areaId> })`) cheap.
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Area',
        },
      ],
      default: [],
    },

    message: {
      type: String,
      required: [true, 'message is required'],
      trim: true,
      minlength: [1, 'message is required'],
      maxlength: [1000, 'message must be at most 1000 characters'],
    },

    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'activatedBy is required'],
    },

    activatedByRole: {
      type: String,
      required: [true, 'activatedByRole is required'],
      enum: {
        values: Object.values(ACTOR_ROLES),
        message:
          'activatedByRole must be one of: ' +
          Object.values(ACTOR_ROLES).join(', '),
      },
    },

    activatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expiresAt: {
      // Optional auto-expiry. Soft-only: the document is flipped to
      // isActive=false on read when expiresAt < now, and a future cron
      // hard-deletes expired inactive rows. We deliberately don't use
      // a TTL index — TTL + partial index on the same key is
      // unsupported in MongoDB, and we want the partial index on
      // `isActive` for the hot path.
      type: Date,
      default: null,
      index: true,
    },

    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
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

// Hot read path: "is area X in any active emergency?". One $in query
// against the descendantAreaIds sparse index.
emergencyActivationSchema.index(
  { descendantAreaIds: 1 },
  { name: 'descendant_areas', sparse: true }
);

// Hot read path: list active activations sorted newest-first. Compound
// keeps the index small even if many historical rows accumulate.
emergencyActivationSchema.index(
  { isActive: 1, activatedAt: -1 },
  { name: 'active_recent' }
);

// CIRCLE-scope geo match: $geoWithin / $centerSphere lookups against
// the center point. HIERARCHY rows have `center.type = 'Point'` but
// no coordinates — a partial filter on `coordinates.0` keeps the
// index from refusing those rows (same pattern as User.location).
emergencyActivationSchema.index(
  { center: '2dsphere' },
  {
    name: 'geo_center',
    partialFilterExpression: { 'center.coordinates.0': { $exists: true } },
  }
);

// Per-actor lookup (used by the controller's "any active activation
// for this volunteer?" gate). Sparse — admin / other roles have no
// activations of their own.
emergencyActivationSchema.index(
  { activatedBy: 1, isActive: 1 },
  { name: 'actor_active', sparse: true }
);

// ── Static helpers ─────────────────────────────────────────────────────────
emergencyActivationSchema.statics.LEVELS = LEVELS;
emergencyActivationSchema.statics.LEVEL_VALUES = LEVEL_VALUES;
emergencyActivationSchema.statics.SCOPES = SCOPES;
emergencyActivationSchema.statics.SCOPE_VALUES = SCOPE_VALUES;
emergencyActivationSchema.statics.ACTOR_ROLES = ACTOR_ROLES;
emergencyActivationSchema.statics.MAX_RADIUS_METERS = MAX_RADIUS_METERS;

/**
 * Public, privacy-safe wire shape. Mirrors `publicUserDirectory`
 * (`server/controllers/moderator.controller.js:79-93`) for the actor.
 *
 * `center` is exposed as a plain `[lng, lat]` tuple (matches
 * `Resource.location.coordinates` and `User.location.coordinates`
 * so the client can read it uniformly).
 */
emergencyActivationSchema.statics.publicShape = function publicShape(doc) {
  if (!doc) return null;
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  const center = obj.center && Array.isArray(obj.center.coordinates)
    ? [obj.center.coordinates[0], obj.center.coordinates[1]]
    : null;
  return {
    id: obj.id,
    rootAreaId: obj.rootAreaId ? obj.rootAreaId.toString() : null,
    level: obj.level,
    scope: obj.scope,
    center,
    radiusMeters: obj.radiusMeters ?? null,
    descendantAreaIds: Array.isArray(obj.descendantAreaIds)
      ? obj.descendantAreaIds.map((id) => id.toString())
      : [],
    message: obj.message,
    activatedBy: obj.activatedBy ? obj.activatedBy.toString() : null,
    activatedByRole: obj.activatedByRole,
    activatedAt: obj.activatedAt,
    expiresAt: obj.expiresAt ?? null,
    isActive: obj.isActive === true,
  };
};

const EmergencyActivation = mongoose.model(
  'EmergencyActivation',
  emergencyActivationSchema
);

module.exports = EmergencyActivation;
module.exports.LEVELS = LEVELS;
module.exports.LEVEL_VALUES = LEVEL_VALUES;
module.exports.SCOPES = SCOPES;
module.exports.SCOPE_VALUES = SCOPE_VALUES;
module.exports.ACTOR_ROLES = ACTOR_ROLES;
module.exports.MAX_RADIUS_METERS = MAX_RADIUS_METERS;