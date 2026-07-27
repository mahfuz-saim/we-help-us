/**
 * Server entry point.
 *
 * Responsibilities:
 *   - load env
 *   - configure Cloudinary
 *   - attempt MongoDB connection (Module 0.4 — skipped gracefully for now)
 *   - create the Express app
 *   - create the HTTP server and attach Socket.io
 *   - listen on PORT
 *   - set up graceful shutdown
 */

require('dotenv').config();

const http = require('http');

const { createApp } = require('./app');
const { configureCloudinary } = require('./config/cloudinary');
const { connectDB, isConnected } = require('./config/db');
const { initSocket } = require('./sockets');

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

async function main() {
  // 1) Cloudinary — configure if creds present, skip silently otherwise.
  configureCloudinary();

  // 2) MongoDB — best-effort connect on boot. If MONGODB_URI is set but
  //    unreachable we log and keep serving so the health route still works.
  try {
    await connectDB();
    if (isConnected()) {
      // eslint-disable-next-line no-console
      console.log('[db] MongoDB connected');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[db] MongoDB connection skipped/failed: ${err.message}. ` +
        'This is expected before Module 0.4 is wired up.'
    );
  }

  // 3) Express + HTTP + Socket.io
  const app = createApp();
  const httpServer = http.createServer(app);

  const corsOrigin = process.env.CLIENT_ORIGIN || '*';
  initSocket(httpServer, { corsOrigin });

  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] listening on http://localhost:${PORT}  (env=${NODE_ENV})`
    );
  });

  // 4) Graceful shutdown
  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[server] received ${signal}, shutting down...`);
    httpServer.close(async () => {
      try {
        const { disconnectDB } = require('./config/db');
        await disconnectDB();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
    // hard exit if close hangs
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});