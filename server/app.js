/**
 * Express application factory.
 *
 * Wires up:
 *   - core security middleware (helmet, CORS)
 *   - parsers (json, urlencoded)
 *   - request logger (morgan, dev by default)
 *   - global rate limit
 *   - /api routes (health + future features)
 *   - 404 handler
 *   - central error handler
 *
 * Does NOT bind to a port — that's `server.js`. This makes the app
 * testable without spawning an HTTP listener.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const routes = require('./routes');
const { globalLimiter } = require('./middlewares/rateLimit');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

function createApp() {
  const app = express();

  // Trust the local proxy (e.g., when deployed behind a load balancer)
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet());

  // CORS — single-origin by default, comma-separated list via env allowed
  const corsOrigin = process.env.CLIENT_ORIGIN || '*';
  app.use(
    cors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );

  // Parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  // Global rate limit (auth routes get a stricter one mounted internally)
  app.use('/api', globalLimiter);

  // Routers
  app.use('/api', routes);

  // Root info route (helpful for humans, ignored by monitoring)
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        service: 'we-help-us-server',
        apiBase: '/api',
        health: '/api/health',
      },
    });
  });

  // 404 + error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
