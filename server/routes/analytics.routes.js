/**
 * Analytics routes — Module 8.1.
 *
 * Five read-only GET endpoints under `/api/analytics`. Every endpoint
 * is gated by `protect, authorize('MODERATOR', 'ADMIN')` at the router
 * level — the same gate the 6.1 / 6.3 moderator surface uses, since
 * analytics is a moderator + admin oversight surface and we don't
 * expose it to OWNER / VOLUNTEER.
 *
 * Routes:
 *   GET /api/analytics/total-by-category
 *   GET /api/analytics/distribution-by-area
 *   GET /api/analytics/most-used-resources
 *   GET /api/analytics/active-emergency-assets
 *   GET /api/analytics/coverage-by-village
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The controller strips contact info — every response is a roll-up
 *   (counts / area summaries / resource summaries via publicResource())
 *   and never exposes email / phone / password. See
 *   `server/controllers/analytics.controller.js` for the full posture.
 */

const express = require('express');
const { protect, authorize } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const asyncHandler = require('../utils/asyncHandler');
const {
  totalByCategoryQuerySchema,
  distributionByAreaQuerySchema,
  mostUsedResourcesQuerySchema,
  activeEmergencyAssetsQuerySchema,
  coverageByVillageQuerySchema,
} = require('../validators/analytics.validators');
const ctrl = require('../controllers/analytics.controller');

const router = express.Router();

// Router-level gate. Every analytics endpoint is moderator + admin.
router.use(protect, authorize('MODERATOR', 'ADMIN'));

router.get(
  '/total-by-category',
  validate(totalByCategoryQuerySchema, 'query'),
  asyncHandler(ctrl.getTotalByCategory)
);

router.get(
  '/distribution-by-area',
  validate(distributionByAreaQuerySchema, 'query'),
  asyncHandler(ctrl.getDistributionByArea)
);

router.get(
  '/most-used-resources',
  validate(mostUsedResourcesQuerySchema, 'query'),
  asyncHandler(ctrl.getMostUsedResources)
);

router.get(
  '/active-emergency-assets',
  validate(activeEmergencyAssetsQuerySchema, 'query'),
  asyncHandler(ctrl.getActiveEmergencyAssets)
);

router.get(
  '/coverage-by-village',
  validate(coverageByVillageQuerySchema, 'query'),
  asyncHandler(ctrl.getCoverageByVillage)
);

module.exports = router;