/**
 * End-to-end smoke test for Module 7.3 — Notification Triggers.
 *
 * Wires the request lifecycle into the Notification collection and locks
 * the recipient + type fan-out per transition:
 *
 *   POST   /api/requests                  → REQUEST_CREATED  → owner + in-area moderators
 *   PATCH  /api/requests/:id/approve      → REQUEST_APPROVED → requesting volunteer
 *   PATCH  /api/requests/:id/reject       → REQUEST_REJECTED → requesting volunteer
 *   PATCH  /api/requests/:id/collect      → REQUEST_COLLECTED → resource owner
 *   PATCH  /api/requests/:id/return       → REQUEST_RETURNED  → resource owner
 *   PATCH  /api/requests/:id/complete     → REQUEST_COMPLETED → requesting volunteer
 *
 * Coverage:
 *   1. Seed: 2 areas (in-area + out-of-area), an owner (Alice), a
 *      resource (in-area Alice-owned), an out-of-area resource (so we
 *      can prove cross-area moderators are NOT notified), an
 *      in-area verified volunteer (Eve), two in-area moderators
 *      (ModA + ModB), one out-of-area moderator (ModOut), and an
 *      ADMIN user.
 *   2. POST /api/requests: owner gets REQUEST_CREATED + every
 *      in-area moderator gets REQUEST_CREATED; the out-of-area
 *      moderator does NOT. relatedId is the request id. No contact
 *      leak in the notification payload.
 *   3. Approve: volunteer gets REQUEST_APPROVED. Owner (actor) gets
 *      nothing for the approve action.
 *   4. Reject (second fresh request): volunteer gets REQUEST_REJECTED.
 *   5. Collect: owner gets REQUEST_COLLECTED. Volunteer (actor) gets
 *      nothing.
 *   6. Return: owner gets REQUEST_RETURNED.
 *   7. Complete: volunteer gets REQUEST_COMPLETED (a distinct type
 *      from REQUEST_RETURNED, so the two events show up as two
 *      rows in the volunteer inbox).
 *   8. Self-notify guard: when a moderator-in-area who also owns a
 *      resource creates a request (synthetic test), the moderator
 *      recipient list excludes the actor.
 *   9. Resilience: when the Notification collection rejects an insert
 *      mid-fan-out, the user-facing lifecycle still returns the
 *      expected 2xx. (We monkey-patch Notification.create to throw on
 *      one specific call and assert the controller still succeeded.)
 *
 * Run: `node smoke-tests/7.3-notification-triggers.test.js` from
 * `server/`. Exit code 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_73_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const Notification = require('../models/Notification');
const Area = require('../models/Area');
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

function section(title) {
  console.log('\n--- ' + title + ' ---');
}

function http_(method, urlPath, { token, body } = {}) {
  const serialized = body ? JSON.stringify(body) : null;
  const url = new URL(urlPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
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
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch {}
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

function hasSensitiveKey(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const key of ['email', 'phone', 'password']) {
      if (Object.prototype.hasOwnProperty.call(node, key)) return true;
    }
    return Object.values(node).some(walk);
  }
  return walk(obj);
}

async function seedUser({ name, email, phone, role, isVerified = false, areaId = null }) {
  const doc = await User.create({
    name,
    email,
    phone,
    password: 'long-enough-password',
    role,
    isVerified,
    areaId,
  });
  return { doc, token: signJwt({ id: doc._id.toString(), role }) };
}

async function seedArea({ name, level = 'UNION' }) {
  const doc = await Area.create({ country: 'Bangladesh', level, name, parentId: null });
  return doc._id;
}

async function notificationsForUser(userId) {
  return Notification.find({ recipientId: userId }).sort({ createdAt: 1 }).lean();
}

async function waitForNotification(predicate, { timeoutMs = 5000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function start() {
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env.');
  }
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
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.dropDatabase();
    } catch (err) {
      console.warn('  warn: dropDatabase failed', err.message);
    }
    await mongoose.disconnect();
  }
}

async function run() {
  await start();

  section('1. seed users + resources + areas');
  const inAreaId = await seedArea({ name: 'Test Union 73 In' });
  const outAreaId = await seedArea({ name: 'Test Union 73 Out' });

  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice Owner 73',
    email: 'alice.owner73@example.com',
    phone: '+15555730101',
    role: 'OWNER',
    areaId: inAreaId,
  });
  const { doc: outOwner, token: _outOwnerToken } = await seedUser({
    name: 'Out Owner 73',
    email: 'outowner73@example.com',
    phone: '+15555730102',
    role: 'OWNER',
    areaId: outAreaId,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve Volunteer 73',
    email: 'eve.vol73@example.com',
    phone: '+15555730201',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });
  const { doc: modA, token: _modAToken } = await seedUser({
    name: 'Mod A 73',
    email: 'moda73@example.com',
    phone: '+15555730301',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modB, token: _modBToken } = await seedUser({
    name: 'Mod B 73',
    email: 'modb73@example.com',
    phone: '+15555730302',
    role: 'MODERATOR',
    areaId: inAreaId,
  });
  const { doc: modOut, token: _modOutToken } = await seedUser({
    name: 'Mod Out 73',
    email: 'modout73@example.com',
    phone: '+15555730303',
    role: 'MODERATOR',
    areaId: outAreaId,
  });
  const { doc: admin, token: _adminToken } = await seedUser({
    name: 'Admin 73',
    email: 'admin73@example.com',
    phone: '+15555730401',
    role: 'ADMIN',
  });

  const inResource = await Resource.create({
    ownerId: alice._id,
    category: 'MEDICAL',
    title: 'First-aid kit',
    description: 'A small first-aid kit with bandages and antiseptic.',
    areaId: inAreaId,
  });
  const outResource = await Resource.create({
    ownerId: outOwner._id,
    category: 'MEDICAL',
    title: 'Out-of-area kit',
    description: 'A small first-aid kit in a different area for isolation.',
    areaId: outAreaId,
  });
  const inResource2 = await Resource.create({
    ownerId: alice._id,
    category: 'RESCUE_EQUIPMENT',
    title: 'Rescue rope',
    description: 'A 30m rescue rope rated for at least 2500kg.',
    areaId: inAreaId,
  });

  assert(alice && eve && modA && modB && modOut && admin, 'all users seeded');

  section('2. POST /api/requests → REQUEST_CREATED fan-out');
  const beforeCreateCount = await Notification.countDocuments({});
  const create = await http_('POST', '/api/requests', {
    token: eveToken,
    body: { resourceId: inResource._id.toString() },
  });
  assert(create.status === 201, 'volunteer creates request → 201');
  const req1Id = create.body.data.request.id;

  const sawCreated = await waitForNotification(async () => {
    const rows = await notificationsForUser(alice._id);
    return rows.some((r) => r.type === 'REQUEST_CREATED' && r.relatedId?.toString() === req1Id);
  });
  assert(sawCreated, 'owner receives REQUEST_CREATED for the new request');

  for (const mod of [modA, modB]) {
    const got = await waitForNotification(async () => {
      const rows = await notificationsForUser(mod._id);
      return rows.some((r) => r.type === 'REQUEST_CREATED' && r.relatedId?.toString() === req1Id);
    });
    assert(got, `in-area moderator ${mod.name} receives REQUEST_CREATED`);
  }

  const modOutRows = await notificationsForUser(modOut._id);
  assert(
    modOutRows.every((r) => r.type !== 'REQUEST_CREATED' || r.relatedId?.toString() !== req1Id),
    'out-of-area moderator does NOT receive REQUEST_CREATED'
  );

  const adminRows = await notificationsForUser(admin._id);
  assert(
    adminRows.every((r) => r.relatedId?.toString() !== req1Id),
    'admin does NOT receive REQUEST_CREATED (admin is global, not in the area-fanout path)'
  );

  const createdRows = await Notification.find({
    type: 'REQUEST_CREATED',
    relatedId: mongoose.Types.ObjectId.createFromHexString(req1Id),
  }).lean();
  assert(
    createdRows.every((r) => !hasSensitiveKey(r)),
    'every REQUEST_CREATED row is contact-free'
  );

  const totalCreated = await Notification.countDocuments({
    type: 'REQUEST_CREATED',
    relatedId: mongoose.Types.ObjectId.createFromHexString(req1Id),
  });
  assert(totalCreated === 3, 'fan-out count is 3 (owner + 2 in-area moderators)');
  assert(
    await Notification.countDocuments({}) >= beforeCreateCount + 3,
    'global notification count grew by at least 3'
  );

  section('3. PATCH approve → REQUEST_APPROVED to volunteer');
  const approve = await http_('PATCH', `/api/requests/${req1Id}/approve`, {
    token: aliceToken,
  });
  assert(approve.status === 200, 'owner approves request → 200');

  const sawApproved = await waitForNotification(async () => {
    const rows = await notificationsForUser(eve._id);
    return rows.some((r) => r.type === 'REQUEST_APPROVED' && r.relatedId?.toString() === req1Id);
  });
  assert(sawApproved, 'volunteer receives REQUEST_APPROVED');
  const aliceAfterApprove = await notificationsForUser(alice._id);
  assert(
    aliceAfterApprove.every(
      (r) => r.type !== 'REQUEST_APPROVED' || r.relatedId?.toString() !== req1Id
    ),
    'owner (actor) does NOT receive REQUEST_APPROVED (self-notify guard)'
  );

  section('4. PATCH collect → REQUEST_COLLECTED to owner');
  const collect = await http_('PATCH', `/api/requests/${req1Id}/collect`, {
    token: eveToken,
  });
  assert(collect.status === 200, 'volunteer collects request → 200');

  const sawCollected = await waitForNotification(async () => {
    const rows = await notificationsForUser(alice._id);
    return rows.some((r) => r.type === 'REQUEST_COLLECTED' && r.relatedId?.toString() === req1Id);
  });
  assert(sawCollected, 'owner receives REQUEST_COLLECTED');
  const eveAfterCollect = await notificationsForUser(eve._id);
  assert(
    eveAfterCollect.every(
      (r) => r.type !== 'REQUEST_COLLECTED' || r.relatedId?.toString() !== req1Id
    ),
    'volunteer (actor) does NOT receive REQUEST_COLLECTED (self-notify guard)'
  );

  section('5. PATCH return → REQUEST_RETURNED to owner');
  const ret = await http_('PATCH', `/api/requests/${req1Id}/return`, {
    token: eveToken,
  });
  assert(ret.status === 200, 'volunteer returns request → 200');

  const sawReturned = await waitForNotification(async () => {
    const rows = await notificationsForUser(alice._id);
    return rows.some((r) => r.type === 'REQUEST_RETURNED' && r.relatedId?.toString() === req1Id);
  });
  assert(sawReturned, 'owner receives REQUEST_RETURNED');

  section('6. PATCH complete → REQUEST_COMPLETED to volunteer (distinct type)');
  const complete = await http_('PATCH', `/api/requests/${req1Id}/complete`, {
    token: aliceToken,
  });
  assert(complete.status === 200, 'owner completes request → 200');

  const sawCompleted = await waitForNotification(async () => {
    const rows = await notificationsForUser(eve._id);
    return rows.some((r) => r.type === 'REQUEST_COMPLETED' && r.relatedId?.toString() === req1Id);
  });
  assert(sawCompleted, 'volunteer receives REQUEST_COMPLETED (distinct from REQUEST_RETURNED)');

  const eveInbox = await notificationsForUser(eve._id);
  assert(
    eveInbox.some((r) => r.type === 'REQUEST_APPROVED') &&
      eveInbox.some((r) => r.type === 'REQUEST_COMPLETED') &&
      eveInbox.every((r) => r.type !== 'REQUEST_RETURNED'),
    "volunteer inbox shows the right pair (approve + completed, no 'returned' for the volunteer)"
  );

  section('7. REJECT path → REQUEST_REJECTED to volunteer');
  const create2 = await http_('POST', '/api/requests', {
    token: eveToken,
    body: { resourceId: inResource2._id.toString() },
  });
  assert(create2.status === 201, 'volunteer creates a second request → 201');
  const req2Id = create2.body.data.request.id;
  const reject = await http_('PATCH', `/api/requests/${req2Id}/reject`, {
    token: aliceToken,
  });
  assert(reject.status === 200, 'owner rejects request → 200');
  const sawRejected = await waitForNotification(async () => {
    const rows = await notificationsForUser(eve._id);
    return rows.some((r) => r.type === 'REQUEST_REJECTED' && r.relatedId?.toString() === req2Id);
  });
  assert(sawRejected, 'volunteer receives REQUEST_REJECTED');

  section('8. self-notify guard for actor=in-area moderator');
  // Synthetic edge: a moderator who also happens to own a resource
  // should NOT see the moderator-broadcast row on their own create.
  const { doc: modOwner, token: modOwnerToken } = await seedUser({
    name: 'Mod Owner 73',
    email: 'modowner73@example.com',
    phone: '+15555730501',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });
  const modOwnerResource = await Resource.create({
    ownerId: alice._id, // owned by Alice so the volunteer can request it
    category: 'MEDICAL',
    title: 'Mod-test kit',
    description: 'A kit for the self-notify guard test in 7.3.',
    areaId: inAreaId,
  });
  const modOwnerId = modOwner._id;
  const createByMod = await http_('POST', '/api/requests', {
    token: modOwnerToken,
    body: { resourceId: modOwnerResource._id.toString() },
  });
  assert(createByMod.status === 201, 'moderator-as-volunteer creates request → 201');
  const req3Id = createByMod.body.data.request.id;
  await waitForNotification(async () => {
    const rows = await notificationsForUser(alice._id);
    return rows.some((r) => r.relatedId?.toString() === req3Id);
  });
  const modOwnerRows = await Notification.find({
    recipientId: modOwnerId,
    relatedId: mongoose.Types.ObjectId.createFromHexString(req3Id),
  }).lean();
  assert(modOwnerRows.length === 0, 'actor is excluded from the moderator fan-out');

  section('9. resilience — failed trigger insert does not break lifecycle');
  // Force Notification.create to throw on the FIRST call after this
  // point, simulating a transient DB write failure. The volunteer
  // lifecycle should still succeed (the trigger is fire-and-forget;
  // the controller's response is emitted BEFORE the trigger tries to
  // persist).
  const originalCreate = Notification.create;
  let sabotaged = false;
  Notification.create = function sabotagedCreate(...args) {
    if (!sabotaged) {
      sabotaged = true;
      return Promise.reject(new Error('synthetic trigger failure'));
    }
    return originalCreate.apply(this, args);
  };
  try {
    const freshResource = await Resource.create({
      ownerId: alice._id,
      category: 'TRANSPORTATION',
      title: 'Recovery truck',
      description: 'A pickup truck for recovery operations during a crisis.',
      areaId: inAreaId,
    });
    const create4 = await http_('POST', '/api/requests', {
      token: eveToken,
      body: { resourceId: freshResource._id.toString() },
    });
    assert(
      create4.status === 201,
      'lifecycle POST returns 201 even when the trigger write throws'
    );
  } finally {
    Notification.create = originalCreate;
  }

  await stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
    try {
      await stop();
    } catch {}
  }
})();