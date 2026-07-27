/**
 * asyncHandler — wraps async route handlers so thrown errors propagate to
 * the central error middleware instead of becoming unhandled rejections.
 *
 * Usage:
 *   router.get('/foo', asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;