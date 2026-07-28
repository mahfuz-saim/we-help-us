/**
 * Request routes — Module 5.2 (Request APIs).
 *
 * Mounted under `/api/requests` from routes/index.js.
 *
 * Auth model:
 *   - Every endpoint here requires an authenticated user (`protect`
 *     is mounted at the router level).
 *   - Role checks live in the controller (see request.controller.js).
 *     Per plan.txt:
 *       - POST   : VOLUNTEER + isVerified
 *       - GET    : any role, role-scoped in the controller
 *       - APPROVE: owner-of-resource
 *       - REJECT : owner-of-resource OR MODERATOR
 *       - COLLECT: the requesting volunteer
 *       - RETURN : the requesting volunteer
 *       - COMPLETE: owner-of-resource
 *       - GET /:id: principal on the request OR ADMIN
 *
 * Route ordering matters: every action endpoint is registered
 * BEFORE `/:id` so React Router-style "match the literal first"
 * semantics apply — a stray `GET /:id` above would catch the
 * `/approve` segment as an ObjectId and CastError.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const {
  createRequestSchema,
  listRequestsQuerySchema,
  actionBodySchema,
} = require('../validators/request.validators');
const requestCtrl = require('../controllers/request.controller');

const router = express.Router();

// All routes require auth.
router.use(protect);

// GET /api/requests — role-scoped list. Query schema accepts
// optional status/resourceId/volunteerId/page/limit filters.
router.get(
  '/',
  validate(listRequestsQuerySchema, 'query'),
  asyncHandler(requestCtrl.listRequests)
);

// POST /api/requests — verified VOLUNTEER creates a new request.
router.post(
  '/',
  validate(createRequestSchema),
  asyncHandler(requestCtrl.createRequest)
);

// Action endpoints — must be registered BEFORE /:id so the literal
// segments are matched first.

// PATCH /api/requests/:id/approve — owner-of-resource only.
router.patch(
  '/:id/approve',
  validate(actionBodySchema),
  asyncHandler(requestCtrl.approveRequest)
);

// PATCH /api/requests/:id/reject — owner-of-resource OR MODERATOR.
router.patch(
  '/:id/reject',
  validate(actionBodySchema),
  asyncHandler(requestCtrl.rejectRequest)
);

// PATCH /api/requests/:id/collect — the requesting volunteer.
router.patch(
  '/:id/collect',
  validate(actionBodySchema),
  asyncHandler(requestCtrl.collectRequest)
);

// PATCH /api/requests/:id/return — the requesting volunteer.
router.patch(
  '/:id/return',
  validate(actionBodySchema),
  asyncHandler(requestCtrl.returnRequest)
);

// PATCH /api/requests/:id/complete — owner-of-resource only.
router.patch(
  '/:id/complete',
  validate(actionBodySchema),
  asyncHandler(requestCtrl.completeRequest)
);

// GET /api/requests/:id — principal on the request OR ADMIN.
// Registered LAST so the action segments above win the match.
router.get(
  '/:id',
  asyncHandler(requestCtrl.getRequest)
);

module.exports = router;