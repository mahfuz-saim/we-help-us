/**
 * Zod validators for the resource endpoints (Module 3.2).
 *
 * Endpoints covered:
 *   - POST   /api/resources              (multipart/form-data)
 *   - GET    /api/resources              (list with pagination + filters)
 *   - GET    /api/resources/:id          (single resource)
 *   - PATCH  /api/resources/:id          (JSON body, owner-only)
 *   - DELETE /api/resources/:id          (owner or MODERATOR)
 *   - GET    /api/resources/nearby       (geo query)
 *
 * Why two body shapes for create vs update:
 *   POST validates the textual fields the client sends alongside the
 *   multipart `photos` upload. PATCH validates the same shape (minus
 *   required-ness) since the owner may want to update just `description`
 *   or just `status`.
 *
 * Privacy: `ownerId` is NEVER accepted from the request body. The
 * controller derives it from `req.user._id`. This is the same defense-
 * in-depth pattern used by auth.controller.register (where `role` is
 * ignored from the body for non-public callers).
 */

const { z } = require('zod');
const Resource = require('../models/Resource');

// ── Shared field shapes ────────────────────────────────────────────────────

// GeoJSON Point — same shape as User/Resource. We deliberately don't set
// a default on `type` to avoid the 2dsphere-rejection trap documented in
// models/User.js.
const locationSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .or(z.array(z.number()).length(2)),
  })
  .optional();

// The textual fields a resource needs at creation time. `photos` are
// uploaded as separate multipart parts and NOT validated by zod — the
// multer middleware enforces the 5-file / 5MB / image-only limits and
// the controller maps each file to {url, publicId} before persisting.
const createResourceFields = {
  category: z.enum(Resource.CATEGORY_VALUES, {
    message: 'category must be one of: ' + Resource.CATEGORY_VALUES.join(', '),
  }),
  title: z
    .string()
    .trim()
    .min(2, 'title must be at least 2 characters')
    .max(120, 'title must be at most 120 characters'),
  description: z
    .string()
    .trim()
    .min(10, 'description must be at least 10 characters')
    .max(2000, 'description must be at most 2000 characters'),
  capacity: z
    .number()
    .int('capacity must be an integer')
    .min(0, 'capacity cannot be negative')
    .max(100000, 'capacity is unrealistically large')
    .optional(),
  condition: z
    .enum(Resource.CONDITION_VALUES, {
      message:
        'condition must be one of: ' + Resource.CONDITION_VALUES.join(', '),
    })
    .optional(),
  status: z
    .enum(Resource.STATUS_VALUES, {
      message: 'status must be one of: ' + Resource.STATUS_VALUES.join(', '),
    })
    .optional(),
  areaId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'areaId must be a valid ObjectId').optional(),
  location: locationSchema,
};

// POST /api/resources — every required field is required. Photos are
// accepted as a separate multipart part and not validated here.
const createResourceSchema = z.object(createResourceFields);

// PATCH /api/resources/:id — same field set, but every field is
// optional. At least one must be present (enforced via refine below).
// The controller rejects any forbidden field (ownerId, createdAt,
// updatedAt) as defense-in-depth.
const updateResourceSchema = z
  .object({
    // All fields are optional on update.
    category: createResourceFields.category.optional(),
    title: createResourceFields.title.optional(),
    description: createResourceFields.description.optional(),
    capacity: createResourceFields.capacity.optional(),
    condition: createResourceFields.condition.optional(),
    status: z
      .enum(Resource.STATUS_VALUES, {
        message:
          'status must be one of: ' + Resource.STATUS_VALUES.join(', '),
      })
      .optional(),
    areaId: createResourceFields.areaId,
    location: locationSchema,
  })
  .strict()
  .refine(
    (obj) => Object.values(obj).some((v) => v !== undefined),
    { message: 'Provide at least one field to update.' }
  );

// GET /api/resources — list query. All filters optional; pagination
// defaults are applied in the controller.
const listResourcesQuerySchema = z
  .object({
    category: z
      .enum(Resource.CATEGORY_VALUES, {
        message:
          'category must be one of: ' + Resource.CATEGORY_VALUES.join(', '),
      })
      .optional(),
    status: z
      .enum(Resource.STATUS_VALUES, {
        message:
          'status must be one of: ' + Resource.STATUS_VALUES.join(', '),
      })
      .optional(),
    areaId: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{24}$/, 'areaId must be a valid ObjectId')
      .optional(),
    q: z.string().trim().min(1).max(120).optional(),
    // `mine=1` filters the list down to resources owned by the caller
    // (Module 3.5's dashboard). We accept only the literal '1' so a
    // caller can't sneak in a different value via a sloppy param.
    mine: z
      .string()
      .regex(/^1$/, 'mine must be 1')
      .optional(),
    // Module 4.1's search page adds two more filters. Both are
    // validated here so the controller can stay simple.
    // - `minCapacity` is a positive integer (>=0). The controller
    //   turns it into `{ capacity: { $gte: n } }`. Resources without
    //   a capacity field (null) are intentionally excluded — that's
    //   the right semantics for "show me resources that hold at
    //   least N".
    minCapacity: z
      .string()
      .regex(/^\d+$/, 'minCapacity must be a non-negative integer')
      .optional(),
    // - `lat` / `lng` / `radius` is the geo-distance filter. lat and
    //   lng must be present together; if only one is set we 400 so
    //   a sloppy caller doesn't silently filter to "anywhere on
    //   earth". `radius` requires both lat+lng (it's a no-op without
    //   a center). radius is in meters, capped at 100km — same cap
    //   the /nearby endpoint uses.
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'lat must be a number')
      .refine((s) => {
        const n = Number(s);
        return n >= -90 && n <= 90;
      }, 'lat must be between -90 and 90')
      .optional(),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'lng must be a number')
      .refine((s) => {
        const n = Number(s);
        return n >= -180 && n <= 180;
      }, 'lng must be between -180 and 180')
      .optional(),
    radius: z
      .string()
      .regex(/^[1-9]\d*$/, 'radius must be a positive integer (meters)')
      .refine((s) => {
        return Number(s) <= 100000;
      }, 'radius cannot exceed 100000 meters (100 km)')
      .optional(),
    page: z
      .string()
      .regex(/^[1-9]\d*$/, 'page must be a positive integer')
      .optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/, 'limit must be a positive integer')
      .optional(),
  })
  .strict()
  // Compose refinement: if lat or lng is present without the other,
  // reject — a half-specified geo filter is almost certainly a bug.
  // Same for radius without a center.
  .refine(
    (obj) => {
      const hasLat = obj.lat !== undefined;
      const hasLng = obj.lng !== undefined;
      const hasRadius = obj.radius !== undefined;
      if ((hasLat && !hasLng) || (hasLng && !hasLat)) return false;
      if (hasRadius && (!hasLat || !hasLng)) return false;
      return true;
    },
    {
      message:
        'lat and lng must appear together; radius also requires both lat and lng',
    }
  );

// GET /api/resources/nearby — lat/lng required, radius optional (meters).
const nearbyQuerySchema = z
  .object({
    lat: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'lat must be a number')
      .refine((s) => {
        const n = Number(s);
        return n >= -90 && n <= 90;
      }, 'lat must be between -90 and 90'),
    lng: z
      .string()
      .regex(/^-?\d+(\.\d+)?$/, 'lng must be a number')
      .refine((s) => {
        const n = Number(s);
        return n >= -180 && n <= 180;
      }, 'lng must be between -180 and 180'),
    radius: z
      .string()
      .regex(/^[1-9]\d*$/, 'radius must be a positive integer (meters)')
      .optional(),
    category: z
      .enum(Resource.CATEGORY_VALUES, {
        message:
          'category must be one of: ' + Resource.CATEGORY_VALUES.join(', '),
      })
      .optional(),
  })
  .strict();

// Forbidden fields on PATCH — defence in depth against the validator
// ever being widened by accident. The controller also rejects these.
const FORBIDDEN_FIELDS = Object.freeze([
  'ownerId',
  'createdAt',
  'updatedAt',
  '_id',
  '__v',
  'photos', // photos are managed by POST + a separate upload endpoint in 3.5
]);

module.exports = {
  createResourceSchema,
  updateResourceSchema,
  listResourcesQuerySchema,
  nearbyQuerySchema,
  FORBIDDEN_FIELDS,
};