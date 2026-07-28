/**
 * Notification routes — Module 7.2.
 *
 * Mounted under `/api/notifications` from routes/index.js. Every endpoint
 * requires authentication; the controller derives recipient scope from
 * req.user._id so OWNER, VOLUNTEER, MODERATOR, and ADMIN users can each see
 * and mutate only their own notifications.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  emptyActionBodySchema,
} = require('../validators/notification.validators');
const notificationCtrl = require('../controllers/notification.controller');

const router = express.Router();

router.use(protect);

// GET /api/notifications — authenticated user's inbox.
router.get(
  '/',
  validate(listNotificationsQuerySchema, 'query'),
  asyncHandler(notificationCtrl.listNotifications)
);

// Literal route MUST be registered before /:id/read so "mark-all-read"
// cannot be interpreted as an ObjectId parameter.
router.patch(
  '/mark-all-read',
  validate(emptyActionBodySchema),
  asyncHandler(notificationCtrl.markAllRead)
);

// PATCH /api/notifications/:id/read — authenticated recipient only.
router.patch(
  '/:id/read',
  validate(notificationIdParamsSchema, 'params'),
  validate(emptyActionBodySchema),
  asyncHandler(notificationCtrl.markOneRead)
);

module.exports = router;
