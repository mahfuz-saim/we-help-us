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
 * Classify a Mongoose / driver connection error and produce a helpful,
 * actionable message. We intentionally do not throw here — we just build
 * text to log/raise. The caller decides whether to keep going or fail.
 *
 * Common failure modes we detect:
 *   - SRV / DNS resolution failures (`mongodb+srv://` with broken DNS).
 *     Node 24 + Windows c-ares is known to fail SRV queries even when
 *     nslookup works. Workaround: use the non-SRV (direct) connection
 *     string from Atlas instead.
 *   - IP not whitelisted in Atlas (the driver's whitelist hint).
 *   - Auth failures (bad user/password).
 *   - Generic network errors (timeout, reset, unreachable).
 */
function describeConnectionError(err, uri) {
  const raw = (err && err.message) || String(err);
  const code = err && err.code;
  const isSrv = typeof uri === 'string' && uri.startsWith('mongodb+srv://');

  // 1) SRV / DNS failure
  if (
    isSrv &&
    (raw.includes('querySrv') ||
      raw.includes('queryA') ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ESERVFAIL' ||
      code === 'ETIMEOUT')
  ) {
    return (
      `DNS/SRV lookup failed for the Atlas cluster (${raw}). ` +
      'This is often a Node.js / Windows resolver quirk with the ' +
      'mongodb+srv:// URI scheme. ' +
      'Workaround: replace MONGODB_URI with the non-SRV (direct) ' +
      'connection string from the Atlas "Connect → Drivers" dialog ' +
      '(it lists each shard host with port 27017).'
    );
  }

  // 2) Atlas IP whitelist hint
  if (/IP that isn't whitelisted|IP whitelist/i.test(raw)) {
    return (
      `Atlas says the current IP is not whitelisted. ` +
      'Open Atlas → Network Access → add your current IP (or 0.0.0.0/0 ' +
      'for development) and retry. Underlying error: ' +
      raw
    );
  }

  // 3) Auth failure
  if (
    /Authentication failed|bad auth|invalid username or password/i.test(raw) ||
    code === 'EAUTH'
  ) {
    return (
      `MongoDB authentication failed. Check the username/password in ` +
      `MONGODB_URI. Underlying error: ${raw}`
    );
  }

  // 4) Network / unreachable / timeout
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    return `Network error reaching MongoDB (${code}): ${raw}`;
  }

  // 5) Unknown — return raw with a hint to inspect logs.
  return raw;
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
        const described = describeConnectionError(err, uri);
        if (attempt > maxRetries) break;

        const delay =
          DEFAULT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logWarn(
          `connect attempt ${attempt} failed: ${described}. ` +
            `Retrying in ${delay}ms (${maxRetries - attempt + 1} left).`
        );
        await sleep(delay);
      }
    }

    const described = describeConnectionError(lastErr, uri);
    const message = `Could not connect to MongoDB after ${maxRetries + 1} attempt(s): ${described}`;
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
  describeConnectionError,
};
