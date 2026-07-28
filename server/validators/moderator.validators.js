/**
 * Zod query validators for the read-only moderator APIs (Module 6.1).
 *
 * All endpoint scope is derived from the authenticated moderator. No area,
 * role, owner, or volunteer identity may be supplied by the caller.
 */

const { z } = require('zod');
const Resource = require('../models/Resource');
const { CATEGORY_VALUES } = require('../utils/categories');

const positiveInteger = (field) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${field} must be a positive integer`)
    .optional();

const paginationFields = {
  page: positiveInteger('page'),
  limit: positiveInteger('limit'),
};

// GET /api/moderator/area-resources
const areaResourcesQuerySchema = z
  .object({
    status: z
      .enum(Resource.STATUS_VALUES, {
        message: 'status must be one of: ' + Resource.STATUS_VALUES.join(', '),
      })
      .optional(),
    category: z
      .enum(CATEGORY_VALUES, {
        message: 'category must be one of: ' + CATEGORY_VALUES.join(', '),
      })
      .optional(),
    q: z.string().trim().min(1).max(120).optional(),
    ...paginationFields,
  })
  .strict();

// GET /api/moderator/pending-requests — status is always REQUESTED.
const pendingRequestsQuerySchema = z
  .object({
    ...paginationFields,
  })
  .strict();

// GET /api/moderator/volunteers
const volunteersQuerySchema = z
  .object({
    isVerified: z.enum(['true', 'false']).optional(),
    ...paginationFields,
  })
  .strict();

// GET /api/moderator/owners
const ownersQuerySchema = z
  .object({
    ...paginationFields,
  })
  .strict();

module.exports = {
  areaResourcesQuerySchema,
  pendingRequestsQuerySchema,
  volunteersQuerySchema,
  ownersQuerySchema,
};
