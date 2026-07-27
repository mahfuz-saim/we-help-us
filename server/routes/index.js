/**
 * Central router. Each feature-area adds its router here.
 *
 * Mount paths follow the /api/<resource> convention.
 */

const express = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const userRoutes = require('./user.routes');

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);           // Module 1.2
router.use('/admin', adminRoutes);         // Module 1.2
router.use('/users', userRoutes);          // Module 1.4

// Feature routers to be mounted in later modules:
//   router.use('/areas', require('./area.routes'));          // Module 2.1
//   router.use('/resources', require('./resource.routes'));  // Module 3.2
//   router.use('/requests', require('./request.routes'));    // Module 5.2
//   router.use('/moderator', require('./moderator.routes')); // Module 6.1
//   router.use('/notifications', require('./notification.routes')); // Module 7.2
//   router.use('/analytics', require('./analytics.routes')); // Module 8.1

module.exports = router;