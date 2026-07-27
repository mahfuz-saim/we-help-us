/**
 * Zod validation middleware factory.
 *
 * Usage:
 *   const schema = z.object({ email: z.string().email(), ... });
 *   router.post('/foo', validate(schema), handler);
 *
 * On failure: responds 400 with { success:false, message, details }.
 * On success: replaces `req.body` with the parsed (and typed) value.
 */

const ApiError = require('../utils/apiError');

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(
        new ApiError(400, 'Validation failed', { issues, source })
      );
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };