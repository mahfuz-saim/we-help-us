/**
 * Health check route — used by uptime monitors and by the frontend to
 * verify the backend is reachable.
 *
 * Returns basic server info + DB connection status. Does NOT require
 * auth, does NOT touch the network.
 */

const express = require('express');
const pkg = require('../package.json');
const { isConnected } = require('../config/db');

const router = express.Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'we-help-us-server',
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      db: {
        connected: isConnected(),
      },
    },
  });
});

module.exports = router;
