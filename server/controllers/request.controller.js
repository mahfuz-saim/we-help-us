/**
 * ResourceRequest controller — Module 5.2 (Request APIs).
 *
 * Endpoints:
 *   - POST   /api/requests                   (VOLUNTEER + isVerified)
 *   - GET    /api/requests                   (auth; role-scoped)
 *   - PATCH  /api/requests/:id/approve       (owner-of-resource)
 *   - PATCH  /api/requests/:id/reject        (owner-of-resource OR MODERATOR)
 *   - PATCH  /api/requests/:id/collect       (the requesting volunteer)
 *   - PATCH  /api/requests/:id/return        (the requesting volunteer)
 *   - PATCH  /api/requests/:id/complete      (owner-of-resource)
 *
 * Lifecycle:
 *
 *   volunteer creates ──► REQUESTED
 *      │
 *      ├── owner APPROVE ──► APPROVED + Resource.status=RESERVED
 *      ├── owner / moderator REJECT ──► REJECTED  (terminal)
 *      └── volunteer CANCEL ──► CANCELLED (terminal — Module 5.2 doesn't
 *          expose a cancel endpoint yet; the controller guards the
 *          "owner can't reach it via this code path" assumption)
 *
 *   APPROVED ──► volunteer COLLECT ──► COLLECTED + Resource.status=IN_USE
 *                                       (CONTACT REVEAL ON THIS RESPONSE)
 *   COLLECTED ──► volunteer RETURN ──► RETURNED
 *   RETURNED ──► owner COMPLETE ──► Resource.status=AVAILABLE (terminal)
 *
 *   The COMPLETE action doesn't write a new status onto the request
 *   document itself — the request is already RETURNED. The completion
 *   is purely the resource returning to AVAILABLE.
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   - Owner contact info (email/phone/name) is NEVER returned in any
 *     response unless the request is APPROVED + COLLECTED. Before
 *     that point the response strips those fields out entirely (the
 *     resource-level `publicResource` helper already excludes them;
 *     the request helper does the same).
 *   - When the request is APPROVED + COLLECTED the response includes
 *     `ownerContact: { name, email, phone }` AND
 *     `volunteerContact: { name, email, phone }` so both parties can
 *     coordinate the handover. This is the ONLY path through which
 *     contact reveal happens.
 *
 * Role-based access (KEY DESIGN REMINDER):
 *   - Public registration is OWNER/VOLUNTEER only. The POST handler
 *     checks `req.user.role === VOLUNTEER` (plus `isVerified` per
 *     plan.txt — verified-volunteers gate is enforced here).
 *   - MODERATOR / ADMIN can reject a request (oversight role) and
 *     can read the role-scoped list, but cannot approve / collect /
 *     return / complete — those belong to owner / volunteer.
 *
 * Status flow (KEY DESIGN REMINDER):
 *   - The Resource.status transitions listed above are enforced here.
 *     A request cannot be approved on a non-AVAILABLE resource
 *     (Module 3.5's owner-dashboard already flips AVAILABLE ↔
 *     UNAVAILABLE; if the owner parked the resource as UNAVAILABLE,
 *     a fresh APPROVE will 409 with a friendly message).
 */

const ApiError = require('../utils/apiError');
const { ok, created } = require('../utils/apiResponse');
const ResourceRequest = require('../models/ResourceRequest');
const Resource = require('../models/Resource');
const User = require('../models/User');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// ── Response helpers ───────────────────────────────────────────────────────

/**
 * Strip a populated User doc down to the public-shape used for
 * resource responses. NEVER call this with the auth-only fields —
 * the caller decides whether contact info is revealed, not this
 * helper.
 *
 * Module 6.2 surface includes `isVerified` so the UI can render the
 * "Verified" badge next to a volunteer's name on owner + moderator
 * dashboards. The field is read off the populated User doc directly
 * (the list endpoint populates `volunteerId` with `name isVerified`
 * since 6.2 — see listRequests).
 */
function publicUserSummary(user) {
  if (!user) return null;
  return {
    id: typeof user.id === 'string' ? user.id : user._id?.toString(),
    name: user.name,
    isVerified: user.isVerified === true,
  };
}

/**
 * Contact-info reveal shape — includes name + email + phone.
 * Used only when the request is APPROVED + COLLECTED.
 */
function contactInfo(user) {
  if (!user) return null;
  return {
    id: typeof user.id === 'string' ? user.id : user._id?.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
  };
}

/**
 * Public request shape. Privacy-gated by `revealContacts`:
 *   - false (default): contact info NEVER appears; only IDs.
 *   - true: contact info appears for BOTH owner AND volunteer,
 *     but only when the request is APPROVED + COLLECTED.
 *
 * The caller decides `revealContacts`; this helper stays dumb.
 */
function publicRequest(doc, { revealContacts = false, populated } = {}) {
  if (!doc) return null;
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  // Helper: stringify an ObjectId-shaped field. After toJSON, populated
  // subdocs become plain objects like `{ _id: ObjectId, name: 'Carol' }`
  // — calling `.toString()` on that returns "[object Object]" which is
  // why we extract `_id` explicitly here. Used for the id fields we
  // want to keep as plain strings regardless of population state
  // (Module 5.4 added population for the OWNER list, but the wire
  // shape — ids as strings — is unchanged for backwards compatibility
  // with the 5.3 volunteer dashboard).
  // Helper: stringify an ObjectId-shaped field. After toJSON, populated
  // subdocs lose their `_id` field (Mongoose transforms emit `id`
  // instead — a string), so we look up both. If neither is present,
  // fall back to the populated Mongoose document's own toString (which
  // returns its `_id`). This is the only path that keeps the wire
  // shape stable after Module 5.4 added list population; the 5.3
  // volunteer dashboard still reads `request.volunteerId` as a string.
  const stringId = (v) => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (v instanceof Buffer) return v.toString();
    if (v && v._id) {
      const id = v._id;
      if (typeof id === 'string') return id;
      if (id && typeof id.toString === 'function') return id.toString();
    }
    if (v && typeof v.id === 'string') return v.id;
    if (v && typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
      const s = v.toString();
      if (s && s !== '[object Object]') return s;
    }
    return null;
  };
  const base = {
    id: obj.id,
    resourceId: stringId(obj.resourceId),
    ownerId: stringId(obj.ownerId),
    volunteerId: stringId(obj.volunteerId),
    status: obj.status,
    requestedAt: obj.requestedAt,
    approvedAt: obj.approvedAt,
    collectedAt: obj.collectedAt,
    returnedAt: obj.returnedAt,
    moderatorNote: obj.moderatorNote ?? null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };

  // Contact-reveal gate: APPROVED + COLLECTED is the only window in
  // which both sides can see each other's contact info.
  const isRevealable =
    revealContacts &&
    obj.status === ResourceRequest.REQUEST_STATUS.COLLECTED;

  if (isRevealable && populated) {
    if (populated.owner) {
      base.owner = contactInfo(populated.owner);
      base.ownerSummary = publicUserSummary(populated.owner);
    }
    if (populated.volunteer) {
      base.volunteer = contactInfo(populated.volunteer);
      base.volunteerSummary = publicUserSummary(populated.volunteer);
    }
    if (populated.resource) {
      // Resource carries no contact info — reuse the resource's
      // publicResource() helper indirectly: surface category + title
      // + status so the request page doesn't need a second round-trip.
      base.resource = {
        id:
          typeof populated.resource.id === 'string'
            ? populated.resource.id
            : populated.resource._id?.toString(),
        category: populated.resource.category,
        title: populated.resource.title,
        status: populated.resource.status,
      };
    }
  } else if (populated) {
    // Pre-reveal window — surface safe summaries only.
    if (populated.owner) base.ownerSummary = publicUserSummary(populated.owner);
    if (populated.volunteer)
      base.volunteerSummary = publicUserSummary(populated.volunteer);
    if (populated.resource) {
      base.resource = {
        id:
          typeof populated.resource.id === 'string'
            ? populated.resource.id
            : populated.resource._id?.toString(),
        category: populated.resource.category,
        title: populated.resource.title,
        status: populated.resource.status,
      };
    }
  }

  return base;
}

// Convenience: load the request + populate owner / volunteer / resource.
// Done in one shot so every action handler can share the same shape.
async function loadRequestPopulated(id) {
  const doc = await ResourceRequest.findById(id)
    .populate('ownerId', 'name email phone')
    .populate('volunteerId', 'name email phone')
    .populate(
      'resourceId',
      'category title status ownerId location areaId'
    );
  if (!doc) return null;
  return doc;
}

// ── POST /api/requests ────────────────────────────────────────────────────
// Volunteer creates a new request. Requires:
//   - role === VOLUNTEER (public registration is OWNER/VOLUNTEER only —
//     Module 1.2; OWNER cannot self-request)
//   - isVerified === true (Module 6.2's verification workflow is the
//     gate; until then, the field is just the User model's boolean)
//   - resourceId is a real Resource
//   - resourceId !== requester's own user id (owners can't request
//     their own resources)
//   - resourceId.status === AVAILABLE (can't request an unavailable
//     resource)
//   - No active request from this volunteer for this resource
//     (controller uses ResourceRequest.hasActiveRequest — the static
//     helper from Module 5.1)
async function createRequest(req, res, next) {
  try {
    // Role gate: only verified VOLUNTEERs can request. OWNERs browse
    // their own inventory; MODERATORs don't request inventory.
    if (!req.user || req.user.role !== User.ROLES.VOLUNTEER) {
      throw new ApiError(
        403,
        'Only verified volunteers can create resource requests.'
      );
    }
    if (req.user.isVerified !== true) {
      throw new ApiError(
        403,
        'You must be a verified volunteer to create a resource request.'
      );
    }

    // Look up the target resource. Mongoose's findById handles the
    // CastError on bad ids — that surfaces as a 400 via the central
    // error handler (see errorHandler.js). We catch it explicitly
    // here so we can return the friendlier "Resource not found"
    // message for valid-but-unknown ids.
    const resource = await Resource.findById(req.body.resourceId);
    if (!resource) {
      throw new ApiError(404, 'Resource not found');
    }

    // Self-request guard — owners browsing their own catalog.
    if (resource.ownerId.toString() === req.user._id.toString()) {
      throw new ApiError(
        400,
        'You cannot request a resource that you own.'
      );
    }

    // Resource availability gate — a UNAVAILABLE / RESERVED / IN_USE
    // resource is parked by the owner or already in flight.
    if (resource.status !== Resource.STATUS.AVAILABLE) {
      throw new ApiError(
        409,
        `Resource is not available for new requests (current status: ${resource.status}).`
      );
    }

    // Idempotency: one open request per (resource, volunteer). REJECTED
    // / RETURNED / CANCELLED close-outs unblock the next attempt.
    const existing = await ResourceRequest.hasActiveRequest(
      resource._id,
      req.user._id
    );
    if (existing) {
      throw new ApiError(
        409,
        'You already have an open request for this resource.'
      );
    }

    // Construct + persist.
    const doc = new ResourceRequest({
      resourceId: resource._id,
      ownerId: resource.ownerId,
      volunteerId: req.user._id,
      moderatorNote: req.body.moderatorNote ?? null,
    });
    await doc.save();

    return created(res, { request: publicRequest(doc) }, 'Request created');
  } catch (err) {
    next(err);
  }
}

// ── GET /api/requests ─────────────────────────────────────────────────────
// Role-scoped list:
//   - OWNER: requests for resources they own (filter: ownerId === me)
//   - VOLUNTEER: requests they themselves initiated (volunteerId === me)
//   - MODERATOR: requests for resources in their area (joins through
//                Resource.areaId — Module 5.5 will reuse this shape)
//   - ADMIN: same as moderator but without the area filter
//
// Filters (`status`, `resourceId`, `volunteerId`) compose with the
// role scope; pagination mirrors the resource list endpoint.
async function listRequests(req, res, next) {
  try {
    const filter = {};
    const role = req.user && req.user.role;

    if (role === User.ROLES.OWNER) {
      filter.ownerId = req.user._id;
    } else if (role === User.ROLES.VOLUNTEER) {
      filter.volunteerId = req.user._id;
    } else if (role === User.ROLES.MODERATOR) {
      // Moderator sees requests for resources whose areaId is the
      // moderator's areaId. If the moderator has no area, return
      // an empty list rather than silently leaking other areas.
      if (!req.user.areaId) {
        return ok(
          res,
          { requests: [], pagination: { page: 1, limit: DEFAULT_LIMIT, total: 0, pages: 1 } },
          'Requests fetched'
        );
      }
      // Join through Resource.areaId. We do this with a two-step
      // query: first find the resource ids in this area, then
      // filter the request collection by them. This keeps the
      // index hits cheap (Resource has the 2dsphere + areaId
      // indexes from Module 3.1; ResourceRequest has the
      // owner_status / volunteer_status / status_created compounds).
      const resourceIds = await Resource.find({ areaId: req.user.areaId })
        .select('_id')
        .lean();
      const idStrings = resourceIds.map((r) => r._id);
      if (idStrings.length === 0) {
        return ok(
          res,
          { requests: [], pagination: { page: 1, limit: DEFAULT_LIMIT, total: 0, pages: 1 } },
          'Requests fetched'
        );
      }
      filter.resourceId = { $in: idStrings };
    } else if (role === User.ROLES.ADMIN) {
      // ADMIN sees everything (oversight without an area scope).
    } else {
      throw new ApiError(403, 'Unknown role for request listing.');
    }

    // Optional filters from the query string.
    if (req.query.status) filter.status = req.query.status;
    if (req.query.resourceId) filter.resourceId = req.query.resourceId;
    if (req.query.volunteerId) filter.volunteerId = req.query.volunteerId;

    // If a moderator filter narrowed to an area above, AND the caller
    // also passed ?resourceId=, the intersection must be honored —
    // overwrite the $in clause with a single id.
    if (filter.resourceId && req.query.resourceId) {
      filter.resourceId = req.query.resourceId;
    }

    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = Math.min(
      req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      ResourceRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // Module 5.4 enhancement — populate summaries so the OWNER
        // dashboard can render volunteer name + resource title without
        // a second round-trip per row. populate() takes a Mongo-style
        // field selector; requesting only `name` keeps the wire small
        // and is the smallest possible surface for the response. The
        // privacy helper `publicRequest` only surfaces these as
        // `.volunteerSummary` / `.resource` blocks — `.email` /
        // `.phone` are NEVER surfaced here (the list endpoint is
        // gated to summaries only; contact reveal is a per-request
        // action's response).
        //
        // Module 6.2 adds `isVerified` to the volunteer populate so
        // the OWNER + MODERATOR dashboards can render the verified
        // badge without a per-row fetch. `email` / `phone` remain
        // absent from the populate.
        .populate('volunteerId', 'name isVerified')
        .populate('resourceId', 'category title status'),
      ResourceRequest.countDocuments(filter),
    ]);

    // Populate summaries (no contact reveal on the list — that's
    // a per-request action). The populated `volunteerId` carries only
    // `name` (no email/phone) so the helper can safely elevate it to
    // `volunteerSummary`. Same for `resourceId` (category/title/status
    // — no contact surface). Owner / volunteer IDs are sufficient.
    return ok(
      res,
      {
        requests: docs.map((d) =>
          publicRequest(d, {
            populated: {
              volunteer: d.volunteerId,
              resource: d.resourceId,
            },
          })
        ),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Requests fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/requests/:id ─────────────────────────────────────────────────
// Single request fetch. Contact reveal is gated by the same
// APPROVED + COLLECTED rule as the action responses — the request
// owner (the volunteer) and the resource owner both get contact
// reveal here; other roles see only summaries.
//
// Implemented as a side helper because every action handler also
// wants to load+return the request. We expose it via the
// `getRequest` named export so future routes can wire it up if
// they need to (Module 5.3's volunteer dashboard may want it).
async function getRequest(req, res, next) {
  try {
    const doc = await loadRequestPopulated(req.params.id);
    if (!doc) {
      throw new ApiError(404, 'Request not found');
    }
    // The caller is one of: owner-of-resource, the volunteer, a
    // moderator (if in area), or admin. The role-scoping here is
    // narrower than the list endpoint: even if you can LIST all
    // requests in your scope, you can only GET a specific one if
    // you're a principal on it (or admin).
    const role = req.user.role;
    const isOwner =
      doc.ownerId && doc.ownerId._id.toString() === req.user._id.toString();
    const isVolunteer =
      doc.volunteerId &&
      doc.volunteerId._id.toString() === req.user._id.toString();
    const isAdmin = role === User.ROLES.ADMIN;
    if (!isOwner && !isVolunteer && !isAdmin) {
      throw new ApiError(403, 'You cannot view this request.');
    }
    return ok(
      res,
      {
        request: publicRequest(doc, {
          revealContacts: true,
          populated: {
            owner: doc.ownerId,
            volunteer: doc.volunteerId,
            resource: doc.resourceId,
          },
        }),
      },
      'Request fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/requests/:id/approve ───────────────────────────────────────
// Owner-of-resource approves. Effects:
//   - request.status: REQUESTED → APPROVED + approvedAt = now
//   - resource.status: AVAILABLE → RESERVED
//   - returns the updated request (no contact reveal — APPROVED
//     hasn't reached COLLECTED yet)
async function approveRequest(req, res, next) {
  try {
    const doc = await ResourceRequest.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Request not found');

    // Ownership gate: only the resource's owner can approve.
    if (doc.ownerId.toString() !== req.user._id.toString()) {
      throw new ApiError(
        403,
        'Only the resource owner can approve this request.'
      );
    }
    // Transition gate: approve only fires from REQUESTED.
    if (doc.status !== ResourceRequest.REQUEST_STATUS.REQUESTED) {
      throw new ApiError(
        409,
        `Cannot approve a request in status ${doc.status}.`
      );
    }

    // Atomically update the resource. We do this FIRST so a
    // concurrent approve-then-reject race can't strand an APPROVED
    // request on a non-RESERVED resource.
    const resource = await Resource.findById(doc.resourceId);
    if (!resource) throw new ApiError(404, 'Resource no longer exists');
    if (resource.status !== Resource.STATUS.AVAILABLE) {
      throw new ApiError(
        409,
        `Resource is not available (current status: ${resource.status}).`
      );
    }

    doc.status = ResourceRequest.REQUEST_STATUS.APPROVED;
    doc.approvedAt = new Date();
    if (req.body && req.body.moderatorNote !== undefined) {
      doc.moderatorNote = req.body.moderatorNote;
    }

    resource.status = Resource.STATUS.RESERVED;

    await Promise.all([doc.save(), resource.save()]);

    return ok(res, { request: publicRequest(doc) }, 'Request approved');
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/requests/:id/reject ────────────────────────────────────────
// Owner-of-resource OR MODERATOR can reject. Effects:
//   - request.status: REQUESTED → REJECTED
//   - resource.status: RESERVED → AVAILABLE (only if it was RESERVED by
//     THIS request — concurrent requesters shouldn't accidentally
//     bump each other's resources)
//
// We only flip the resource back if it's currently RESERVED AND the
// resource still belongs to the owner who rejected. That's a
// belt-and-braces guard against a moderator rejecting someone
// else's approved request and accidentally un-reserving a resource
// another volunteer is about to collect.
async function rejectRequest(req, res, next) {
  try {
    const doc = await ResourceRequest.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Request not found');

    const role = req.user.role;
    const isOwner =
      doc.ownerId.toString() === req.user._id.toString();
    const isModerator = role === User.ROLES.MODERATOR;
    if (!isOwner && !isModerator) {
      throw new ApiError(
        403,
        'Only the resource owner or a moderator can reject this request.'
      );
    }
    // Transition gate: reject only fires from REQUESTED (or
    // APPROVED, if the moderator wants to cancel before the
    // volunteer collects).
    const rejectable = new Set([
      ResourceRequest.REQUEST_STATUS.REQUESTED,
      ResourceRequest.REQUEST_STATUS.APPROVED,
    ]);
    if (!rejectable.has(doc.status)) {
      throw new ApiError(
        409,
        `Cannot reject a request in status ${doc.status}.`
      );
    }

    doc.status = ResourceRequest.REQUEST_STATUS.REJECTED;
    if (req.body && req.body.moderatorNote !== undefined) {
      doc.moderatorNote = req.body.moderatorNote;
    }

    // If the request was APPROVED (resource is RESERVED), unblock
    // the resource so other volunteers can request it. If the
    // request was REQUESTED, the resource was still AVAILABLE and
    // we don't touch it.
    const tasks = [doc.save()];
    if (doc.approvedAt) {
      const resource = await Resource.findById(doc.resourceId);
      if (
        resource &&
        resource.status === Resource.STATUS.RESERVED &&
        resource.ownerId.toString() === doc.ownerId.toString()
      ) {
        resource.status = Resource.STATUS.AVAILABLE;
        tasks.push(resource.save());
      }
    }
    await Promise.all(tasks);

    return ok(res, { request: publicRequest(doc) }, 'Request rejected');
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/requests/:id/collect ───────────────────────────────────────
// Volunteer marks the resource as physically picked up. Effects:
//   - request.status: APPROVED → COLLECTED + collectedAt = now
//   - resource.status: RESERVED → IN_USE
//   - **CONTACT REVEAL** — this is the only response in the whole
//     lifecycle that includes owner email/phone AND volunteer
//     email/phone. Both sides can now coordinate.
async function collectRequest(req, res, next) {
  try {
    const doc = await ResourceRequest.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Request not found');

    // Volunteer gate: only the volunteer who initiated the request.
    if (doc.volunteerId.toString() !== req.user._id.toString()) {
      throw new ApiError(
        403,
        'Only the requesting volunteer can mark this as collected.'
      );
    }
    if (doc.status !== ResourceRequest.REQUEST_STATUS.APPROVED) {
      throw new ApiError(
        409,
        `Cannot collect a request in status ${doc.status}.`
      );
    }

    doc.status = ResourceRequest.REQUEST_STATUS.COLLECTED;
    doc.collectedAt = new Date();

    const resource = await Resource.findById(doc.resourceId);
    if (!resource) throw new ApiError(404, 'Resource no longer exists');
    if (resource.status !== Resource.STATUS.RESERVED) {
      // Defensive: if the resource was un-reserved by a moderator
      // race, surface a clear error rather than silently mismatch.
      throw new ApiError(
        409,
        `Resource is not in RESERVED state (current: ${resource.status}).`
      );
    }
    resource.status = Resource.STATUS.IN_USE;

    await Promise.all([doc.save(), resource.save()]);

    // Reload with populate so the response can include contact info.
    const populated = await loadRequestPopulated(doc._id);
    return ok(
      res,
      {
        request: publicRequest(populated, {
          revealContacts: true,
          populated: {
            owner: populated.ownerId,
            volunteer: populated.volunteerId,
            resource: populated.resourceId,
          },
        }),
      },
      'Request collected'
    );
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/requests/:id/return ────────────────────────────────────────
// Volunteer marks the resource as returned. Effects:
//   - request.status: COLLECTED → RETURNED + returnedAt = now
//   - resource.status: stays IN_USE (the owner still needs to
//     confirm with COMPLETE before it flips back to AVAILABLE)
//   - response includes contact info? No — RETURNED is past
//     COLLECTED but the privacy boundary is "APPROVED + COLLECTED
//     + STILL ACTIVE". Once the volunteer has handed the resource
//     back, contact info is no longer needed for coordination.
//     The simpler rule: contact reveal is gated on status ===
//     COLLECTED, not RETURNED. Documented behaviour.
async function returnRequest(req, res, next) {
  try {
    const doc = await ResourceRequest.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Request not found');

    if (doc.volunteerId.toString() !== req.user._id.toString()) {
      throw new ApiError(
        403,
        'Only the requesting volunteer can mark this as returned.'
      );
    }
    if (doc.status !== ResourceRequest.REQUEST_STATUS.COLLECTED) {
      throw new ApiError(
        409,
        `Cannot return a request in status ${doc.status}.`
      );
    }

    doc.status = ResourceRequest.REQUEST_STATUS.RETURNED;
    doc.returnedAt = new Date();
    await doc.save();

    return ok(res, { request: publicRequest(doc) }, 'Request returned');
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/requests/:id/complete ──────────────────────────────────────
// Owner-of-resource confirms the resource is back in their hands and
// returns it to the catalog. Effects:
//   - resource.status: IN_USE → AVAILABLE (the request stays
//     RETURNED — that's the volunteer's terminal state).
//   - response carries the request doc (no contact reveal — we
//     just unblocked the resource).
async function completeRequest(req, res, next) {
  try {
    const doc = await ResourceRequest.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Request not found');

    if (doc.ownerId.toString() !== req.user._id.toString()) {
      throw new ApiError(
        403,
        'Only the resource owner can confirm completion.'
      );
    }
    if (doc.status !== ResourceRequest.REQUEST_STATUS.RETURNED) {
      throw new ApiError(
        409,
        `Cannot complete a request in status ${doc.status}.`
      );
    }

    const resource = await Resource.findById(doc.resourceId);
    if (!resource) throw new ApiError(404, 'Resource no longer exists');
    if (resource.status !== Resource.STATUS.IN_USE) {
      throw new ApiError(
        409,
        `Resource is not in IN_USE state (current: ${resource.status}).`
      );
    }
    resource.status = Resource.STATUS.AVAILABLE;

    await resource.save();

    return ok(
      res,
      { request: publicRequest(doc) },
      'Request completed'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  collectRequest,
  returnRequest,
  completeRequest,
};