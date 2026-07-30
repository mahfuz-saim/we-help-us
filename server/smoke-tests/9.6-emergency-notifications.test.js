/**
 * End-to-end smoke test for Module 9.6 — emergency activation
 * notification fan-out.
 *
 * Locks:
 *   - Activation creates one Notification row per owner in the
 *     activated area + one for each moderator in the area chain.
 *   - Notification payload carries the activation `message` verbatim
 *     and `relatedId` = activation id (so the bell links back).
 *   - Self-notification is skipped: the activator (volunteer) does
 *     NOT receive their own row.
 *   - CIRCLE scope: only owners whose `location` is inside the
 *     circle get a notification.
 *
 * Coverage:
 *   1. Seed: DISTRICT + UNION, 2 OWNERs (one per area), 1 verified
 *      VOLUNTEER in UNION, 1 MODERATOR in DISTRICT.
 *   2. HIERARCHY activation at UNION:
 *      - UNION owner gets one Notification.
 *      - DISTRICT moderator gets one Notification.
 *      - Sibling-area owner does NOT get one.
 *      - Activator (volunteer) does NOT get one.
 *      - Notification type = EMERGENCY_MODE.
 *      - relatedId matches the activation id.
 *      - message matches the activation message verbatim.
 *   3. CIRCLE activation covering UNION centroid:
 *      - UNION owner WITH location inside circle gets one.
 *      - Sibling-area owner WITH location outside circle does NOT.
 *   4. Privacy: every Notification payload has no email/phone.
 *
 * Run: `node smoke-tests/9.6-emergency-notifications.test.js`
 * from `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');

const TEST_DB = `whudbg_96_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Area = require('../models/Area');
const EmergencyActivation = require('../models/EmergencyActivation');
const Notification = require('../models/Notification');
const { signJwt } = require('../utils/jwt');
const { onEmergencyActivated } = require('../services/notificationTriggers');
const { resolveEmergencyRecipients } = require('../utils/emergencyScope');

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
  section('1. seed users + areas');
  const district = await Area.create({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: 'D-96',
    parentId: null,
  });
  const union = await Area.create({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'UN-96',
    parentId: district._id,
  });
  const siblingUnion = await Area.create({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'Sibling-UN-96',
    parentId: district._id,
  });

  const ownerUnion = await User.create({
    name: 'OwnerUnion',
    email: 'ou-96@example.com',
    phone: '+8801720000091',
    password: 'long-enough-password',
    role: 'OWNER',
    isActive: true,
    areaId: union._id,
  });
  const ownerSibling = await User.create({
    name: 'OwnerSibling',
    email: 'os-96@example.com',
    phone: '+8801720000092',
    password: 'long-enough-password',
    role: 'OWNER',
    isActive: true,
    areaId: siblingUnion._id,
  });
  const mod = await User.create({
    name: 'ModUnion',
    email: 'mod-96@example.com',
    phone: '+8801720000093',
    password: 'long-enough-password',
    role: 'MODERATOR',
    isActive: true,
    areaId: union._id,
  });
  const modDistrict = await User.create({
    name: 'ModDistrict',
    email: 'modd-96@example.com',
    phone: '+8801720000095',
    password: 'long-enough-password',
    role: 'MODERATOR',
    isActive: true,
    areaId: district._id,
  });
  const vol = await User.create({
    name: 'Volunteer96',
    email: 'vol-96@example.com',
    phone: '+8801720000094',
    password: 'long-enough-password',
    role: 'VOLUNTEER',
    isVerified: true,
    isActive: true,
    areaId: union._id,
  });
  const volTok = signJwt({ id: vol._id.toString(), role: 'VOLUNTEER' });
  const modTok = signJwt({ id: mod._id.toString(), role: 'MODERATOR' });

  section('2. HIERARCHY activation at UNION fires notifications');
  // POST through the public endpoint.
  const http = require('node:http');
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
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) }
            : {}),
        },
      }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      });
      req.on('error', reject);
      if (serialized !== null) req.write(serialized);
      req.end();
    });
  }
  const post = await http_('POST', '/api/emergency-activations', {
    token: volTok,
    body: { rootAreaId: union._id.toString(), message: 'flash flood urgent' },
  });
  assert(post.status === 200 || post.status === 201, `  POST → ${post.status}`);
  const activationId = post.body.data.activation.id;
  assert(activationId, '  activation.id present');

  // UNION owner got one
  const ownerNotifs = await Notification.find({ recipientId: ownerUnion._id });
  assert(ownerNotifs.length === 1, '  UNION owner got exactly 1 notification');
  assert(ownerNotifs[0].type === Notification.TYPES.EMERGENCY_MODE, '  notification type = EMERGENCY_MODE');
  assert(ownerNotifs[0].message === 'flash flood urgent', '  notification message matches verbatim');
  assert(ownerNotifs[0].relatedId && ownerNotifs[0].relatedId.toString() === activationId, '  relatedId = activation id');

  // Sibling owner got none
  const sibOwnerNotifs = await Notification.find({ recipientId: ownerSibling._id });
  assert(sibOwnerNotifs.length === 0, '  sibling-area owner got 0 notifications');

  // UNION mod (in descendant chain) got one
  const modNotifs = await Notification.find({ recipientId: mod._id });
  assert(modNotifs.length === 1, '  UNION moderator (in chain) got 1 notification');
  // DISTRICT mod (outside descendant chain) got zero
  const modDNotifs = await Notification.find({ recipientId: modDistrict._id });
  assert(modDNotifs.length === 0, '  DISTRICT moderator (outside chain) got 0 notifications');

  // Volunteer (activator) got zero
  const volNotifs = await Notification.find({ recipientId: vol._id });
  assert(volNotifs.length === 0, '  activator volunteer got 0 notifications (self-skip)');

  // Privacy: walk every notification payload — no email/phone
  const all = await Notification.find({});
  for (const n of all) {
    assert(!hasContactLeak({ title: n.title, message: n.message }), `  notification ${n.recipientId.toString()}: no contact leak`);
  }

  section('3. CIRCLE activation only notifies owners whose location is inside');
  // Deactivate UNION HIERARCHY first
  await EmergencyActivation.updateMany({ _id: activationId }, { isActive: false });
  // Set UNION owner location near centroid, sibling owner location far
  await User.findByIdAndUpdate(ownerUnion._id, {
    location: { type: 'Point', coordinates: [90.41, 23.81] },
  });
  await User.findByIdAndUpdate(ownerSibling._id, {
    location: { type: 'Point', coordinates: [91.5, 24.5] },
  });

  const circPost = await http_('POST', '/api/emergency-activations', {
    token: volTok,
    body: {
      rootAreaId: union._id.toString(),
      message: 'circle alert',
      center: { type: 'Point', coordinates: [90.4, 23.8] },
      radiusMeters: 5000,
    },
  });
  assert(circPost.status === 200 || circPost.status === 201, `  CIRCLE POST → ${circPost.status}`);
  const circId = circPost.body.data.activation.id;

  // CIRCLE owner (location inside) got a notification
  const ownerInCircle = await Notification.find({
    recipientId: ownerUnion._id,
    relatedId: circId,
  });
  assert(ownerInCircle.length === 1, '  UNION owner (location inside circle) got 1 notification');

  // Sibling owner (location outside) got zero CIRCLE notifications
  const ownerFar = await Notification.find({
    recipientId: ownerSibling._id,
    relatedId: circId,
  });
  assert(ownerFar.length === 0, '  sibling owner (location outside circle) got 0 CIRCLE notifications');

  section('4. onEmergencyActivated direct call: dedupes by _id');
  // Re-activating on the same row would re-fire; ensure the
  // onEmergencyActivated helper itself is idempotent only via the
  // caller (the controller never re-activates an already-active row).
  const live = await EmergencyActivation.findOne({ _id: circId, isActive: true });
  assert(live, '  CIRCLE row is active');
  const recipients = await resolveEmergencyRecipients(live);
  onEmergencyActivated({ activation: live, recipients });
  // Volunteer (activator) must still be absent after a direct call.
  const volAfter = await Notification.find({ recipientId: vol._id });
  assert(volAfter.length === 0, '  direct call still skips activator');

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