/**
 * ApiError — a thin Error subclass carrying an HTTP status code and an
 * optional `details` payload (useful for zod validation errors, etc.).
 */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = ApiError;
