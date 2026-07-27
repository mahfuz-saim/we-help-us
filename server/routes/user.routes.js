/**
 * User self-service routes (Module 1.4).
 *
 * Every route here is mounted behind `protect`. Authenticated users can
 * read and update their own profile, plus upload their avatar.
 *
 * There is no admin-facing /api/users/* surface in this module —
 * moderator tooling (banning, verifying, role management) lives in
 * Module 6.x and will be mounted under /api/moderator or /api/admin.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { uploadAvatar } = require('../middlewares/upload');
const { updateProfileSchema } = require('../validators/user.validators');
const userCtrl = require('../controllers/user.controller');

const router = express.Router();

router.use(protect);

// GET /api/users/me
router.get('/me', asyncHandler(userCtrl.getMe));

// PATCH /api/users/me
router.patch(
  '/me',
  validate(updateProfileSchema),
  asyncHandler(userCtrl.updateMe)
);

// POST /api/users/me/avatar — multipart/form-data with a single `avatar` file.
// Multer runs first; if it errors, the controller never runs and the
// central error handler turns it into a clean 400.
router.post(
  '/me/avatar',
  uploadAvatar('avatar'),
  asyncHandler(userCtrl.uploadAvatar)
);

module.exports = router;