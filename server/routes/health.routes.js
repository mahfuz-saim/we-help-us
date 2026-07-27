/**
 * Health check route — used by uptime monitors and by the frontend to
 * verify the backend is reachable.
 *
 * Returns basic server info + DB connection status. Does NOT require
 * auth, does NOT touch the network.
 *
 * If the DB is not connected, status is still `ok` (server is up) but
 * `db.connected` will be `false`. Callers that need a DB to consider
 * the service healthy should branch on `db.connected`.
 */

const express = require('express');
const mongoose = require('mongoose');
const pkg = require('../package.json');

const router = express.Router();

router.get('/', (_req, res) => {
  const conn = mongoose.connection;
  const dbInfo = {
    connected: conn.readyState === 1,
    readyState: conn.readyState,
    host: conn.host || null,
    name: conn.name || null,
  };

  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'we-help-us-server',
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      db: dbInfo,
    },
  });
});

module.exports = router;
