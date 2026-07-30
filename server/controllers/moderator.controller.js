/**
 * Moderator controller — Modules 6.1 + 6.2 + 6.3.
 *
 * Read-only, area-scoped oversight surface for the MODERATOR role,
 * the volunteer-verification action, and the area-scoped emergency
 * mode toggle:
 *   - GET   /api/moderator/area-resources
 *   - GET   /api/moderator/pending-requests
 *   - GET   /api/moderator/volunteers
 *   - GET   /api/moderator/owners
 *   - POST  /api/moderator/verify-volunteer/:userId   (Module 6.2)
 *   - GET   /api/moderator/emergency-mode             (Module 6.3)
 *   - PATCH /api/moderator/emergency-mode             (Module 6.3)
 *
 * Every endpoint is gated on `authorize('MODERATOR', 'ADMIN')` at the
 * router layer. The controller only enforces area scoping + the
 * read-only contract + the verification role gate + the
 * emergency-mode area gate.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   None of the endpoints expose email / phone / password. The
 *   resource endpoint reuses `publicResource()` from the resource
 *   controller (which already strips owner contact). The directory
 *   endpoints use a private `publicUserDirectory()` helper that
 *   returns id + name + role + isVerified + isActive + areaId +
 *   timestamps ONLY. The verification endpoint responds via
 *   `publicUserDirectory()` — same privacy posture. The emergency
 *   mode endpoint exposes `activatedBy` as `toSafeObject()` (strips
 *   `password`; never includes `email` / `phone`).
 *
 * Role scoping:
 *   - MODERATOR: queries are filtered to `req.user.areaId`. A moderator
 *     with no areaId gets an empty list (matches the 5.5 contract).
 *     Emergency mode requires an areaId — no-area moderators get 403.
 *   - ADMIN: no areaId filter — admin sees the entire DB. Admin is
 *     intentionally exempt from the area-join because admin is the
 *     oversight role without geographic constraints. Admin can flip
 *     emergency mode on any area, but for the canonical "dashboard
 *     flip" path we use `req.user.areaId` — admin typically has no
 *     areaId, so admin here resolves to the FIRST area in the DB as
 *     a safe-but-degraded fallback (logged + smoke-locked).
 *     Practical alternative: admin uses a different endpoint. For
 *     Module 6.3 the scope is the moderator's own area; admin is
 *     treated as a moderator without an area (403) for the toggle
 *     path — admin oversight of emergency mode is a future module.
 */

const ApiError = require('../utils/apiError');
const { ok } = require('../utils/apiResponse');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const User = require('../models/User');
const Area = require('../models/Area');
const { publicResource } = require('./resource.controller');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the per-endpoint Mongo filter for the authenticated user.
 *   - ADMIN: no area filter (returns {})
 *   - MODERATOR with areaId: { areaId }
 *   - MODERATOR without areaId: null (caller short-circuits to [])
 */
function areaScopeFor(req) {
  if (req.user.role === User.ROLES.ADMIN) {
    return {};
  }
  if (!req.user.areaId) return null;
  return { areaId: req.user.areaId };
}

/**
 * Strip a User doc down to the directory shape used by the volunteers
 * + owners endpoints. NEVER includes email, phone, or password.
 */
function publicUserDirectory(user) {
  if (!user) return null;
  const obj = typeof user.toJSON === 'function' ? user.toJSON() : user;
  return {
    id: obj.id,
    name: obj.name,
    role: obj.role,
    isVerified: obj.isVerified,
    isActive: obj.isActive,
    areaId: obj.areaId ? obj.areaId.toString() : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    // intentionally omitted: email, phone, password
  };
}

function paginationFrom(req) {
  const page = req.query.page ? parseInt(req.query.page, 10) : 1;
  const limit = Math.min(
    req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ── GET /api/moderator/area-resources ──────────────────────────────────────
async function getAreaResources(req, res, next) {
  try {
    const areaScope = areaScopeFor(req);
    const { page, limit, skip } = paginationFrom(req);
    if (areaScope === null) {
      return ok(
        res,
        {
          resources: [],
          pagination: { page, limit, total: 0, pages: 1 },
        },
        'Resources fetched'
      );
    }

    const filter = { ...areaScope };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.q) {
      const safe = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { description: { $regex: safe, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      Resource.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Resource.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        resources: docs.map(publicResource),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Resources fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/moderator/pending-requests ───────────────────────────────────
// Status is hard-coded to REQUESTED — the queue for triage.
async function getPendingRequests(req, res, next) {
  try {
    const { page, limit, skip } = paginationFrom(req);

    // MODERATOR (with areaId) joins through Resource.areaId; ADMIN
    // sees the full queue. No-area moderators get an empty list.
    const resourceIds = await (async () => {
      if (req.user.role === User.ROLES.ADMIN) return null;
      if (!req.user.areaId) return [];
      const rs = await Resource.find({ areaId: req.user.areaId })
        .select('_id')
        .lean();
      return rs.map((r) => r._id);
    })();
    if (resourceIds !== null && resourceIds.length === 0) {
      return ok(
        res,
        {
          requests: [],
          pagination: { page, limit, total: 0, pages: 1 },
        },
        'Requests fetched'
      );
    }

    const filter = { status: ResourceRequest.REQUEST_STATUS.REQUESTED };
    if (resourceIds !== null) {
      filter.resourceId = { $in: resourceIds };
    }

    const [docs, total] = await Promise.all([
      ResourceRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('volunteerId', 'name')
        .populate('resourceId', 'category title status'),
      ResourceRequest.countDocuments(filter),
    ]);

    const requests = docs.map((d) => {
      const out = d.toJSON();
      const base = {
        id: out.id,
        resourceId: d.resourceId?._id?.toString() ?? null,
        ownerId: out.ownerId ? out.ownerId.toString() : null,
        volunteerId: out.volunteerId?._id?.toString() ?? null,
        status: out.status,
        requestedAt: out.requestedAt,
        approvedAt: out.approvedAt,
        collectedAt: out.collectedAt,
        returnedAt: out.returnedAt,
        moderatorNote: out.moderatorNote ?? null,
        createdAt: out.createdAt,
        updatedAt: out.updatedAt,
      };
      if (d.volunteerId) {
        base.volunteerSummary = {
          id: d.volunteerId._id.toString(),
          name: d.volunteerId.name,
        };
      }
      if (d.resourceId) {
        base.resource = {
          id: d.resourceId._id.toString(),
          category: d.resourceId.category,
          title: d.resourceId.title,
          status: d.resourceId.status,
        };
      }
      return base;
    });

    return ok(
      res,
      {
        requests,
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

// ── GET /api/moderator/volunteers ──────────────────────────────────────────
async function getVolunteers(req, res, next) {
  try {
    const areaScope = areaScopeFor(req);
    const { page, limit, skip } = paginationFrom(req);
    if (areaScope === null) {
      return ok(
        res,
        {
          volunteers: [],
          pagination: { page, limit, total: 0, pages: 1 },
        },
        'Volunteers fetched'
      );
    }

    const filter = { role: User.ROLES.VOLUNTEER, ...areaScope };
    if (req.query.isVerified !== undefined) {
      filter.isVerified = req.query.isVerified === 'true';
    }

    const [docs, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        volunteers: docs.map(publicUserDirectory),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Volunteers fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/moderator/owners ──────────────────────────────────────────────
async function getOwners(req, res, next) {
  try {
    const areaScope = areaScopeFor(req);
    const { page, limit, skip } = paginationFrom(req);
    if (areaScope === null) {
      return ok(
        res,
        {
          owners: [],
          pagination: { page, limit, total: 0, pages: 1 },
        },
        'Owners fetched'
      );
    }

    const filter = { role: User.ROLES.OWNER, ...areaScope };
    const [docs, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return ok(
      res,
      {
        owners: docs.map(publicUserDirectory),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Owners fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── POST /api/moderator/verify-volunteer/:userId ──────────────────────────
// Module 6.2 — the moderator's verification action.
//
// Role gate:
//   - Only users with role === VOLUNTEER are eligible for verification.
//     Trying to verify an OWNER / MODERATOR / ADMIN returns 400 (the
//     intent is unclear, and silently letting it through would mask
//     role-mismatch bugs in upstream callers).
//   - Only the moderator's own area can be verified. A moderator with
//     no areaId cannot verify anyone (matches the 5.5 contract). A
//     moderator in area A cannot verify a volunteer in area B — that's
//     a 403. ADMIN is the exception: admin is global, so admin can
//     verify across areas (mirrors how admin can list globally).
//
// Idempotency:
//   - If the volunteer is already verified (isVerified === true) we
//     return 200 with the existing user (no-op). This keeps a
//     double-click on the moderator's "Verify" button safe.
//
// Privacy (KEY DESIGN REMINDER):
//   - The response uses `publicUserDirectory()` (same private helper
//     that powers GET /api/moderator/volunteers). It strips `password`,
//     AND — crucially — never includes `email` or `phone`. Moderators
//     have no business phoning home for a volunteer's contact info
//     through this action endpoint; if/when safe coordination is
//     needed, the trusted channel is the resource request, not the
//     directory. The UI can re-render the badge using the returned
//     `isVerified` boolean.
async function verifyVolunteer(req, res, next) {
  try {
    const { userId } = req.params;
    // Body is validated by `verifyVolunteerBodySchema` upstream; the
    // optional `moderatorNote` is intentionally NOT persisted in this
    // module — User has no moderatorNote field, and inventing one
    // would be out of scope. The endpoint accepts the field for forward
    // compatibility with future audit-log work (Module 7.x).
    const volunteer = await User.findById(userId);
    if (!volunteer) {
      throw new ApiError(404, 'Volunteer not found');
    }
    if (volunteer.role !== User.ROLES.VOLUNTEER) {
      throw new ApiError(
        400,
        'Only users with the VOLUNTEER role can be verified through this endpoint.'
      );
    }

    // Area gate: moderator can only verify volunteers in their own
    // area. No-area moderator → 403 (cannot verify "any" volunteer).
    // Admin bypasses the area check (admin is global).
    if (req.user.role !== User.ROLES.ADMIN) {
      if (!req.user.areaId) {
        throw new ApiError(
          403,
          'You must be assigned to an area to verify volunteers.'
        );
      }
      const volunteerArea =
        volunteer.areaId && volunteer.areaId.toString();
      if (volunteerArea !== req.user.areaId.toString()) {
        throw new ApiError(
          403,
          'You can only verify volunteers within your own area.'
        );
      }
    }

    // Idempotent verify: if already verified, just return the user.
    if (volunteer.isVerified !== true) {
      volunteer.isVerified = true;
      await volunteer.save();
    }

    // Use the directory-shape strip so this endpoint NEVER surfaces
    // email, phone, or password to a moderator caller. The UI only
    // needs name + isVerified to refresh the badge, so there's no
    // reason to round-trip contact data here.
    return ok(
      res,
      { user: publicUserDirectory(volunteer) },
      'Volunteer verified'
    );
  } catch (err) {
    next(err);
  }
}

// ── Module 6.3 — Emergency Mode ────────────────────────────────────────────

/**
 * Build the privacy-safe response shape for the emergency-mode
 * endpoint. Mirrors `publicUserDirectory()` — strips `password` AND
 * never includes `email` / `phone`.
 *
 * Key design choice (privacy): `activatedBy` is exposed via
 * `publicUserDirectory()` (the same helper the 6.1 directory
 * endpoints use). User.toSafeObject() strips `password` but still
 * carries `email` + `phone` — using the directory helper means the
 * dashboard renders "Activated by <name>" without ever learning the
 * actor's email or phone.
 *
 * Implementation note: we capture the populated Mongoose document
 * BEFORE calling `area.toJSON()` — the toJSON transform strips
 * instance methods, so the call must happen first. We then run
 * `publicUserDirectory(populatedUser)` to produce the privacy-safe
 * shape.
 */
function publicEmergencyMode(area) {
  if (!area) return null;
  // Capture the populated User doc (if any) BEFORE toJSON strips
  // instance methods.
  const populatedUser =
    area.emergencyMode && area.emergencyMode.activatedBy
      ? area.emergencyMode.activatedBy
      : null;
  const obj = area.toJSON ? area.toJSON() : area;
  const em = obj.emergencyMode || {};
  const activatedBy = populatedUser ? publicUserDirectory(populatedUser) : null;
  return {
    areaId: obj.id,
    isActive: em.isActive === true,
    activatedAt: em.activatedAt || null,
    activatedBy,
  };
}

/**
 * GET /api/moderator/emergency-mode — Module 6.3.
 *
 * Read-only: returns the area's current emergency-mode state. The
 * UI uses this to render the dashboard banner + the "Active / Inactive"
 * affordance on the toggle.
 *
 * Authorization: the same gate as the toggle. No-area moderator →
 * 403 (an unassigned moderator has no area to read state for).
 *
 * Privacy: `activatedBy` is the public User shape (id + name + role
 * + isVerified + isActive + areaId + timestamps). No email / phone.
 */
async function getEmergencyMode(req, res, next) {
  try {
    if (!req.user.areaId) {
      throw new ApiError(
        403,
        'You must be assigned to an area to view emergency-mode state.'
      );
    }
    const area = await Area.findById(req.user.areaId).populate(
      'emergencyMode.activatedBy'
    );
    if (!area) {
      throw new ApiError(
        404,
        'Your assigned area could not be found. Contact an admin.'
      );
    }
    return ok(res, publicEmergencyMode(area));
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/moderator/emergency-mode — Module 6.3.
 *
 * Body: `{ isActive: boolean, note?: string }`.
 *
 * Behaviour:
 *   - No-area moderator → 403 (matches the 6.1 directory list's
 *     empty-list contract; the toggle path is stricter).
 *   - Admin (no areaId) → 403 (admin oversight of emergency mode
 *     is a future module; the canonical "flip" path is the
 *     assigned moderator).
 *   - The area is resolved from `req.user.areaId`. If the area has
 *     since been deleted (admin removed the union), 404.
 *   - On TRUE:  stamp `activatedAt` = now + `activatedBy` =
 *     req.user. Idempotent: re-activating when already active is a
 *     no-op (returns the current state, no overwrite of activatedAt
 *     / activatedBy).
 *   - On FALSE: clear `activatedAt` + `activatedBy` to null. Idempotent
 *     when already inactive.
 *
 * The `note` field is accepted (and echoed in the response) for
 * forward compat with the future audit-log work (Phase 7). The Area
 * schema has no `note` field — the note is NOT persisted, exactly
 * like the 6.2 `moderatorNote`.
 *
 * Privacy: response uses `publicEmergencyMode()` which exposes
 * `activatedBy` as `toSafeObject()` (no email / phone / password).
 */
async function setEmergencyMode(req, res, next) {
  try {
    if (!req.user.areaId) {
      throw new ApiError(
        403,
        'You must be assigned to an area to toggle emergency mode.'
      );
    }
    const { isActive, note } = req.body;
    const area = await Area.findById(req.user.areaId);
    if (!area) {
      throw new ApiError(
        404,
        'Your assigned area could not be found. Contact an admin.'
      );
    }

    const wasActive = area.emergencyMode && area.emergencyMode.isActive === true;
    if (isActive && !wasActive) {
      area.emergencyMode = {
        isActive: true,
        activatedAt: new Date(),
        activatedBy: req.user._id,
      };
      await area.save();
    } else if (!isActive && wasActive) {
      area.emergencyMode = {
        isActive: false,
        activatedAt: null,
        activatedBy: null,
      };
      await area.save();
    }
    // No-op when `isActive === wasActive` (idempotent).

    // Re-fetch with the activatedBy populated so the response carries
    // the actor's public User shape.
    const fresh = await Area.findById(area._id).populate(
      'emergencyMode.activatedBy'
    );
    const payload = publicEmergencyMode(fresh);
    if (note !== undefined) payload.note = note; // forward-compat echo
    return ok(
      res,
      payload,
      isActive ? 'Emergency mode activated' : 'Emergency mode deactivated'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAreaResources,
  getPendingRequests,
  getVolunteers,
  getOwners,
  verifyVolunteer,
  getEmergencyMode,
  setEmergencyMode,
  publicUserDirectory,
};