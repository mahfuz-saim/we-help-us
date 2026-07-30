/**
 * Zod validators for the emergency-activation endpoints (Module 9).
 *
 * Two bodies share a near-identical shape:
 *
 *   - volunteer activation: `{ rootAreaId, message, center?, radiusMeters?, expiresAt? }`
 *   - moderator activation: same shape; rootAreaId must equal
 *     `req.user.areaId` (controller-enforced, not here).
 *
 * Validation rules:
 *   - `rootAreaId` is required and must be a 24-char ObjectId.
 *     Whether it's a valid ancestor of the volunteer's areaId is
 *     controller-enforced (the validator can't see req.user).
 *   - `message` is required (1-1000 chars, mirroring the
 *     notification / moderator-note caps).
 *   - `center` is optional. When present, MUST be `{ type: 'Point',
 *     coordinates: [lng, lat] }` with finite numbers in the standard
 *     ranges.
 *   - `radiusMeters` is optional. When present, MUST be 1-50000 (50
 *     km). When `center` is absent, `radiusMeters` must be absent
 *     too (the controller enforces the inverse as a second line of
 *     defence).
 *   - `expiresAt` is optional. When present, must be a valid ISO
 *     date in the future, ≤ 7 days out.
 *
 * Strict mode on every body schema — unknown keys are a 400. The
 * `note` field from the 6.3 `setEmergencyModeBodySchema` is NOT
 * carried here; emergency-activation uses `message` instead (the
 * semantics align with a notification body, not a moderator note).
 */

const { z } = require('zod');
const EmergencyActivation = require('../models/EmergencyActivation');

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid ObjectId');

// GeoJSON Point. The "type" is always "Point" today; we accept the
// field so the client can echo what it received without surprises.
const pointSchema = z
  .object({
    type: z.literal('Point').optional(),
    coordinates: z
      .tuple([
        z
          .number()
          .refine((n) => Number.isFinite(n) && n >= -180 && n <= 180, {
            message: 'lng must be between -180 and 180',
          }),
        z
          .number()
          .refine((n) => Number.isFinite(n) && n >= -90 && n <= 90, {
            message: 'lat must be between -90 and 90',
          }),
      ]),
  })
  .strict();

// Shared body shape for both volunteer + moderator activation.
const createActivationBodySchema = z
  .object({
    rootAreaId: objectIdString,
    message: z
      .string()
      .trim()
      .min(1, 'message is required')
      .max(1000, 'message must be at most 1000 characters'),
    center: pointSchema.optional(),
    radiusMeters: z
      .number()
      .int('radiusMeters must be an integer')
      .min(1, 'radiusMeters must be at least 1')
      .max(
        EmergencyActivation.MAX_RADIUS_METERS,
        `radiusMeters must be at most ${EmergencyActivation.MAX_RADIUS_METERS}`
      )
      .optional(),
    expiresAt: z
      .string()
      .datetime({ message: 'expiresAt must be an ISO 8601 datetime' })
      .refine((v) => new Date(v).getTime() > Date.now(), {
        message: 'expiresAt must be in the future',
      })
      .refine(
        (v) =>
          new Date(v).getTime() <=
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        { message: 'expiresAt must be within 7 days' }
      )
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.center && !val.radiusMeters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['radiusMeters'],
        message: 'radiusMeters is required when center is provided',
      });
    }
    if (val.radiusMeters && !val.center) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['center'],
        message: 'center is required when radiusMeters is provided',
      });
    }
  });

// GET /api/emergency-activations — list.
const listActivationsQuerySchema = z
  .object({
    rootAreaId: objectIdString.optional(),
    areaId: objectIdString.optional(),
    scope: z
      .enum(EmergencyActivation.SCOPE_VALUES, {
        message:
          'scope must be one of: ' +
          EmergencyActivation.SCOPE_VALUES.join(', '),
      })
      .optional(),
    active: z
      .enum(['true', 'false', '1', '0'])
      .optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
      .max(4, 'limit must be at most 9999')
      .optional(),
  })
  .strict();

// PATCH /api/emergency-activations/:id/deactivate — params.
const activationIdParamsSchema = z
  .object({
    id: objectIdString,
  })
  .strict();

module.exports = {
  createActivationBodySchema,
  listActivationsQuerySchema,
  activationIdParamsSchema,
};