/**
 * 404 handler. Mounted AFTER all routes.
 */
const ApiError = require('../utils/apiError');

function notFound(req, _res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;