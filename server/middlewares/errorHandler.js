/**
 * Central error handler. Mounted LAST.
 *
 * - ApiError → its statusCode + message + details
 * - Mongoose ValidationError → 400 with field list
 * - Mongoose CastError (bad ObjectId) → 400
 * - Duplicate-key (E11000) → 409
 * - JWT errors → 401
 * - Zod errors → 400 (also handled here defensively)
 * - Anything else → 500
 *
 * In production, never leak the stack trace.
 */

const ApiError = require('../utils/apiError');

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function errorHandler(err, _req, res, _next) {
  // ApiError
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Mongoose validation
  if (err && err.name === 'ValidationError' && err.errors) {
    const issues = Object.values(err.errors).map((e) => ({
      path: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      details: { issues },
    });
  }

  // Mongoose bad ObjectId
  if (err && err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid value for field: ${err.path}`,
    });
  }

  // Mongo duplicate key
  if (err && err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    return res.status(409).json({
      success: false,
      message: `Duplicate value for: ${fields.join(', ') || 'unique field'}`,
    });
  }

  // JWT
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }

  // Unknown
  // eslint-disable-next-line no-console
  console.error('[errorHandler]', err);
  return res.status(500).json({
    success: false,
    message: isProd() ? 'Internal server error' : err.message,
    ...(isProd() ? {} : { stack: err.stack }),
  });
}

module.exports = errorHandler;