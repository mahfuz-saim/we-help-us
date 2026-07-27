/**
 * Zod validators for the auth + admin endpoints (Module 1.2).
 *
 * Each schema is exported by name so route files can `require()` them
 * and feed them into `validate(schema)` from middlewares/validate.js.
 *
 * IMPORTANT: the public `register` schema accepts `role` as
 * `OWNER | VOLUNTEER` only. Anything else is rejected here so we never
 * rely solely on the Mongoose schema's `enum` (which would still allow
 * a privileged role to slip through if the route handler were buggy).
 */

const { z } = require('zod');
const User = require('../models/User');

const PUBLIC_ROLES = User.PUBLIC_REGISTRATION_ROLES; // ['OWNER', 'VOLUNTEER']
const PRIVILEGED_ROLES = ['MODERATOR', 'ADMIN'];

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'phone is too short')
  .max(20, 'phone is too long')
  // Allow digits, optional leading +, spaces, hyphens, parens.
  .regex(/^\+?[\d\s\-()]+$/, 'phone contains invalid characters');

const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(200, 'password is too long');

const locationSchema = z
  .object({
    // No default — we set `type: 'Point'` explicitly in the controller
    // when coordinates are present. A default here would inject `type`
    // even when the caller never provided a location, which then breaks
    // the 2dsphere index.
    type: z.literal('Point'),
    coordinates: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .or(z.array(z.number()).length(2)),
  })
  .optional();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('email is not a valid address'),
  phone: phoneSchema,
  password: passwordSchema,
  // Only public roles. Missing → defaults to OWNER (handled in controller).
  role: z
    .enum(PUBLIC_ROLES, {
      message:
        'role must be one of: ' + PUBLIC_ROLES.join(', ') +
        ' (public registration does not allow privileged roles)',
    })
    .optional(),
  location: locationSchema,
  areaId: z.string().trim().optional(),
});

const loginSchema = z.object({
  // Accept either email or phone as the identifier.
  email: z.string().trim().toLowerCase().email().optional(),
  phone: phoneSchema.optional(),
  password: passwordSchema,
});

const createPrivilegedUserSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('email is not a valid address'),
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(PRIVILEGED_ROLES, {
    message: 'role must be one of: ' + PRIVILEGED_ROLES.join(', '),
  }),
  location: locationSchema,
  areaId: z.string().trim().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  createPrivilegedUserSchema,
  PUBLIC_ROLES,
  PRIVILEGED_ROLES,
};