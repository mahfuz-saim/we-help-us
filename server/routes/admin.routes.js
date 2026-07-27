/**
 * Admin routes (Module 1.2).
 *
 * These are the privileged routes. Every route here is mounted behind
 * `protect` + `authorize('ADMIN')`. The only route currently is
 * `POST /api/admin/create-privileged-user` — the only way to mint
 * MODERATOR or ADMIN accounts outside of a seed script.
 *
 * Note: there's no per-route rate limiter here. The globalLimiter from
 * app.js still applies. Admin endpoints are not brute-force-sensitive
 * (you need a valid admin JWT just to reach them), so the global
 * limiter is enough. If specific admin endpoints become abuse-prone
 * later, we can add a dedicated limiter.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect, authorize } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { createPrivilegedUserSchema } = require('../validators/auth.validators');
const adminCtrl = require('../controllers/admin.controller');

const router = express.Router();

router.use(protect, authorize('ADMIN'));

router.post(
  '/create-privileged-user',
  validate(createPrivilegedUserSchema),
  asyncHandler(adminCtrl.createPrivilegedUser)
);

module.exports = router;