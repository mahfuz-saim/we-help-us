/**
 * Standard success-response shape used across all endpoints.
 *
 * Shape: { success: true, data, message? }
 */
function ok(res, data, message, statusCode = 200) {
  const payload = { success: true, data };
  if (message) payload.message = message;
  return res.status(statusCode).json(payload);
}

function created(res, data, message) {
  return ok(res, data, message, 201);
}

module.exports = { ok, created };
