/**
 * Zod validators for the moderator APIs (Modules 6.1 + 6.2).
 *
 * Module 6.1 ships the four read-only list endpoints; Module 6.2 adds
 * the volunteer-verification action endpoint. All endpoint scope is
 * derived from the authenticated moderator — no area, role, or
 * caller-supplied identity may be passed via the query / body.
 *
 * Privacy (KEY DESIGN REMINDER): the verification endpoint NEVER
 * carries or accepts the volunteer's `email` / `phone` / `password`.
 * The body schema is intentionally tiny — only an optional
 * `moderatorNote` (≤1000 chars, mirroring the request lifecycle's
 * note). The response surfaces the volunteer's public User shape
 * via the private `publicUserDirectory()` helper (same one the
 * directory endpoints use), which strips `password` AND never
 * includes `email` / `phone`.
 */

const { z } = require('zod');
const Resource = require('../models/Resource');
const { CATEGORY_VALUES } = require('../utils/categories');

const positiveInteger = (field) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${field} must be a positive integer`)
    .optional();

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid ObjectId');

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

// POST /api/moderator/verify-volunteer/:userId — Module 6.2.
// :userId is the volunteer's ObjectId. The body carries an optional
// `moderatorNote` (≤1000 chars, same cap as the request lifecycle's
// note). Strict mode so unknown body keys are a 400.
const verifyVolunteerParamsSchema = z
  .object({
    userId: objectIdString,
  })
  .strict();

const verifyVolunteerBodySchema = z
  .object({
    moderatorNote: z
      .string()
      .trim()
      .max(1000, 'moderatorNote must be at most 1000 characters')
      .optional()
      .nullable(),
  })
  .strict()
  .optional();

module.exports = {
  areaResourcesQuerySchema,
  pendingRequestsQuerySchema,
  volunteersQuerySchema,
  ownersQuerySchema,
  verifyVolunteerParamsSchema,
  verifyVolunteerBodySchema,
};
