/**
 * Zod validators for the request lifecycle endpoints (Module 5.2).
 *
 * Endpoints covered:
 *   - POST   /api/requests              (VOLUNTEER + isVerified; create)
 *   - GET    /api/requests              (any role; list scoped by role)
 *   - PATCH  /api/requests/:id/approve  (owner-of-resource)
 *   - PATCH  /api/requests/:id/reject   (owner-of-resource OR MODERATOR)
 *   - PATCH  /api/requests/:id/collect  (the requesting volunteer)
 *   - PATCH  /api/requests/:id/return   (the requesting volunteer)
 *   - PATCH  /api/requests/:id/complete (owner-of-resource)
 *
 * Privacy boundary (KEY DESIGN REMINDER):
 *   The validator accepts an optional `moderatorNote` on POST so a
 *   moderator can document an override, but owner contact info is
 *   NEVER accepted from any body — it's a privacy boundary enforced
 *   at the controller layer (and protected by the response helpers in
 *   server/controllers/request.controller.js).
 *
 * Strict-mode: every schema is `.strict()` so an unknown key on a
 * body / query is a 400, not a silent pass-through. Same defence as
 * the Resource validators.
 */

const { z } = require('zod');
const { REQUEST_STATUS_VALUES } = require('../models/ResourceRequest');

// ── ObjectId helper ────────────────────────────────────────────────────────
// Centralised so future endpoints don't drift. Accepts the same 24-char
// hex string the resource validators use; the controller is responsible
// for the actual CastError handling (mongoose throws on bad ids).
const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid ObjectId');

// ── POST /api/requests ─────────────────────────────────────────────────────
// A volunteer creates one request for one resource. The body carries
// `resourceId` only — ownerId and volunteerId are derived from the
// auth context + the lookup of the resource. A `moderatorNote` is
// accepted for moderator-side workflows but is trimmed + length-capped
// to mirror Module 5.1's schema bounds.
const createRequestSchema = z
  .object({
    resourceId: objectIdString,
    moderatorNote: z
      .string()
      .trim()
      .max(1000, 'moderatorNote must be at most 1000 characters')
      .optional()
      .nullable(),
  })
  .strict();

// ── GET /api/requests ──────────────────────────────────────────────────────
// The list endpoint is role-scoped in the controller; the query
// schema here only accepts the optional filters the controller
// interprets (status, resourceId, volunteerId). role/mine filters
// are derived from req.user, never from the query string — see
// `listRequests` in request.controller.js.
const listRequestsQuerySchema = z
  .object({
    status: z
      .enum(REQUEST_STATUS_VALUES, {
        message:
          'status must be one of: ' + REQUEST_STATUS_VALUES.join(', '),
      })
      .optional(),
    resourceId: objectIdString.optional(),
    volunteerId: objectIdString.optional(),
    page: z
      .string()
      .regex(/^[1-9]\d*$/, 'page must be a positive integer')
      .optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
      .optional(),
  })
  .strict();

// ── Action endpoints (approve / reject / collect / return / complete) ──────
// All five share the same shape: an optional moderatorNote and the
// path carries the request id. Strict mode ensures we never accept
// a stray field that could shadow controller logic.
//
// Empty-body semantics: PATCH with no body (`Content-Length: 0`) is
// legitimate for actions that don't need a note (the common case —
// "I picked up the resource" doesn't need a note). Express's json()
// parser leaves `req.body` undefined when no body is sent, so we
// wrap the object with `.optional()` — zod accepts undefined and
// {}. If a caller does send a body with fields, strict mode enforces
// only known fields.
const actionBodySchema = z
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
  createRequestSchema,
  listRequestsQuerySchema,
  actionBodySchema,
};
