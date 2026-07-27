/**
 * Central router. Each feature-area adds its router here.
 *
 * Mount paths follow the /api/<resource> convention.
 */

const express = require('express');

const healthRoutes = require('./health.routes');

const router = express.Router();

router.use('/health', healthRoutes);

// Feature routers will be mounted here as subsequent modules land:
//   router.use('/auth', require('./auth.routes'));           // Module 1.2
//   router.use('/users', require('./user.routes'));          // Module 1.4
//   router.use('/areas', require('./area.routes'));          // Module 2.1
//   router.use('/resources', require('./resource.routes'));  // Module 3.2
//   router.use('/requests', require('./request.routes'));    // Module 5.2
//   router.use('/moderator', require('./moderator.routes')); // Module 6.1
//   router.use('/admin', require('./admin.routes'));         // Module 1.2
//   router.use('/notifications', require('./notification.routes')); // Module 7.2
//   router.use('/analytics', require('./analytics.routes')); // Module 8.1

module.exports = router;
