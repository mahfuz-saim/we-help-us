/**
 * JWT signing / verifying helpers.
 *
 * Reads `JWT_SECRET` and `JWT_EXPIRES_IN` from env. The access token is
 * single-use over 7 days — no refresh-token system per plan.txt Module 1.2.
 *
 * In production: refuses to operate without a real JWT_SECRET.
 * In development: emits a warning and uses a deterministic dev-only fallback
 *   so the smoke tests can keep working without a server restart. The
 *   fallback also lets us seed an admin user idempotently for local dev.
 */

const jwt = require('jsonwebtoken');
const ApiError = require('./apiError');

const DEFAULT_EXPIRES_IN = '7d';
const DEV_FALLBACK_SECRET =
  'dev-only-not-for-production-we-help-us-jwt-secret';

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (isProd()) {
    throw new ApiError(
      500,
      'JWT_SECRET is not configured. Set it in the environment before starting the server.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[jwt] JWT_SECRET is not set — using DEV fallback. ' +
      'Do not ship this to production.'
  );
  return DEV_FALLBACK_SECRET;
}

function getExpiresIn() {
  return process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN;
}

/**
 * Sign a JWT containing the minimum payload the auth middleware needs:
 *   { id, role }
 * Extra claims (e.g. `isVerified`) are allowed but should not include
 * secrets.
 */
function signJwt(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(500, 'signJwt() requires a payload object');
  }
  return jwt.sign(payload, getSecret(), {
    expiresIn: getExpiresIn(),
    ...options,
  });
}

/**
 * Verify a JWT. Throws an ApiError(401) on any failure (bad signature,
 * expired, malformed). Returns the decoded payload on success.
 */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') {
    throw new ApiError(401, 'Authentication token is missing');
  }
  try {
    return jwt.verify(token, getSecret());
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Token expired');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new ApiError(401, 'Invalid token');
    }
    throw new ApiError(401, 'Could not verify token');
  }
}

module.exports = {
  signJwt,
  verifyJwt,
  DEFAULT_EXPIRES_IN,
};