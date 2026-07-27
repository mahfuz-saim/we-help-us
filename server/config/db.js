/**
 * MongoDB (Mongoose) connection manager.
 *
 * Behavior (per plan.txt Module 0.4):
 *   - Reads MONGODB_URI from env.
 *   - In production (NODE_ENV=production): fail fast if URI is missing
 *     or the initial connection fails. No point serving traffic without
 *     a database.
 *   - In development: warn and continue if URI is missing, so the
 *     /api/health route still works while the developer is wiring things
 *     up. If the URI IS set but unreachable, we still fail loudly — a
 *     bad URI is almost always a config mistake we want to surface.
 *
 * Mongoose connection events (`connected`, `error`, `disconnected`,
 * `reconnected`, `close`) are surfaced through the standard log so
 * operators can see disconnects without attaching a debugger.
 */

const mongoose = require('mongoose');

const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 10000; // 10s
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;          // 10s
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;          // 1s, doubles each try

let connectionPromise = null;
let registeredEventHandlers = false;

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function logInfo(...args) {
  // eslint-disable-next-line no-console
  console.log('[db]', ...args);
}

function logWarn(...args) {
  // eslint-disable-next-line no-console
  console.warn('[db]', ...args);
}

function logError(...args) {
  // eslint-disable-next-line no-console
  console.error('[db]', ...args);
}

/**
 * Mask the credentials in a connection URI for safe logging.
 *   mongodb+srv://user:pass@cluster.mongodb.net/db
 *   → mongodb+srv://user:***@cluster.mongodb.net/db
 */
function maskUri(uri) {
  try {
    return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, '$1$2:***@');
  } catch {
    return '<unparseable URI>';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register connection event handlers exactly once.
 * Multiple connect() calls would otherwise leak listeners.
 */
function registerEventHandlers() {
  if (registeredEventHandlers) return;
  registeredEventHandlers = true;

  const conn = mongoose.connection;

  conn.on('connected', () => logInfo('connection established'));
  conn.on('reconnected', () => logInfo('connection re-established'));
  conn.on('disconnected', () =>
    logWarn('connection lost — Mongoose will attempt to reconnect')
  );
  conn.on('close', () => logInfo('connection closed'));
  conn.on('error', (err) => logError('connection error:', err.message));
}

function buildOptions() {
  const serverSelectionTimeoutMS = Number(
    process.env.DB_SERVER_SELECTION_TIMEOUT_MS ||
      DEFAULT_SERVER_SELECTION_TIMEOUT_MS
  );
  const connectTimeoutMS = Number(
    process.env.DB_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS
  );

  return {
    serverSelectionTimeoutMS,
    connectTimeoutMS,
    // autoIndex is on by default in dev and off in production by Mongoose's
    // own defaults. We leave it default for now; individual models can
    // opt in/out via schema options.
  };
}

async function tryConnectOnce() {
  mongoose.set('strictQuery', true);
  registerEventHandlers();
  await mongoose.connect(process.env.MONGODB_URI, buildOptions());
  return mongoose.connection;
}

/**
 * Connect to MongoDB Atlas (or any Mongoose-compatible URI).
 *
 * Returns the mongoose connection on success.
 * Throws on hard failure (production, or exhausted retries in dev).
 *
 * Side effect: idempotent — concurrent callers share a single in-flight
 * connection attempt.
 */
async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    const message =
      'MONGODB_URI is not set. Copy server/.env.example to server/.env and fill it in.';
    if (isProd()) {
      throw new Error(message);
    }
    logWarn(
      `${message} Skipping DB connection in dev — health route will still work.`
    );
    // Return without a connection; callers that depend on a DB will
    // surface their own errors when they try to query.
    return null;
  }

  logInfo(`connecting to ${maskUri(uri)}`);

  const maxRetries = isProd()
    ? 0 // prod: fail immediately on first failure
    : Number(process.env.DB_MAX_RETRIES ?? DEFAULT_MAX_RETRIES);

  connectionPromise = (async () => {
    let attempt = 0;
    let lastErr = null;
    while (attempt <= maxRetries) {
      try {
        const conn = await tryConnectOnce();
        logInfo(
          `connected (host=${conn.host}, db=${conn.name}, state=${conn.readyState})`
        );
        return conn;
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt > maxRetries) break;

        const delay =
          DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logWarn(
          `connect attempt ${attempt} failed: ${err.message}. ` +
            `Retrying in ${delay}ms (${maxRetries - attempt + 1} left).`
        );
        await sleep(delay);
      }
    }

    const message = `Could not connect to MongoDB after ${maxRetries + 1} attempt(s): ${lastErr?.message}`;
    if (isProd()) {
      throw new Error(message);
    }
    logWarn(`${message} Continuing without DB — /api/health will report db.connected=false.`);
    return null;
  })();

  try {
    return await connectionPromise;
  } finally {
    // Clear the cached promise so a later retry can kick off cleanly.
    connectionPromise = null;
  }
}

function isConnected() {
  return mongoose.connection.readyState === 1;
}

async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = {
  connectDB,
  isConnected,
  disconnectDB,
  maskUri,
};
