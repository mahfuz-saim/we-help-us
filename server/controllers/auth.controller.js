/**
 * Auth controller — public endpoints (Module 1.2).
 *
 * Endpoints:
 *   - register  : POST /api/auth/register  (rate-limited)
 *   - login     : POST /api/auth/login     (rate-limited)
 *   - logout    : POST /api/auth/logout    (auth required)
 *   - me        : GET  /api/auth/me        (auth required)
 *
 * Design rules baked in:
 *   - Public registration accepts only OWNER / VOLUNTEER (zod schema).
 *     The controller is also defensive: even if the schema is bypassed,
 *     it explicitly maps any non-public role to a 400.
 *   - Password hashing is handled by the User model's pre-save hook.
 *   - JWT is single-access-token with 7-day expiry (no refresh system).
 *   - `/auth/logout` is stateless for now (Module 7 can add a token
 *     blacklist if needed). The endpoint exists so the client has a
 *     consistent API surface.
 */

const ApiError = require('../utils/apiError');
const { ok, created } = require('../utils/apiResponse');
const User = require('../models/User');
const { signJwt } = require('../utils/jwt');

const PUBLIC_ROLES = User.PUBLIC_REGISTRATION_ROLES;

/**
 * Build the response payload for a successful login/register.
 * Strips the password via the User model's `toJSON` transform.
 */
function authPayload(user) {
  return {
    user: user.toSafeObject(),
    token: signJwt({ id: user._id.toString(), role: user.role }),
  };
}

// ── POST /api/auth/register ────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, phone, password, location, areaId } = req.body;

    // Defense in depth: even if the zod schema is loosened, never accept
    // a privileged role from a public endpoint. The schema already enforces
    // this; the explicit check is here so future refactors can't widen it
    // accidentally.
    const requestedRole = req.body.role || User.ROLES.OWNER;
    if (!PUBLIC_ROLES.includes(requestedRole)) {
      throw new ApiError(
        400,
        'role must be one of: ' + PUBLIC_ROLES.join(', ') +
          ' (public registration does not allow privileged roles)'
      );
    }

    // Pre-check duplicates so we can return 409 with a friendly field name
    // (Mongoose throws E11000 too, but the field name lives inside
    // err.keyValue and the central error handler already maps that).
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
      role: requestedRole,
      // Only persist `location` when coordinates were actually provided.
      // The 2dsphere index rejects `{ type: 'Point' }` documents that lack
      // coordinates (Mongoose doesn't auto-set `type` without a default,
      // and we want missing-location users to be fully omitted instead).
      ...(location && Array.isArray(location.coordinates) && location.coordinates.length === 2
        ? { location: { type: 'Point', coordinates: location.coordinates } }
        : {}),
      areaId: areaId || undefined,
    });

    await user.save(); // triggers pre-save password hashing

    // Don't echo back the JWT in the body unless the client asked for it.
    // Always include the user object so the client can hydrate state.
    return created(
      res,
      { user: user.toSafeObject(), token: authPayload(user).token },
      'Account created'
    );
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ───────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, phone, password } = req.body;
    if (!email && !phone) {
      throw new ApiError(400, 'email or phone is required');
    }

    // Build the query. We use .select('+password') because the User schema
    // sets `select: false` on password — we explicitly need it here to
    // compare. Email match is case-insensitive thanks to schema lowercase.
    const query = email ? { email: email.toLowerCase() } : { phone };
    const user = await User.findOne(query).select('+password');
    if (!user) {
      throw new ApiError(401, 'Invalid credentials');
    }
    if (!user.isActive) {
      throw new ApiError(403, 'Account is disabled');
    }

    const okPwd = await user.comparePassword(password);
    if (!okPwd) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Update lastLoginAt (best-effort, don't fail login if write fails).
    user.lastLoginAt = new Date();
    user.save().catch(() => {});

    return ok(res, authPayload(user), 'Logged in');
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ──────────────────────────────────────────────────
async function logout(_req, res, _next) {
  // Stateless JWT — the client drops the token. Returning a structured
  // response makes the client contract explicit. Module 7.4 may add a
  // token blacklist; for now this is a no-op on the server.
  return ok(res, null, 'Logged out');
}

// ── GET /api/auth/me ───────────────────────────────────────────────────────
async function me(req, res, next) {
  try {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required');
    }
    return ok(res, { user: req.user.toSafeObject() });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, logout, me };