/**
 * Zod validators for the user-profile endpoints (Module 1.4).
 *
 * Note: the schema intentionally forbids editing `role`, `password`,
 * `isVerified`, and `isActive` from the JSON PATCH body — those are
 * privileged operations. The controller also enforces this as
 * defense-in-depth (the spec for those fields doesn't belong on a
 * self-service endpoint).
 *
 * Avatar is handled by a separate multipart endpoint and is NOT part
 * of this schema.
 */

const { z } = require('zod');

// Re-declare the phone schema here (rather than reaching across modules)
// so this validator stays self-contained.
const phoneSchema = z
  .string()
  .trim()
  .min(7, 'phone is too short')
  .max(20, 'phone is too long')
  .regex(/^\+?[\d\s\-()]+$/, 'phone contains invalid characters');

// GeoJSON Point. We deliberately do NOT set a default on `type`; see
// server/models/User.js for the same reasoning (avoids a `{type:'Point'}`
// document with no coordinates being rejected by the 2dsphere index).
const locationSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .or(z.array(z.number()).length(2)),
  })
  .optional();

const editableProfileFields = {
  name: z.string().trim().min(2, 'name must be at least 2 characters').max(80).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('email is not a valid address')
    .max(254)
    .optional(),
  phone: phoneSchema.optional(),
  location: locationSchema,
  areaId: z.string().trim().optional(),
};

const updateProfileSchema = z
  .object(editableProfileFields)
  // At least one editable field must be present. Empty PATCH is a 400.
  .refine(
    (obj) => Object.values(obj).some((v) => v !== undefined),
    { message: 'Provide at least one field to update.' }
  );

// A separate schema listing the fields that are explicitly NOT editable.
// The controller rejects requests containing any of these.
const FORBIDDEN_FIELDS = Object.freeze([
  'role',
  'password',
  'isVerified',
  'isActive',
  'createdAt',
  'updatedAt',
  '_id',
  '__v',
]);

module.exports = {
  updateProfileSchema,
  FORBIDDEN_FIELDS,
};