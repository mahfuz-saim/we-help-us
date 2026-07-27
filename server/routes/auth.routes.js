/**
 * Auth routes — public (Module 1.2).
 *
 * All routes under this router are subject to the strict authLimiter
 * (see middlewares/rateLimit.js). The login + register endpoints are
 * brute-force-sensitive; /logout and /me are also rate-limited to keep
 * the contract consistent and prevent header-spraying probes.
 */

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authLimiter } = require('../middlewares/rateLimit');
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const {
  registerSchema,
  loginSchema,
} = require('../validators/auth.validators');
const authCtrl = require('../controllers/auth.controller');

const router = express.Router();

// Apply the auth-specific limiter to every route below.
router.use(authLimiter);

// POST /api/auth/register
router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(authCtrl.register)
);

// POST /api/auth/login
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(authCtrl.login)
);

// POST /api/auth/logout — JWT required so we know who's logging out.
router.post('/logout', protect, asyncHandler(authCtrl.logout));

// GET /api/auth/me
router.get('/me', protect, asyncHandler(authCtrl.me));

module.exports = router;