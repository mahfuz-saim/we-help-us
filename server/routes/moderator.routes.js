/**
 * Moderator routes — Modules 6.1 + 6.2 + 6.3.
 *
 * Mounted under `/api/moderator` from routes/index.js.
 *
 * Every endpoint here is gated by `protect, authorize('MODERATOR',
 * 'ADMIN')` at the router level. Per-endpoint validators are strict
 * so an unknown query key / body field / path field surfaces as a
 * 400 instead of a silent pass-through.
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
  verifyVolunteerParamsSchema,
  verifyVolunteerBodySchema,
  setEmergencyModeBodySchema,
} = require('../validators/moderator.validators');
const {
  createActivationBodySchema,
  activationIdParamsSchema,
} = require('../validators/emergency.validators');
const moderatorCtrl = require('../controllers/moderator.controller');
const emergencyCtrl = require('../controllers/emergency.controller');

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

// POST /api/moderator/verify-volunteer/:userId — Module 6.2.
// `validate(schema, 'params')` runs first so a malformed :userId is a
// 400 before the handler is called. The body schema is `.optional()`
// so an empty body (the typical "no note" verify) is accepted.
router.post(
  '/verify-volunteer/:userId',
  validate(verifyVolunteerParamsSchema, 'params'),
  validate(verifyVolunteerBodySchema),
  asyncHandler(moderatorCtrl.verifyVolunteer)
);

// GET /api/moderator/emergency-mode — Module 6.3.
// Read-only. No body / query params. Returns the area's current
// emergency-mode state.
router.get(
  '/emergency-mode',
  asyncHandler(moderatorCtrl.getEmergencyMode)
);

// PATCH /api/moderator/emergency-mode — Module 6.3.
// Body: { isActive: boolean, note?: string }. Strict validator.
router.patch(
  '/emergency-mode',
  validate(setEmergencyModeBodySchema),
  asyncHandler(moderatorCtrl.setEmergencyMode)
);

// POST /api/moderator/emergency-activations — Module 9.
// Moderator-side activation endpoint with full hierarchy + circle
// support. Mirrors the volunteer POST shape but locks rootAreaId to
// `req.user.areaId` server-side.
router.post(
  '/emergency-activations',
  validate(createActivationBodySchema),
  asyncHandler(emergencyCtrl.createModeratorActivation)
);

// PATCH /api/moderator/emergency-activations/:id/deactivate —
// Module 9. Mirrors the volunteer-side deactivate path; the
// controller authorises moderators against the rootAreaId chain.
router.patch(
  '/emergency-activations/:id/deactivate',
  validate(activationIdParamsSchema, 'params'),
  asyncHandler(emergencyCtrl.deactivateActivation)
);

module.exports = router;