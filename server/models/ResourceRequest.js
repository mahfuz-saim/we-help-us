/**
 * ResourceRequest model — We Help Us
 *
 * Spec (plan.txt → Module 5.1):
 *   - resourceId (ref Resource)
 *   - ownerId    (ref User — the resource's owner)
 *   - volunteerId (ref User — the volunteer who initiated the request)
 *   - status: REQUESTED|APPROVED|REJECTED|COLLECTED|RETURNED|CANCELLED
 *   - requestedAt, approvedAt, collectedAt, returnedAt (timestamps)
 *   - moderatorNote (optional)
 *
 * The actual lifecycle endpoints (POST /api/requests, approve/reject,
 * collect/return/complete) and the status transitions on the
 * `Resource` doc itself land in Module 5.2. Module 5.1 only ships
 * the schema + index wiring.
 *
 * Design reminders baked into this model:
 *   - **Privacy**: this collection intentionally does NOT denormalize
 *     the resource's contact details or the owner's contact info. We
 *     store IDs only (resourceId / ownerId / volunteerId). Module 5.2
 *     gates full contact reveal on APPROVED + COLLECTED — and does
 *     that at the response layer, never on the document itself.
 *   - **Status flow**: this collection carries its own lifecycle.
 *     REQUESTED is the entry state set when the volunteer creates
 *     the request. APPROVED moves it forward (owner consent) and
 *     also flips the Resource.status to RESERVED. REJECTED /
 *     CANCELLED are terminal-failure states. COLLECTED is when the
 *     volunteer physically picks up the resource (Resource.status
 *     becomes IN_USE, contact reveal triggers). RETURNED is when
 *     the volunteer brings it back. The COMPLETE action lives on
 *     the Resource (Module 5.2's PATCH /:id/complete) — at that
 *     point Resource.status returns to AVAILABLE. Note that
 *     `RETURNED` here is "volunteer returned the resource", which
 *     precedes the owner's "complete" confirmation. The status
 *     enum defined here matches plan.txt literally.
 *   - **Geospatial**: this collection does NOT carry a GeoJSON Point
 *     or a 2dsphere index. The associated Resource already has one,
 *     and Module 5.2's "moderator sees all in area" query joins
 *     through resourceId → Resource.areaId / Resource.location.
 *   - **Idempotency / duplication**: a unique compound index on
 *     (resourceId, volunteerId) restricted to the active status set
 *     (REQUESTED | APPROVED | COLLECTED) prevents a single volunteer
 *     from holding two parallel open requests for the same resource.
 *     Implementation note: MongoDB partial indexes use a `$exists`
 *     filter rather than a status-set membership check, so we
 *     approximate it with a non-unique compound index plus a static
 *     helper (`hasActiveRequest`) that the controller will call in
 *     5.2. That's a deliberate tradeoff — the controller-level
 *     check is what we'd reach for anyway (we want a friendly 409
 *     "You already have an open request for this resource" message).
 *
 * Note: this module only ships the schema. The route handlers,
 * controller logic, and request-status transitions on the Resource
 * doc land in Module 5.2.
 */

const mongoose = require('mongoose');

// Request lifecycle. The order is canonical: a request moves forward
// through REQUESTED → APPROVED → COLLECTED → RETURNED, with REJECTED /
// CANCELLED as terminal branches off the REQUESTED state. Module 5.2's
// controller enforces the transitions; the schema only validates the
// value is one of these six.
const REQUEST_STATUS = Object.freeze({
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COLLECTED: 'COLLECTED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
});

const REQUEST_STATUS_VALUES = Object.values(REQUEST_STATUS);

// "Active" = the request is still in-flight and should block a fresh
// request from the same volunteer. Used by Module 5.2's controller via
// the static helper below.
const ACTIVE_REQUEST_STATUSES = Object.freeze([
  REQUEST_STATUS.REQUESTED,
  REQUEST_STATUS.APPROVED,
  REQUEST_STATUS.COLLECTED,
]);

// Lifecycle timestamps. Stored alongside `status` so the timeline is
// reproducible from the document alone (no need to join an audit log).
// We use `null` as the "not happened yet" sentinel; Module 5.2 sets
// the corresponding timestamp when the controller transitions the
// status.
const resourceRequestSchema = new mongoose.Schema(
  {
    resourceId: {
      // The Resource being requested. Required at creation. Cascade
      // delete is intentionally NOT configured — if a Resource is
      // removed we want a soft record of who had asked for it. The
      // controller layer in 5.2 surfaces "Resource no longer exists"
      // rather than a silent cascade.
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'resourceId is required'],
      index: true,
    },

    ownerId: {
      // Denormalized ownerId (copy of Resource.ownerId at request time)
      // so the moderator dashboard query in 5.5 / 6.x doesn't have to
      // join through Resource. Required — a request without an owner
      // is meaningless.
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId is required'],
      index: true,
    },

    volunteerId: {
      // The volunteer who initiated the request. Public registration
      // (Module 1.2) only allows OWNER + VOLUNTEER, and Module 5.2's
      // POST handler will additionally require the volunteer to be
      // `isVerified` (Module 6.2's verification workflow).
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'volunteerId is required'],
      index: true,
    },

    status: {
      // See REQUEST_STATUS above. New requests default to REQUESTED.
      // Module 5.2's controller manages the transitions; the schema
      // here only validates that the value is in the enum.
      type: String,
      enum: {
        values: REQUEST_STATUS_VALUES,
        message:
          'status must be one of: ' + REQUEST_STATUS_VALUES.join(', '),
      },
      default: REQUEST_STATUS.REQUESTED,
      required: true,
      index: true,
    },

    // The four lifecycle timestamps. All default to null and are
    // set by Module 5.2's controller as the status moves through
    // the lifecycle. We use `null` (not `undefined`) so the field
    // is present on every document — that makes the toJSON output
    // shape stable for the client dashboards in 5.3 / 5.4 / 5.5.
    requestedAt: {
      type: Date,
      default: () => new Date(), // set on creation
      required: true,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    collectedAt: {
      type: Date,
      default: null,
    },

    returnedAt: {
      type: Date,
      default: null,
    },

    moderatorNote: {
      // Optional free-text annotation set by moderators (rejection
      // reasons, override notes, etc.). Capped at a generous 1000
      // characters — long enough for a paragraph, short enough to
      // prevent abuse via the POST body.
      type: String,
      default: null,
      trim: true,
      maxlength: [1000, 'moderatorNote must be at most 1000 characters'],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt — set automatically by Mongoose.
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
// Compound (resourceId, volunteerId) so Module 5.2's "does this
// volunteer already have an open request for this resource?" check
// is a single index hit. We deliberately do NOT mark it unique —
// the active-status filter is a controller-level concern (see
// the static helper below) so the DB stays writable across
// re-requests after a REJECTED / CANCELLED / RETURNED close-out.
resourceRequestSchema.index(
  { resourceId: 1, volunteerId: 1 },
  { name: 'resource_volunteer' }
);

// Compound (ownerId, status) for Module 5.4's "incoming requests"
// dashboard — owner sees all open + closed requests for their
// resources, status is the first filter applied.
resourceRequestSchema.index(
  { ownerId: 1, status: 1 },
  { name: 'owner_status' }
);

// Compound (volunteerId, status) for Module 5.3's "my requests"
// dashboard — volunteer sees their own history filtered by status.
resourceRequestSchema.index(
  { volunteerId: 1, status: 1 },
  { name: 'volunteer_status' }
);

// Compound (status, createdAt) for Module 5.5's moderator queue —
// "newest pending requests first" without an extra sort stage.
resourceRequestSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'status_created' }
);

// ── Static helpers ─────────────────────────────────────────────────────────
// Active-status membership — used by Module 5.2's POST handler to
// reject duplicate open requests with a friendly 409.
resourceRequestSchema.statics.REQUEST_STATUS = REQUEST_STATUS;
resourceRequestSchema.statics.REQUEST_STATUS_VALUES = REQUEST_STATUS_VALUES;
resourceRequestSchema.statics.ACTIVE_REQUEST_STATUSES = ACTIVE_REQUEST_STATUSES;

resourceRequestSchema.statics.isActiveStatus = function isActiveStatus(status) {
  return ACTIVE_REQUEST_STATUSES.includes(status);
};

// `hasActiveRequest` — controller helper for Module 5.2. Returns the
// matching open request doc, or null. Kept on the model so the
// active-status set can never drift between the controller and the
// schema. Implemented as a statics method so it composes cleanly
// with the existing query patterns (`.findOne(...).lean()`).
resourceRequestSchema.statics.hasActiveRequest = function hasActiveRequest(
  resourceId,
  volunteerId
) {
  return this.findOne({
    resourceId,
    volunteerId,
    status: { $in: ACTIVE_REQUEST_STATUSES },
  });
};

const ResourceRequest = mongoose.model('ResourceRequest', resourceRequestSchema);

module.exports = ResourceRequest;
module.exports.REQUEST_STATUS = REQUEST_STATUS;
module.exports.REQUEST_STATUS_VALUES = REQUEST_STATUS_VALUES;
module.exports.ACTIVE_REQUEST_STATUSES = ACTIVE_REQUEST_STATUSES;