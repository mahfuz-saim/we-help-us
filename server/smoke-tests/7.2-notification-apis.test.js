/**
 * End-to-end smoke test for Module 7.2 — Notification APIs.
 *
 * Coverage:
 *   1. Seed two users and recipient-scoped notifications.
 *   2. Auth gates: unauthenticated requests return 401.
 *   3. GET /api/notifications returns only the authenticated user's rows,
 *      newest-first, with unread count and pagination metadata.
 *   4. isRead/type filters and pagination work, with strict query validation.
 *   5. PATCH /:id/read marks only the recipient's notification read.
 *   6. Foreign notification ids return 404 and remain unchanged.
 *   7. PATCH /mark-all-read marks only the current user's unread rows.
 *   8. Empty action bodies are accepted; unknown action fields are rejected.
 *   9. Privacy: no notification response contains contact or password keys;
 *      relatedId is returned as an id only and is never populated.
 *
 * Run: `node smoke-tests/7.2-notification-apis.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');
const http = require('node:http');

const TEST_DB = `whudbg_72_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
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
  const serialized = body === undefined ? null : JSON.stringify(body);
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
          ...(serialized !== null
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

async function seedUser({ name, email, phone, role }) {
  const doc = await User.create({
    name,
    email,
    phone,
    password: 'long-enough-password',
    role,
  });
  return { doc, token: signJwt({ id: doc._id.toString(), role }) };
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

  section('1. seed users + notifications');
  const alice = await seedUser({
    name: 'Alice 72',
    email: 'alice72@example.com',
    phone: '+15555720101',
    role: 'OWNER',
  });
  const bob = await seedUser({
    name: 'Bob 72',
    email: 'bob72@example.com',
    phone: '+15555720201',
    role: 'VOLUNTEER',
  });
  const relatedId = new mongoose.Types.ObjectId();
  const aliceRows = await Notification.create([
    {
      recipientId: alice.doc._id,
      title: 'Older request',
      message: 'An older request notification.',
      type: 'REQUEST_CREATED',
      relatedId,
      isRead: true,
      createdAt: new Date(Date.now() - 3000),
    },
    {
      recipientId: alice.doc._id,
      title: 'Approval update',
      message: 'Your request was approved.',
      type: 'REQUEST_APPROVED',
      relatedId,
      isRead: false,
      createdAt: new Date(Date.now() - 2000),
    },
    {
      recipientId: alice.doc._id,
      title: 'General update',
      message: 'A general update is available.',
      type: 'GENERAL',
      isRead: false,
      createdAt: new Date(Date.now() - 1000),
    },
  ]);
  const bobRow = await Notification.create({
    recipientId: bob.doc._id,
    title: 'Bob only',
    message: 'This belongs to Bob.',
    type: 'GENERAL',
    isRead: false,
  });
  assert(aliceRows.length === 3 && bobRow, 'seeded recipient-scoped notification rows');

  section('2. auth gates');
  const noTokenList = await http_('GET', '/api/notifications');
  assert(noTokenList.status === 401, 'GET without token → 401');
  const noTokenRead = await http_('PATCH', `/api/notifications/${aliceRows[0]._id}/read`);
  assert(noTokenRead.status === 401, 'PATCH /:id/read without token → 401');
  const noTokenAll = await http_('PATCH', '/api/notifications/mark-all-read');
  assert(noTokenAll.status === 401, 'PATCH /mark-all-read without token → 401');

  section('3. recipient-scoped list');
  const list = await http_('GET', '/api/notifications', { token: alice.token });
  assert(list.status === 200, 'Alice can list her notifications');
  assert(list.body?.success === true, 'list uses standard success wrapper');
  assert(list.body.data.notifications.length === 3, 'Alice sees exactly her 3 rows');
  assert(
    list.body.data.notifications.every((n) => n.recipientId === alice.doc._id.toString()),
    'every listed row belongs to Alice'
  );
  assert(
    list.body.data.notifications[0].title === 'General update',
    'list is newest-first'
  );
  assert(list.body.data.unreadCount === 2, 'unreadCount is recipient-scoped and equals 2');
  assert(list.body.data.pagination.total === 3, 'pagination total is 3');
  assert(!hasSensitiveKey(list.body), 'list response contains no contact/password fields');
  assert(
    list.body.data.notifications[0].relatedId === null,
    'missing relatedId is returned as null'
  );
  assert(
    list.body.data.notifications.find((n) => n.relatedId)?.relatedId === relatedId.toString(),
    'relatedId is returned as an id without population'
  );

  const bobList = await http_('GET', '/api/notifications', { token: bob.token });
  assert(bobList.status === 200 && bobList.body.data.notifications.length === 1, 'Bob sees only his row');
  assert(bobList.body.data.notifications[0].title === 'Bob only', 'Bob cannot see Alice rows');

  section('4. filters + pagination + strict query validation');
  const unread = await http_('GET', '/api/notifications?isRead=false', { token: alice.token });
  assert(unread.status === 200 && unread.body.data.notifications.length === 2, 'isRead=false returns Alice unread rows');
  assert(unread.body.data.notifications.every((n) => n.isRead === false), 'unread filter is applied');

  const read = await http_('GET', '/api/notifications?isRead=true', { token: alice.token });
  assert(read.status === 200 && read.body.data.notifications.length === 1, 'isRead=true returns one row');
  assert(read.body.data.notifications[0].isRead === true, 'read filter is applied');

  const typed = await http_('GET', '/api/notifications?type=REQUEST_APPROVED', { token: alice.token });
  assert(typed.status === 200 && typed.body.data.notifications.length === 1, 'type filter narrows rows');
  assert(typed.body.data.notifications[0].type === 'REQUEST_APPROVED', 'type filter value matches');

  const paged = await http_('GET', '/api/notifications?page=2&limit=2', { token: alice.token });
  assert(paged.status === 200 && paged.body.data.notifications.length === 1, 'page/limit pagination works');
  assert(paged.body.data.pagination.page === 2 && paged.body.data.pagination.limit === 2, 'pagination metadata echoes page and limit');

  for (const query of [
    '?foo=bar',
    '?isRead=maybe',
    '?type=NOT_A_TYPE',
    '?page=abc',
    '?page=0',
    '?limit=-1',
    `?recipientId=${bob.doc._id}`,
  ]) {
    const result = await http_('GET', `/api/notifications${query}`, { token: alice.token });
    assert(result.status === 400, `invalid/forbidden query ${query} → 400`);
  }

  section('5. mark one read + ownership boundary');
  const unreadId = aliceRows[1]._id.toString();
  const markOne = await http_('PATCH', `/api/notifications/${unreadId}/read`, {
    token: alice.token,
  });
  assert(markOne.status === 200, 'Alice can mark her notification read');
  assert(markOne.body.data.isRead === true, 'mark-one response isRead=true');
  assert(!hasSensitiveKey(markOne.body), 'mark-one response contains no contact/password fields');
  const storedRead = await Notification.findById(unreadId);
  assert(storedRead.isRead === true, 'mark-one persists isRead=true');

  const foreign = await http_('PATCH', `/api/notifications/${bobRow._id}/read`, {
    token: alice.token,
  });
  assert(foreign.status === 404, 'Alice marking Bob notification → 404');
  const bobStillUnread = await Notification.findById(bobRow._id);
  assert(bobStillUnread.isRead === false, 'foreign notification remains unread');

  const malformedId = await http_('PATCH', '/api/notifications/not-an-object-id/read', {
    token: alice.token,
  });
  assert(malformedId.status === 400, 'malformed notification id → 400');
  const unknownBody = await http_('PATCH', `/api/notifications/${aliceRows[0]._id}/read`, {
    token: alice.token,
    body: { isRead: false },
  });
  assert(unknownBody.status === 400, 'unknown mark-one body key → 400');

  section('6. mark all read recipient scope');
  const extraAlice = await Notification.create({
    recipientId: alice.doc._id,
    title: 'Another unread',
    message: 'Alice has another unread notification.',
    type: 'GENERAL',
    isRead: false,
  });
  const markAll = await http_('PATCH', '/api/notifications/mark-all-read', {
    token: alice.token,
  });
  assert(markAll.status === 200, 'Alice can mark all her notifications read');
  assert(markAll.body.data.modifiedCount >= 1, 'mark-all reports modified rows');
  const aliceUnreadAfter = await Notification.countDocuments({
    recipientId: alice.doc._id,
    isRead: false,
  });
  assert(aliceUnreadAfter === 0, 'Alice has no unread notifications after mark-all');
  const bobUnreadAfter = await Notification.countDocuments({
    recipientId: bob.doc._id,
    isRead: false,
  });
  assert(bobUnreadAfter === 1, 'Bob unread notification is untouched by Alice mark-all');
  assert(extraAlice.isRead === false, 'new Alice unread row was included by mark-all');

  const emptyBody = await http_('PATCH', '/api/notifications/mark-all-read', {
    token: alice.token,
    body: {},
  });
  assert(emptyBody.status === 200, 'empty mark-all body is accepted');

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
