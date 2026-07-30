/**
 * Auth middleware.
 *
 * - `protect` reads the JWT from the Authorization header (Bearer scheme),
 *   verifies it, and attaches the matching user document to `req.user`.
 *   On failure responds 401.
 * - `authorize(...roles)` is a factory: returns middleware that checks
 *   `req.user.role` is in the allowed list. On failure responds 403.
 *
 * Public registration rule (KEY DESIGN REMINDER): only OWNER and VOLUNTEER
 * can self-register. MODERATOR and ADMIN must be created via the protected
 * admin route (see controllers/admin.controller.js) or a seed script.
 */

const ApiError = require('../utils/apiError');
const { verifyJwt } = require('../utils/jwt');
const User = require('../models/User');

/**
 * Extract the raw token from the Authorization header.
 * Accepts: "Bearer <token>" (case-insensitive). Returns null if absent.
 */
function extractToken(req) {
  const header = req.headers && req.headers.authorization;
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * `protect` — must be mounted before any handler that needs an
 * authenticated user. Sets `req.user` to the full Mongoose document
 * (password excluded by schema `select: false`).
 */
async function protect(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next(new ApiError(401, 'Authentication required'));
    }
    const payload = verifyJwt(token);
    if (!payload || !payload.id) {
      return next(new ApiError(401, 'Invalid token payload'));
    }
    // .select('+isActive') would work, but `isActive` is included by default.
    const user = await User.findById(payload.id);
    if (!user) {
      return next(new ApiError(401, 'User no longer exists'));
    }
    if (!user.isActive) {
      return next(new ApiError(403, 'Account is disabled'));
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * `authorize(...roles)` — use AFTER `protect`. Returns 403 if the
 * authenticated user's role isn't in the allowed list.
 *
 * Example:
 *   router.post('/admin/...', protect, authorize('ADMIN'), handler);
 */
function authorize(...roles) {
  const allowed = roles.length > 0 ? new Set(roles) : null;
  return function authorizeMw(req, _res, next) {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }
    if (allowed && !allowed.has(req.user.role)) {
      return next(
        new ApiError(
          403,
          `Forbidden: requires role ${[...allowed].join(' or ')}`
        )
      );
    }
    return next();
  };
}

module.exports = { protect, authorize, extractToken };