/**
 * Emergency routes — Module 9 (Emergency System Rework).
 *
 * Mounted under `/api/emergency-activations` from routes/index.js.
 *
 * Endpoints:
 *   - POST   /                 (VOLUNTEER, verified)
 *   - GET    /                 (any auth)
 *   - PATCH  /:id/deactivate   (auth, gated)
 *
 * The moderator-only activation endpoint and the analytics map live
 * under their own existing routers to keep the existing 6.3 / 8.1
 * surface intact (see moderator.routes.js + analytics.routes.js for
 * those endpoints).
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The validator strips contact info — every response is the
 *   `publicShape()` projection, never the raw document. The
 *   `message` field IS exposed verbatim because it's the
 *   coordination channel. See
 *   `server/controllers/emergency.controller.js` for the full posture.
 */

const express = require('express');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const asyncHandler = require('../utils/asyncHandler');
const {
  createActivationBodySchema,
  listActivationsQuerySchema,
  activationIdParamsSchema,
} = require('../validators/emergency.validators');
const ctrl = require('../controllers/emergency.controller');

const router = express.Router();

// All endpoints require auth. The controller enforces per-endpoint
// role + isVerified + areaId checks.
router.use(protect);

router.post(
  '/',
  validate(createActivationBodySchema),
  asyncHandler(ctrl.createVolunteerActivation)
);

router.get(
  '/',
  validate(listActivationsQuerySchema, 'query'),
  asyncHandler(ctrl.listActivations)
);

router.patch(
  '/:id/deactivate',
  validate(activationIdParamsSchema, 'params'),
  asyncHandler(ctrl.deactivateActivation)
);

module.exports = router;
