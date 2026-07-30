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
const areaRoutes = require('./area.routes');
const resourceRoutes = require('./resource.routes');
const requestRoutes = require('./request.routes');
const moderatorRoutes = require('./moderator.routes');
const notificationRoutes = require('./notification.routes');
const analyticsRoutes = require('./analytics.routes'); // Module 8.1

const router = express.Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);           // Module 1.2
router.use('/admin', adminRoutes);         // Module 1.2
router.use('/users', userRoutes);          // Module 1.4
router.use('/areas', areaRoutes);          // Module 2.1
router.use('/resources', resourceRoutes);  // Module 3.2
router.use('/requests', requestRoutes);    // Module 5.2
router.use('/moderator', moderatorRoutes); // Module 6.1
router.use('/notifications', notificationRoutes); // Module 7.2
router.use('/analytics', analyticsRoutes); // Module 8.1

module.exports = router;