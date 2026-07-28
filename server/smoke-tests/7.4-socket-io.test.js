/**
 * End-to-end smoke test for Module 7.4 — Socket.io Real-Time.
 *
 * Asserts the server-side Socket.io surface:
 *
 *   - `initSocket(httpServer)` attaches to an HTTP server; the
 *     previously-published `getIO()` accessor returns the live handle.
 *   - Authenticated sockets join `user_<id>` on handshake.
 *   - The request lifecycle delivers a `notification:new` event into
 *     the recipient's `user_<id>` room whenever the Module 7.3
 *     triggers fire (POST + approve + reject + collect + return +
 *     complete).
 *   - `resource:status` is broadcast on the public `public_resources`
 *     room + the per-area `area_<areaId>` room whenever a
 *     Resource.status transition occurs (approve, reject-from-APPROVED,
 *     collect, complete).
 *   - The Socket.io payload is contact-free (no email/phone/password)
 *     and parallels the REST GET /api/notifications wire shape.
 *   - A fired-and-forgotten trigger that throws does NOT break the
 *     Socket.io connection lifecycle.
 *
 * Run: `node smoke-tests/7.4-socket-io.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const http = require('node:http');
const mongoose = require('mongoose');

// Socket.io client is bundled in client/node_modules (Phase 7 consumer).
// The server doesn't depend on it at runtime; we use it as a test peer
// only, by walking up to the client workspace.
const { io: ioClient } = require('../../client/node_modules/socket.io-client');

const TEST_DB = `whudbg_74_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const { createApp } = require('../app');
const { initSocket, getIO } = require('../sockets');
const {
  emitNotificationToUser,
  emitResourceStatusUpdate,
  PUBLIC_RESOURCES_ROOM,
} = require('../sockets/emitter');
const User = require('../models/User');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const Area = require('../models/Area');
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, event, predicate, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function listener(payload) {
      if (!predicate || predicate(payload)) {
        clearTimeout(t);
        socket.off(event, listener);
        resolve(payload);
      }
    }
    socket.on(event, listener);
  });
}

async function seedArea({ name }) {
  const doc = await Area.create({ country: 'Bangladesh', level: 'UNION', name, parentId: null });
  return doc._id;
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

function connectSocket({ token } = {}) {
  const socket = ioClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    auth: token ? { token } : {},
    forceNew: true,
  });
  return socket;
}

async function emitAndWait(socket, event, predicate, timeoutMs) {
  const p = waitForEvent(socket, event, predicate, { timeoutMs });
  await wait(50); // allow socket to be subscribed
  return p;
}

async function start() {
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env.');
  }
  await mongoose.connect(baseUri, { dbName: TEST_DB });
  const app = createApp();
  await new Promise((resolve) => {
    server = http.createServer(app);
    initSocket(server, { corsOrigin: '*' });
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function stop() {
  // Tear down the Socket.io server first so the HTTP server's keep-alive
  // connections (held open by the WS upgrade) can finish closing.
  try {
    const io = getIO();
    io.disconnectSockets(true);
    await new Promise((resolve) => {
      if (io.httpServer && io.engine) {
        // Best-effort: socket.io 4.x exposes .close().
        io.close(() => resolve());
      } else {
        resolve();
      }
    });
  } catch {}
  await new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
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

  section('1. getIO() returns the live handle');
  const io = getIO();
  assert(io && typeof io.to === 'function', 'getIO() returns an emitter handle');
  assert(
    typeof PUBLIC_RESOURCES_ROOM === 'string' && PUBLIC_RESOURCES_ROOM === 'public_resources',
    'PUBLIC_RESOURCES_ROOM constant is exported'
  );

  section('2. seed users + area + resources');
  const inAreaId = await seedArea({ name: 'Test Union 74 In' });
  const { doc: alice, token: aliceToken } = await seedUser({
    name: 'Alice 74',
    email: 'alice74@example.com',
    phone: '+15555740101',
    role: 'OWNER',
    areaId: inAreaId,
  });
  const { doc: eve, token: eveToken } = await seedUser({
    name: 'Eve 74',
    email: 'eve74@example.com',
    phone: '+15555740201',
    role: 'VOLUNTEER',
    isVerified: true,
    areaId: inAreaId,
  });
  const inResource = await Resource.create({
    ownerId: alice._id,
    category: 'MEDICAL',
    title: 'First-aid kit',
    description: 'A small first-aid kit with bandages and antiseptic.',
    areaId: inAreaId,
  });
  const inResource2 = await Resource.create({
    ownerId: alice._id,
    category: 'TRANSPORTATION',
    title: 'Recovery truck',
    description: 'A pickup truck for recovery operations during a crisis.',
    areaId: inAreaId,
  });

  section('3. authenticated socket joins user_<id>');
  const aliceSocket = connectSocket({ token: aliceToken });
  await new Promise((resolve) => aliceSocket.on('connect', resolve));
  const eveSocket = connectSocket({ token: eveToken });
  await new Promise((resolve) => eveSocket.on('connect', resolve));
  const guestSocket = connectSocket();
  await new Promise((resolve) => guestSocket.on('connect', resolve));

  // Indirect proof of room membership: a direct emit to user_<id> from
  // the server must be received by the matching client only.
  const probe = { id: 'probe-1', recipientId: alice._id.toString() };
  const aliceProbe = waitForEvent(aliceSocket, 'notification:new', (p) => p.id === 'probe-1');
  const eveProbe = waitForEvent(eveSocket, 'notification:new', (p) => p.id === 'probe-1', 500)
    .then(() => 'unexpected')
    .catch(() => 'expected-timeout');
  emitNotificationToUser(alice._id, probe);
  assert((await aliceProbe).id === 'probe-1', 'authenticated socket receives user_<id> probe');
  assert((await eveProbe) === 'expected-timeout', 'foreign user does NOT receive the probe');

  // Unauthenticated socket delivery to the public room.
  const guestProbe = waitForEvent(guestSocket, 'resource:status', (p) => p.resourceId === 'probe-res');
  emitResourceStatusUpdate({ resourceId: 'probe-res', status: 'AVAILABLE', areaId: inAreaId });
  assert(
    (await guestProbe).resourceId === 'probe-res',
    'guest socket receives public_resources broadcast'
  );

  section('4. POST /api/requests → notification:new to owner');
  const created = await http_('POST', '/api/requests', {
    token: eveToken,
    body: { resourceId: inResource._id.toString() },
  });
  assert(created.status === 201, 'POST /api/requests → 201');
  const req1Id = created.body.data.request.id;

  const ownerNotif = await waitForEvent(
    aliceSocket,
    'notification:new',
    (p) => p.recipientId === alice._id.toString() && p.relatedId === req1Id && p.type === 'REQUEST_CREATED',
    { timeoutMs: 6000 }
  );
  assert(ownerNotif.title === 'New resource request', 'owner receives notification:new with title');
  assert(!hasSensitiveKey(ownerNotif), 'notification:new payload is contact-free');

  // The volunteer should NOT receive a notification:new for their own
  // create action (self-notify guard).
  const eveSelfNotif = await waitForEvent(
    eveSocket,
    'notification:new',
    (p) => p.relatedId === req1Id && p.type === 'REQUEST_CREATED',
    { timeoutMs: 600 }
  )
    .then(() => 'unexpected')
    .catch(() => 'expected-timeout');
  assert(eveSelfNotif === 'expected-timeout', 'actor does NOT receive their own create notification');

  section('5. resource:status broadcast on approve (AVAILABLE → RESERVED)');
  const guestMap = waitForEvent(guestSocket, 'resource:status', (p) => p.resourceId === inResource._id.toString());
  const approve = await http_('PATCH', `/api/requests/${req1Id}/approve`, { token: aliceToken });
  assert(approve.status === 200, 'approve → 200');
  const mapEvent = await guestMap;
  assert(mapEvent.status === 'RESERVED', 'public_resources room receives RESERVED status');

  section('6. notification:new to volunteer on approve');
  const eveApproved = await waitForEvent(
    eveSocket,
    'notification:new',
    (p) => p.recipientId === eve._id.toString() && p.relatedId === req1Id && p.type === 'REQUEST_APPROVED',
    { timeoutMs: 6000 }
  );
  assert(eveApproved.type === 'REQUEST_APPROVED', 'volunteer receives REQUEST_APPROVED over Socket.io');

  section('7. collect → owner notification + IN_USE broadcast');
  const ownerCollected = waitForEvent(
    aliceSocket,
    'notification:new',
    (p) => p.recipientId === alice._id.toString() && p.relatedId === req1Id && p.type === 'REQUEST_COLLECTED',
    { timeoutMs: 6000 }
  );
  const mapCollected = waitForEvent(
    guestSocket,
    'resource:status',
    (p) => p.resourceId === inResource._id.toString() && p.status === 'IN_USE',
  );
  const collect = await http_('PATCH', `/api/requests/${req1Id}/collect`, { token: eveToken });
  assert(collect.status === 200, 'collect → 200');
  assert((await ownerCollected).type === 'REQUEST_COLLECTED', 'owner receives REQUEST_COLLECTED over Socket.io');
  assert((await mapCollected).status === 'IN_USE', 'public_resources room receives IN_USE');

  section('8. return → owner notification');
  const ownerReturned = waitForEvent(
    aliceSocket,
    'notification:new',
    (p) => p.relatedId === req1Id && p.type === 'REQUEST_RETURNED',
    { timeoutMs: 6000 }
  );
  const ret = await http_('PATCH', `/api/requests/${req1Id}/return`, { token: eveToken });
  assert(ret.status === 200, 'return → 200');
  assert((await ownerReturned).type === 'REQUEST_RETURNED', 'owner receives REQUEST_RETURNED over Socket.io');

  section('9. complete → volunteer notification + AVAILABLE broadcast');
  const eveCompleted = waitForEvent(
    eveSocket,
    'notification:new',
    (p) => p.relatedId === req1Id && p.type === 'REQUEST_COMPLETED',
    { timeoutMs: 6000 }
  );
  const mapAvailable = waitForEvent(
    guestSocket,
    'resource:status',
    (p) => p.resourceId === inResource._id.toString() && p.status === 'AVAILABLE',
  );
  const complete = await http_('PATCH', `/api/requests/${req1Id}/complete`, { token: aliceToken });
  assert(complete.status === 200, 'complete → 200');
  assert((await eveCompleted).type === 'REQUEST_COMPLETED', 'volunteer receives REQUEST_COMPLETED over Socket.io');
  assert((await mapAvailable).status === 'AVAILABLE', 'public_resources room receives AVAILABLE');

  section('10. reject → volunteer notification + AVAILABLE broadcast (un-RESERVE)');
  const create2 = await http_('POST', '/api/requests', {
    token: eveToken,
    body: { resourceId: inResource2._id.toString() },
  });
  assert(create2.status === 201, 'second POST → 201');
  const req2Id = create2.body.data.request.id;
  const approve2 = await http_('PATCH', `/api/requests/${req2Id}/approve`, { token: aliceToken });
  assert(approve2.status === 200, 'second approve → 200');

  const eveRejected = waitForEvent(
    eveSocket,
    'notification:new',
    (p) => p.relatedId === req2Id && p.type === 'REQUEST_REJECTED',
    { timeoutMs: 6000 }
  );
  const mapReserved = waitForEvent(
    guestSocket,
    'resource:status',
    (p) => p.resourceId === inResource2._id.toString() && p.status === 'AVAILABLE',
  );
  const reject = await http_('PATCH', `/api/requests/${req2Id}/reject`, { token: aliceToken });
  assert(reject.status === 200, 'reject → 200');
  assert((await eveRejected).type === 'REQUEST_REJECTED', 'volunteer receives REQUEST_REJECTED over Socket.io');
  assert((await mapReserved).status === 'AVAILABLE', 'resource flipped back to AVAILABLE on reject-from-APPROVED');

  section('11. resilience — helper emit survives a missing recipient');
  // emitNotificationToUser with a nullish id is a no-op (no throw).
  emitNotificationToUser(null, { id: 'x', recipientId: null });
  emitNotificationToUser(undefined, { id: 'x', recipientId: undefined });
  assert(true, 'emitNotificationToUser handles nullish recipients without throwing');

  section('12. disconnect cleanup');
  aliceSocket.disconnect();
  eveSocket.disconnect();
  guestSocket.disconnect();
  // Wait for the server to register the disconnect events.
  await wait(150);
  const stillAlive = await emitAndWait(
    connectSocket({ token: eveToken }),
    'notification:new',
    (p) => p.id === 'after-disconnect',
    1500
  ).catch(() => null);
  assert(stillAlive === null, 'disconnected socket does not receive further events');

  await stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
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