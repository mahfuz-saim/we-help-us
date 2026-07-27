/**
 * Admin controller — privileged routes (Module 1.2).
 *
 * Endpoints:
 *   - POST /api/admin/create-privileged-user
 *       ADMIN-only. The ONLY way (besides a seed script) to create
 *       MODERATOR or ADMIN accounts. Public registration can never
 *       produce a privileged role (see auth.controller.js).
 *
 * The zod schema for the body restricts `role` to MODERATOR|ADMIN.
 * The route is mounted behind `protect` + `authorize('ADMIN')`.
 */

const ApiError = require('../utils/apiError');
const { created } = require('../utils/apiResponse');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');

const PRIVILEGED_ROLES = ['MODERATOR', 'ADMIN'];

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

module.exports = { createPrivilegedUser };