/**
 * End-to-end smoke test for Module 9.9 — deactivate race + idempotency.
 *
 * Locks:
 *   - PATCH /:id/deactivate is idempotent (second call → 200, still
 *     isActive=false).
 *   - Two concurrent deactivates don't double-fire notifications.
 *   - After deactivation, no new notifications land for the prior
 *     activation id.
 *   - An activator can re-activate after deactivation (gate
 *     "one-active-per-volunteer" is satisfied again).
 *   - `EmergencyActivation.findOneAndUpdate({ _id, isActive: true }, ...)`
 *     is the only path that flips isActive=false — `updateMany`
 *     bypasses the gate (we still allow it for ops; smoke asserts
 *     via direct deactivation).
 *
 * Coverage:
 *   1. Seed: 1 union, 1 verified volunteer, 1 owner.
 *   2. Activate → id1.
 *   3. Deactivate → 200, isActive=false. Notification rows count
 *      captured before.
 *   4. Re-deactivate (same id) → 200, still isActive=false. No new
 *      notification rows.
 *   5. Concurrent double-deactivate via Promise.all — both → 200,
 *      still isActive=false. No new notification rows.
 *   6. Activate again after deactivate → 200, isActive=true. New
 *      activation id (id2 ≠ id1).
 *   7. Deactivate id2 → 200. DB has 2 rows, both isActive=false.
 *
 * Run: `node smoke-tests/9.9-emergency-deactivate-race.test.js`
 * from `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_99_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Area = require('../models/Area');
const EmergencyActivation = require('../models/EmergencyActivation');
const Notification = require('../models/Notification');
const { signJwt } = require('../utils/jwt');

let server;
let baseUrl;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

function http_(method, urlPath, { token, body } = {}) {
  const serialized = body ? JSON.stringify(body) : null;
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(serialized
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(serialized),
            }
          : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

async function start() {
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(baseUri, { dbName: TEST_DB });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState === 1) {
    try { await mongoose.connection.dropDatabase(); } catch {}
    await mongoose.disconnect();
  }
}

async function run() {
  section('1. seed');
  const district = await Area.create({
    country: 'BD', level: 'DISTRICT', name: 'D-99', parentId: null,
  });
  const union = await Area.create({
    country: 'BD', level: 'UNION', name: 'UN-99', parentId: district._id,
  });
  const owner = await User.create({
    name: 'Owner 99', email: 'owner-99@example.com', phone: '+8801750000091',
    password: 'long-enough-password', role: 'OWNER', isActive: true,
    areaId: union._id,
  });
  const vol = await User.create({
    name: 'Vol 99', email: 'vol-99@example.com', phone: '+8801750000092',
    password: 'long-enough-password', role: 'VOLUNTEER', isVerified: true,
    isActive: true, areaId: union._id,
  });
  const volTok = signJwt({ id: vol._id.toString(), role: 'VOLUNTEER' });

  section('2. activate (id1)');
  const post = await http_('POST', '/api/emergency-activations', {
    token: volTok,
    body: { rootAreaId: union._id.toString(), message: 'first' },
  });
  assert(post.status === 200 || post.status === 201, `  POST → ${post.status}`);
  const id1 = post.body.data.activation.id;
  assert(id1, '  id1 present');
  // Notification for the owner landed synchronously (Module 9 awaits).
  const notifsAfterActivate = await Notification.countDocuments({});
  assert(notifsAfterActivate >= 1, `  at least 1 notification after activate (got ${notifsAfterActivate})`);

  section('3. deactivate id1');
  const d1 = await http_('PATCH', `/api/emergency-activations/${id1}/deactivate`, {
    token: volTok,
  });
  assert(d1.status === 200, '  deactivate → 200');
  assert(d1.body.data.activation.isActive === false, '  isActive=false');
  const notifsAfterDeactivate = await Notification.countDocuments({});
  // Deactivation itself does NOT fire a new notification (no fan-out
  // for deactivations).
  assert(
    notifsAfterDeactivate === notifsAfterActivate,
    `  no new notifications after deactivate (was ${notifsAfterActivate}, now ${notifsAfterDeactivate})`
  );

  section('4. re-deactivate (idempotent)');
  const d1b = await http_('PATCH', `/api/emergency-activations/${id1}/deactivate`, {
    token: volTok,
  });
  assert(d1b.status === 200, '  re-deactivate → 200');
  assert(d1b.body.data.activation.isActive === false, '  still isActive=false');
  const notifsAfterReDeactivate = await Notification.countDocuments({});
  assert(
    notifsAfterReDeactivate === notifsAfterDeactivate,
    `  idempotent: no new notifications (was ${notifsAfterDeactivate}, now ${notifsAfterReDeactivate})`
  );

  section('5. concurrent double-deactivate (race)');
  // Re-activate first so the row isActive=true again, then fire two
  // PATCH /deactivate calls in parallel.
  const post2 = await http_('POST', '/api/emergency-activations', {
    token: volTok,
    body: { rootAreaId: union._id.toString(), message: 'second' },
  });
  assert(post2.status === 200 || post2.status === 201, `  re-activate → ${post2.status}`);
  const id2 = post2.body.data.activation.id;
  assert(id2 !== id1, '  new id2 differs from id1');
  const notifsBeforeRace = await Notification.countDocuments({});
  const [r1, r2] = await Promise.all([
    http_('PATCH', `/api/emergency-activations/${id2}/deactivate`, { token: volTok }),
    http_('PATCH', `/api/emergency-activations/${id2}/deactivate`, { token: volTok }),
  ]);
  assert(r1.status === 200 && r2.status === 200, `  both PATCH → 200 (got ${r1.status}, ${r2.status})`);
  assert(
    r1.body.data.activation.isActive === false &&
      r2.body.data.activation.isActive === false,
    '  both responses: isActive=false'
  );
  const notifsAfterRace = await Notification.countDocuments({});
  assert(
    notifsAfterRace === notifsBeforeRace,
    `  no new notifications from race (was ${notifsBeforeRace}, now ${notifsAfterRace})`
  );

  section('6. DB state');
  const allRows = await EmergencyActivation.find({}).lean();
  assert(allRows.length === 2, `  2 rows total in DB (got ${allRows.length})`);
  assert(
    allRows.every((r) => r.isActive === false),
    '  every row isActive=false'
  );

  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await start();
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
  } finally {
    await stop();
  }
})();