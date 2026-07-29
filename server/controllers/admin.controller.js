/**
 * Admin controller — privileged routes (Module 1.2).
 *
 * Endpoints:
 *   - POST /api/admin/create-privileged-user
 *       ADMIN-only. The ONLY way (besides a seed script) to create
 *       MODERATOR or ADMIN accounts. Public registration can never
 *       produce a privileged role (see auth.controller.js).
 *   - GET  /api/admin/moderators
 *       ADMIN-only. Global list of every moderator account. Sort
 *       order is newest-first by createdAt. Privacy-safe: never
 *       returns email / phone / password (uses publicUserDirectory).
 *
 * The zod schema for the body restricts `role` to MODERATOR|ADMIN.
 * The route is mounted behind `protect` + `authorize('ADMIN')`.
 */

const ApiError = require('../utils/apiError');
const { created, ok } = require('../utils/apiResponse');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');
const { publicUserDirectory } = require('./moderator.controller');

const PRIVILEGED_ROLES = ['MODERATOR', 'ADMIN'];

// Local pagination helper — mirrors `paginationFrom` from
// moderator.controller.js. We duplicate rather than import so the
// admin module stays self-contained — the helper is small and the
// two callers could legitimately diverge (different limits, etc.).
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function paginationFrom(req) {
  const page = req.query.page ? parseInt(req.query.page, 10) : 1;
  const limit = Math.min(
    req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

async function createPrivilegedUser(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'ADMIN') {
      // Belt-and-braces: the route is already behind authorize('ADMIN'),
      // but explicit check here keeps the contract clear.
      throw new ApiError(403, 'Only ADMIN can create privileged users');
    }

    const { name, email, phone, password, role, location, areaId } = req.body;

    if (!PRIVILEGED_ROLES.includes(role)) {
      throw new ApiError(
        400,
        'role must be one of: ' + PRIVILEGED_ROLES.join(', ')
      );
    }

    // Pre-check duplicates to return a clean 409 (the central error
    // handler also maps E11000 → 409 but with a less specific message).
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    }).lean();
    if (existing) {
      const field =
        existing.email === email.toLowerCase() ? 'email' : 'phone';
      throw new ApiError(409, `A user with this ${field} already exists`, {
        field,
      });
    }

    const user = new User({
      name,
      email,
      phone,
      password,
      role,
      location,
      areaId: areaId || undefined,
      isVerified: true, // privileged users are verified by definition
    });

    await user.save();

    return created(
      res,
      {
        user: user.toSafeObject(),
        // Return a token so the caller can immediately use the new
        // account. They can also just have the user log in themselves.
        token: signJwt({ id: user._id.toString(), role: user.role }),
      },
      `Privileged user (${role}) created`
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/admin/moderators ──────────────────────────────────────────────
// List every moderator account on the platform. Admins are global
// (not area-scoped), so we don't filter by areaId. The list response
// uses `publicUserDirectory` so email / phone / password are NEVER
// returned — admins see only `{ id, name, role, isVerified, isActive,
// areaId, createdAt, updatedAt }`.
async function listModerators(req, res, next) {
  try {
    const { page, limit, skip } = paginationFrom(req);

    const filter = { role: User.ROLES.MODERATOR };

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
        moderators: docs.map(publicUserDirectory),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Moderators fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/admin/volunteers ──────────────────────────────────────────────
// Global volunteer directory for the admin panel. Admin is not
// area-scoped, so without an `areaId` filter this returns every
// volunteer on the platform. The optional `areaId` lets admins narrow
// to a specific district / upazila / union. The optional `isVerified`
// filter is the same shape the moderator list accepts.
//
// Privacy (KEY DESIGN REMINDER):
//   Response uses `publicUserDirectory` — NEVER includes email,
//   phone, or password. Admins get `{ id, name, role, isVerified,
//   isActive, areaId, createdAt, updatedAt }` only.
async function listVolunteers(req, res, next) {
  try {
    const { page, limit, skip } = paginationFrom(req);

    const filter = { role: User.ROLES.VOLUNTEER };
    if (req.query.areaId) filter.areaId = req.query.areaId;
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

module.exports = { createPrivilegedUser, listModerators, listVolunteers };