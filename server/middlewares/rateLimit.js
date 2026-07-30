/**
 * Centralized rate-limiters.
 *
 * - `authLimiter` is applied to /api/auth/* routes (per Module 1.2 spec).
 * - `globalLimiter` is a soft cap on every other /api/* route.
 *
 * Both are no-ops if `DISABLE_RATE_LIMIT=1` in env (useful in tests).
 */

const rateLimit = require('express-rate-limit');

const DISABLED = process.env.DISABLE_RATE_LIMIT === '1';

function makeLimiter({ windowMs, max, message }) {
  if (DISABLED) {
    return (_req, _res, next) => next();
  }
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });
}

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window per IP for auth endpoints
  message: 'Too many auth attempts. Please try again later.',
});

const globalLimiter = makeLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 req/min per IP
  message: 'Too many requests. Please slow down.',
});

module.exports = { authLimiter, globalLimiter };
