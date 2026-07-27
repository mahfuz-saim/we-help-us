/**
 * Zod validation middleware factory.
 *
 * Usage:
 *   const schema = z.object({ email: z.string().email(), ... });
 *   router.post('/foo', validate(schema), handler);
 *
 * On failure: responds 400 with { success:false, message, details }.
 *   - `message`: a single-line summary that includes the first failing
 *     field's path + message so simple clients get something readable.
 *   - `details.issues`: the full structured list for richer clients.
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
      const first = issues[0];
      const summary = first
        ? `${first.path}: ${first.message}`
        : 'Validation failed';
      return next(
        new ApiError(400, summary, { issues, source })
      );
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };