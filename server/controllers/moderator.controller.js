/**
 * Moderator controller — Module 6.1 (Moderator APIs).
 *
 * Read-only, area-scoped oversight surface for the MODERATOR role.
 * Four endpoints:
 *   - GET /api/moderator/area-resources
 *   - GET /api/moderator/pending-requests
 *   - GET /api/moderator/volunteers
 *   - GET /api/moderator/owners
 *
 * Every endpoint is gated on `authorize('MODERATOR', 'ADMIN')` at the
 * router layer. The controller only enforces area scoping + the
 * read-only contract.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   None of the four endpoints expose email / phone / password. The
 *   resource endpoint reuses `publicResource()` from the resource
 *   controller (which already strips owner contact). The directory
 *   endpoints use a private `publicUserDirectory()` helper that
 *   returns id + name + role + isVerified + isActive + areaId +
 *   timestamps ONLY.
 *
 * Role scoping:
 *   - MODERATOR: queries are filtered to `req.user.areaId`. A moderator
 *     with no areaId gets an empty list (matches the 5.5 contract).
 *   - ADMIN: no areaId filter — admin sees the entire DB. Admin is
 *     intentionally exempt from the area-join because admin is the
 *     oversight role without geographic constraints.
 */

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

module.exports = {
  getAreaResources,
  getPendingRequests,
  getVolunteers,
  getOwners,
  publicUserDirectory,
};