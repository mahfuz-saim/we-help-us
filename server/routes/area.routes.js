/**
 * Area routes — public reference data (Module 2.1).
 *
 * Mounted under `/api/areas` from routes/index.js. The single endpoint
 * `GET /api/areas` powers the cascading dropdown in Module 2.2.
 *
 * Areas are reference data — no PII, no auth required. The validators
 * gate on query params; the controller reads from the Area model.
 *
 * Rate limiting: the globalLimiter from app.js already applies to every
 * `/api/*` route. That's enough — these endpoints are not brute-force
 * sensitive and the cascading UI makes at most a handful of calls per
 * session.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../middlewares/validate');
const {
  listAreasQuerySchema,
  getAreaByIdParamsSchema,
} = require('../validators/area.validators');
const areaCtrl = require('../controllers/area.controller');

const router = express.Router();

// GET /api/areas — cascading dropdown query.
router.get(
  '/',
  validate(listAreasQuerySchema, 'query'),
  asyncHandler(areaCtrl.listAreas)
);

// GET /api/areas/:id — resolve a single area id to its full ancestor
// chain. Used by the profile page to render a hierarchy label for a
// stored `areaId` even when the picker is in read-only mode.
router.get(
  '/:id',
  validate(getAreaByIdParamsSchema, 'params'),
  asyncHandler(areaCtrl.getAreaChain)
);

module.exports = router;