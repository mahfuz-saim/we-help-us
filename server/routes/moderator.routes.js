/**
 * Moderator routes — Module 6.1 (Moderator APIs).
 *
 * Mounted under `/api/moderator` from routes/index.js.
 *
 * Every endpoint here is gated by `protect, authorize('MODERATOR',
 * 'ADMIN')` at the router level. Per-endpoint validators are strict
 * so an unknown query key surfaces as a 400 instead of a silent pass-
 * through.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const {
  areaResourcesQuerySchema,
  pendingRequestsQuerySchema,
  volunteersQuerySchema,
  ownersQuerySchema,
} = require('../validators/moderator.validators');
const moderatorCtrl = require('../controllers/moderator.controller');

const router = express.Router();

// All endpoints require auth + MODERATOR/ADMIN role.
router.use(protect, authorize('MODERATOR', 'ADMIN'));

// GET /api/moderator/area-resources
router.get(
  '/area-resources',
  validate(areaResourcesQuerySchema, 'query'),
  asyncHandler(moderatorCtrl.getAreaResources)
);

// GET /api/moderator/pending-requests
router.get(
  '/pending-requests',
  validate(pendingRequestsQuerySchema, 'query'),
  asyncHandler(moderatorCtrl.getPendingRequests)
);

// GET /api/moderator/volunteers
router.get(
  '/volunteers',
  validate(volunteersQuerySchema, 'query'),
  asyncHandler(moderatorCtrl.getVolunteers)
);

// GET /api/moderator/owners
router.get(
  '/owners',
  validate(ownersQuerySchema, 'query'),
  asyncHandler(moderatorCtrl.getOwners)
);

module.exports = router;