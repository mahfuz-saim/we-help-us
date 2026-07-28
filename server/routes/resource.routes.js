/**
 * Resource routes — Module 3.2.
 *
 * Mounted under `/api/resources` from routes/index.js.
 *
 * Auth model:
 *   - Every endpoint here requires an authenticated user (volunteers
 *     browse + request; owners register inventory). The globalLimiter
 *     from app.js already caps /api/* traffic.
 *   - POST is OWNER-only (enforced in the controller). PATCH is
 *     owner-of-the-resource (enforced in the controller). DELETE is
 *     owner OR MODERATOR. GET endpoints are open to any logged-in user.
 *   - The /nearby endpoint is mounted BEFORE the `/:id` route so the
 *     literal `nearby` segment never gets parsed as an ObjectId.
 *
 * Photo uploads: `uploadPhotos('photos')` enforces the 5-file / 5MB /
 * image-only cap from the project rules. The controller then streams
 * each buffer to Cloudinary.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { uploadPhotos } = require('../middlewares/upload');
const {
  createResourceSchema,
  updateResourceSchema,
  listResourcesQuerySchema,
  nearbyQuerySchema,
} = require('../validators/resource.validators');
const resourceCtrl = require('../controllers/resource.controller');

const router = express.Router();

// All routes require auth.
router.use(protect);

// GET /api/resources/nearby — must be BEFORE /:id so the literal
// "nearby" segment is matched first.
router.get(
  '/nearby',
  validate(nearbyQuerySchema, 'query'),
  asyncHandler(resourceCtrl.nearbyResources)
);

// GET /api/resources — list with filters + pagination.
router.get(
  '/',
  validate(listResourcesQuerySchema, 'query'),
  asyncHandler(resourceCtrl.listResources)
);

// POST /api/resources — multipart upload. Multer runs first, then zod
// validates the remaining textual fields, then the controller uploads
// to Cloudinary and persists.
router.post(
  '/',
  uploadPhotos('photos'),
  validate(createResourceSchema),
  asyncHandler(resourceCtrl.createResource)
);

// GET /api/resources/:id — single resource.
router.get(
  '/:id',
  asyncHandler(resourceCtrl.getResource)
);

// PATCH /api/resources/:id — owner-only update.
router.patch(
  '/:id',
  validate(updateResourceSchema),
  asyncHandler(resourceCtrl.updateResource)
);

// DELETE /api/resources/:id — owner or MODERATOR.
router.delete(
  '/:id',
  asyncHandler(resourceCtrl.deleteResource)
);

module.exports = router;