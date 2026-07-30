/**
 * Zod validators for the admin endpoints.
 *
 * Houses:
 *   - `moderatorsQuerySchema`     for `GET /api/admin/moderators`
 *   - `volunteersAdminQuerySchema` for `GET /api/admin/volunteers`
 *
 * Pagination fields follow the convention from
 * `server/validators/moderator.validators.js` (positive integer
 * strings, default applied in the controller). Strict mode rejects
 * unknown query keys — defense against typos and unintended params.
 *
 * Privacy (KEY DESIGN REMINDER): admin list endpoints MUST never
 * expose email / phone / password. The controller uses the private
 * `publicUserDirectory()` helper from moderator.controller.js, which
 * strips those fields. We don't validate them here because the
 * controller never reads them off the request — the schema only
 * needs to gate pagination + filters.
 */

const { z } = require('zod');

const positiveInteger = (field) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${field} must be a positive integer`)
    .optional();

const paginationFields = {
  page: positiveInteger('page'),
  limit: positiveInteger('limit'),
};

// GET /api/admin/moderators — global list of all moderator accounts.
// Admins are not area-scoped, so this returns every moderator across
// every area. Sort order is newest-first by createdAt.
const moderatorsQuerySchema = z
  .object({
    ...paginationFields,
  })
  .strict();

// GET /api/admin/volunteers — global list of volunteers with optional
// area + verification filters. The areaId is the same hex 24-char
// ObjectId used by the rest of the platform (the resource + request
// controllers already share the same regex). `isVerified` accepts the
// string forms 'true' | 'false' — Express query values are always
// strings, so we coerce inside the controller.
const volunteersAdminQuerySchema = z
  .object({
    areaId: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, 'areaId must be a valid ObjectId')
      .optional(),
    isVerified: z
      .enum(['true', 'false'], {
        message: 'isVerified must be "true" or "false"',
      })
      .optional(),
    ...paginationFields,
  })
  .strict();

module.exports = {
  moderatorsQuerySchema,
  volunteersAdminQuerySchema,
};
