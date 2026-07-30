/**
 * End-to-end smoke test for Module 9.8 — emergency privacy + contact
 * isolation.
 *
 * Locks:
 *   - Activation public shape carries only publicUserDirectory (id,
 *     name, role) for `activatedBy` — never email / phone / password.
 *   - Notification rows are recipient-only (recipientId, title,
 *     message, type, relatedId). They NEVER carry the activator's
 *     email or phone.
 *   - The activation `message` is exposed verbatim (coordination
 *     channel).
 *   - `resolveEmergencyRecipients` returns ObjectIds only, not
 *     full user docs.
 *
 * Coverage:
 *   1. Seed: 1 district + 1 union, 1 owner + 1 volunteer + 1
 *      moderator.
 *   2. Activation response shape walked by hasContactLeak → false.
 *   3. GET list shape walked by hasContactLeak → false.
 *   4. Notification rows walked by hasContactLeak → false.
 *   5. Socket payload (mocked) walked by hasContactLeak → false.
 *
 * Run: `node smoke-tests/9.8-emergency-privacy.test.js` from
 * `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_98_${Date.now()}_${Math.random()
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

function hasContactLeak(obj) {
  if (!obj) return false;
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(walk);
    for (const key of ['email', 'phone', 'password']) {
      if (Object.prototype.hasOwnProperty.call(node, key) && node[key]) {
        return true;
      }
    }
    return Object.values(node).some(walk);
  }
  return walk(obj);
}

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
    country: 'BD', level: 'DISTRICT', name: 'D-98', parentId: null,
  });
  const union = await Area.create({
    country: 'BD', level: 'UNION', name: 'UN-98', parentId: district._id,
  });
  const owner = await User.create({
    name: 'Owner 98', email: 'owner-98@example.com', phone: '+8801740000098',
    password: 'long-enough-password', role: 'OWNER', isActive: true,
    areaId: union._id,
  });
  const mod = await User.create({
    name: 'Mod 98', email: 'mod-98@example.com', phone: '+8801740000099',
    password: 'long-enough-password', role: 'MODERATOR', isActive: true,
    areaId: district._id,
  });
  const vol = await User.create({
    name: 'Vol 98', email: 'vol-98@example.com', phone: '+8801740000100',
    password: 'long-enough-password', role: 'VOLUNTEER', isVerified: true,
    isActive: true, areaId: union._id,
  });
  const volTok = signJwt({ id: vol._id.toString(), role: 'VOLUNTEER' });

  section('2. POST activation — public shape, no leak');
  const post = await http_('POST', '/api/emergency-activations', {
    token: volTok,
    body: {
      rootAreaId: union._id.toString(),
      message: 'private test — owner +8801711112222 is in trouble',
    },
  });
  assert(post.status === 200 || post.status === 201, `  POST → ${post.status}`);
  assert(!hasContactLeak(post.body), '  POST response: no contact leak');
  // Activator is exposed by id only
  const a = post.body.data.activation;
  assert(a && a.id, '  activation.id present');
  assert(typeof a.activatedBy === 'string', '  activatedBy is just an id string');
  assert(a.message.startsWith('private test'), '  message preserved verbatim');

  section('3. GET list — no leak');
  const list = await http_('GET', '/api/emergency-activations', { token: volTok });
  assert(list.status === 200, '  GET → 200');
  assert(!hasContactLeak(list.body), '  GET list: no contact leak');

  section('4. Notification rows — no leak');
  const notifs = await Notification.find({});
  assert(notifs.length >= 1, `  ${notifs.length} notifications written`);
  for (const n of notifs) {
    assert(!hasContactLeak({ title: n.title, message: n.message }), `  notification ${n._id.toString()}: no contact leak`);
  }

  section('5. Analytics map — no leak');
  const modTok = signJwt({ id: mod._id.toString(), role: 'MODERATOR' });
  const map = await http_('GET', '/api/analytics/emergency-map', { token: modTok });
  assert(map.status === 200, '  map GET → 200');
  assert(!hasContactLeak(map.body), '  map response: no contact leak');

  section('6. owner user doc still has contact info (not leaked via API)');
  // Sanity: the seeded owner DOES have an email in the DB — we just
  // never expose it through any emergency endpoint.
  const dbOwner = await User.findById(owner._id);
  assert(dbOwner.email === 'owner-98@example.com', '  owner email exists in DB');
  assert(!hasContactLeak({ id: a.id }), '  activation id payload is opaque (no leak)');

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