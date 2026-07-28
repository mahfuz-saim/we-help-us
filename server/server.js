/**
 * Server entry point.
 *
 * Responsibilities:
 *   - load env
 *   - configure Cloudinary
 *   - connect to MongoDB (Module 0.4) — fail-fast in production
 *   - create the Express app
 *   - create the HTTP server and attach Socket.io
 *   - listen on PORT
 *   - set up graceful shutdown
 */

require("dotenv").config();

const http = require("http");

const { createApp } = require("./app");
const { configureCloudinary } = require("./config/cloudinary");
const { connectDB, isConnected, disconnectDB } = require("./config/db");
const { initSocket } = require("./sockets");
const { seedAreasIfEmpty } = require("./utils/seedAreas");

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

async function main() {
  // 1) Cloudinary — configure if creds present, skip silently otherwise.
  configureCloudinary();

  // 2) MongoDB — connect before we start accepting traffic.
  //
  //    - In production: any error here is fatal (see connectDB() docs).
  //    - In development: connectDB() resolves with `null` if MONGODB_URI
  //      is missing or unreachable; the server still boots so the
  //      /api/health route works for smoke-testing.
  try {
    await connectDB();
    if (isConnected()) {
      // eslint-disable-next-line no-console
      console.log("[db] MongoDB connected");

      // Auto-seed the Area collection on first boot so the cascading
      // dropdown (Module 2.2) and resource search (Phase 4) always have
      // a working hierarchy without a manual `node scripts/seed-areas.js`
      // step. Idempotent: if any Area docs already exist, this is a no-op.
      // Can be bypassed with `SKIP_AREA_AUTOSEED=1` (useful for tests).
      if (process.env.SKIP_AREA_AUTOSEED !== "1") {
        try {
          const result = await seedAreasIfEmpty();
          if (result) {
            // eslint-disable-next-line no-console
            console.log(
              `[seed] areas seeded (${result.districts} districts, ` +
                `${result.upazilas} upazilas, ${result.unions} unions, ` +
                `${result.wards} wards, ${result.villages} villages)`
            );
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[seed] area auto-seed skipped: ${err.message}`);
        }
      }
    }
  } catch (err) {
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(`[db] FATAL: ${err.message}`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.warn(`[db] ${err.message}`);
  }

  // 3) Express + HTTP + Socket.io
  const app = createApp();
  const httpServer = http.createServer(app);

  const corsOrigin = process.env.CLIENT_ORIGIN || "*";
  initSocket(httpServer, { corsOrigin });

  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] listening on http://localhost:${PORT}  (env=${NODE_ENV})`,
    );
  });

  // 4) Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[server] received ${signal}, shutting down...`);
    httpServer.close(async () => {
      try {
        await disconnectDB();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
    // hard exit if close hangs
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
