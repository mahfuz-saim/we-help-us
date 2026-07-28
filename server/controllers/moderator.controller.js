/**
 * Moderator controller — Modules 6.1 + 6.2.
 *
 * Read-only, area-scoped oversight surface for the MODERATOR role
 * plus the volunteer-verification action:
 *   - GET  /api/moderator/area-resources
 *   - GET  /api/moderator/pending-requests
 *   - GET  /api/moderator/volunteers
 *   - GET  /api/moderator/owners
 *   - POST /api/moderator/verify-volunteer/:userId   (Module 6.2)
 *
 * Every endpoint is gated on `authorize('MODERATOR', 'ADMIN')` at the
 * router layer. The controller only enforces area scoping + the
 * read-only contract + the verification role gate.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   None of the five endpoints expose email / phone / password. The
 *   resource endpoint reuses `publicResource()` from the resource
 *   controller (which already strips owner contact). The directory
 *   endpoints use a private `publicUserDirectory()` helper that
 *   returns id + name + role + isVerified + isActive + areaId +
 *   timestamps ONLY. The verification endpoint responds via
 *   `toSafeObject()`, which strips `password`; `isVerified` IS
 *   exposed so the UI can render the verified badge next to the
 *   volunteer's name.
 *
 * Role scoping:
 *   - MODERATOR: queries are filtered to `req.user.areaId`. A moderator
 *     with no areaId gets an empty list (matches the 5.5 contract).
 *   - ADMIN: no areaId filter — admin sees the entire DB. Admin is
 *     intentionally exempt from the area-join because admin is the
 *     oversight role without geographic constraints.
 */

const ApiError = require('../utils/apiError');
const { ok } = require('../utils/apiResponse');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const User = require('../models/User');
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

module.exports = {
  getAreaResources,
  getPendingRequests,
  getVolunteers,
  getOwners,
  verifyVolunteer,
  publicUserDirectory,
};