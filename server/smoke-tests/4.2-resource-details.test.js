/**
 * End-to-end smoke test for Module 4.2 — Resource Details API.
 *
 * Module 4.2 is a pure-client module: the drill-down page calls the
 * existing GET /api/resources/:id endpoint that shipped in Module 3.2
 * (and has been stable since). This smoke test guards the contract
 * the details page depends on:
 *
 *   - Auth gate: 401 without a token.
 *   - 200 with the full publicResource() shape on a valid id.
 *   - 400 on a malformed id (CastError — ObjectId parse fails).
 *   - 404 on a syntactically-valid but unknown id.
 *   - Privacy boundary: the response NEVER exposes owner email,
 *     phone, or name (KEY DESIGN REMINDER — owner contact info stays
 *     hidden until Module 5.2 reveals it after APPROVED + COLLECTED).
 *   - The response shape carries every field the page renders:
 *     id, ownerId (string), category, title, description, photos,
 *     capacity, condition, status, areaId, location, createdAt,
 *     updatedAt.
 *   - The page never requests more than one id per call (no
 *     `?include=owner` or similar — confirms the server doesn't
 *     accidentally leak the related user document).
 *
 * Storage: same Atlas-ephemeral-DB pattern as 3.5 / 4.1 — per-run
 * `wehelpus_smoke_42_<ts>_<rand>` and dropped on teardown.
 *
 * Run: `node smoke-tests/4.2-resource-details.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

const mongoose = require('mongoose');
const http = require('http');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';
process.env.PORT = '0';
// Cloudinary not exercised (no photos uploaded in this test) — empty
// strings survive dotenv.config() and keep isCloudinaryConfigured false.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const TEST_DB = `wehelpus_smoke_42_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const User = require('../models/User');
const Resource = require('../models/Resource');
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
          ...(serialized ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, body: json, raw: buf });
        });
      }
    );
    req.on('error', reject);
    if (serialized !== null) req.write(serialized);
    req.end();
  });
}

async function start() {
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    throw new Error(
      'MONGODB_URI is not set. Copy server/.env.example to server/.env.'
    );
  }
  await mongoose.connect(baseUri, { dbName: TEST_DB });

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  console.log('  listening on', baseUrl);
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.dropDatabase();
    } catch (e) {
      console.warn('  warn: dropDatabase failed', e.message);
    }
    await mongoose.disconnect();
  }
}

async function run() {
  // ── 1. Seed owner + 2 resources ────────────────────────────────────
  console.log('\n--- 1. seed owner + 2 resources ---');
  const ownerDoc = await User.create({
    name: 'Alice Owner',
    email: 'alice-details@example.com',
    phone: '+8801710000301',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const otherOwnerDoc = await User.create({
    name: 'Bob Owner',
    email: 'bob-details@example.com',
    phone: '+8801710000302',
    password: 'long-enough-password',
    role: 'OWNER',
  });
  const volunteerDoc = await User.create({
    name: 'Vicky Volunteer',
    email: 'vicky-details@example.com',
    phone: '+8801710000303',
    password: 'long-enough-password',
    role: 'VOLUNTEER',
  });
  const ownerToken = signJwt({ id: ownerDoc._id.toString(), role: 'OWNER' });
  const otherOwnerToken = signJwt({
    id: otherOwnerDoc._id.toString(),
    role: 'OWNER',
  });
  const volunteerToken = signJwt({
    id: volunteerDoc._id.toString(),
    role: 'VOLUNTEER',
  });
  assert(ownerToken, 'tokens issued');

  // Seed two resources directly so we can pin location + capacity +
  // areaId without going through the multipart upload path. We also
  // seed a tiny area chain so resourceA carries a real `areaId` —
  // that's the populated-id-stays-a-string path the resource details
  // page hits (regression test for the [object Object] bug — see
  // 3.2-resource-api.test.js section 11).
  const areaDocForDetails = await mongoose.connection
    .collection('areas')
    .insertOne({
      country: 'BD',
      level: 'DISTRICT',
      name: 'Smoke District',
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const areaIdHexForDetails = areaDocForDetails.insertedId.toString();
  const resourceA = await Resource.create({
    ownerId: ownerDoc._id,
    category: 'MEDICAL',
    title: 'Field first-aid kit',
    description: 'A medium-sized first-aid kit stocked with bandages, antiseptic, and basic tools.',
    capacity: 8,
    condition: 'GOOD',
    status: 'AVAILABLE',
    location: { type: 'Point', coordinates: [90.4125, 23.8103] },
    areaId: areaIdHexForDetails,
  });
  const resourceB = await Resource.create({
    ownerId: otherOwnerDoc._id,
    category: 'TRANSPORTATION',
    title: 'Pickup truck',
    description: 'A reliable pickup truck that can carry up to one ton of supplies across the district.',
    capacity: 4,
    condition: 'GOOD',
    status: 'AVAILABLE',
  });
  assert(resourceA.id && resourceB.id, 'two resources seeded');

  // ── 2. Auth gate ────────────────────────────────────────────────────
  console.log('\n--- 2. auth gate ---');
  {
    const r = await http_('GET', `/api/resources/${resourceA._id.toString()}`);
    assert(r.status === 401, 'GET /api/resources/:id without token → 401');
  }

  // ── 3. Happy path: valid id → 200 with publicResource() shape ─────
  console.log('\n--- 3. happy path ---');
  {
    const r = await http_('GET', `/api/resources/${resourceA._id.toString()}`, {
      token: volunteerToken,
    });
    assert(r.status === 200, 'GET /api/resources/:id → 200');
    assert(
      r.body && r.body.data && r.body.data.resource,
      '  response.data.resource present'
    );
    const res = r.body.data.resource;
    assert(res.id === resourceA._id.toString(), '  id matches');
    assert(typeof res.ownerId === 'string', '  ownerId is a string');
    assert(res.ownerId === ownerDoc._id.toString(), '  ownerId points at Alice');
    assert(res.category === 'MEDICAL', '  category echoed');
    assert(res.title === 'Field first-aid kit', '  title echoed');
    assert(typeof res.description === 'string', '  description echoed');
    assert(res.capacity === 8, '  capacity echoed');
    assert(res.condition === 'GOOD', '  condition echoed');
    assert(res.status === 'AVAILABLE', '  status echoed');
    assert(Array.isArray(res.photos) && res.photos.length === 0, '  photos is []');
    assert(
      res.location && Array.isArray(res.location.coordinates),
      '  location.coordinates is an array'
    );
    assert(res.createdAt && res.updatedAt, '  timestamps present');
  }

  // ── 4. Privacy boundary: NO owner contact info in the response ────
  console.log('\n--- 4. privacy boundary ---');
  {
    const r = await http_('GET', `/api/resources/${resourceA._id.toString()}`, {
      token: volunteerToken,
    });
    const blob = JSON.stringify(r.body);
    assert(!/alice-details@example\.com/.test(blob), '  no owner email leak');
    assert(!/\+8801710000301/.test(blob), '  no owner phone leak');
    // The owner's PUBLIC NAME is exposed by the single-resource fetch —
    // see commit 613d2bb ("fix(resources): show owner + area names on
    // resource details"). The privacy boundary is on contact info
    // (email/phone), not on name. Asserting the inverse: the response
    // DOES surface the populated ownerName so the page can render it.
    const res = r.body.data.resource;
    assert(res.ownerName === 'Alice Owner', '  ownerName surfaces the populated owner name');
    assert(res.areaName === 'Smoke District', '  areaName surfaces the populated area name');
    // The other owner's details mustn't leak on resource B either.
    const r2 = await http_('GET', `/api/resources/${resourceB._id.toString()}`, {
      token: volunteerToken,
    });
    const blob2 = JSON.stringify(r2.body);
    assert(!/bob-details@example\.com/.test(blob2), '  no other-owner email leak');
    assert(!/\+8801710000302/.test(blob2), '  no other-owner phone leak');
    assert(r2.body.data.resource.ownerName === 'Bob Owner', '  resource B ownerName surfaces Bob');

    // The resource response also doesn't expose the full User doc —
    // ownerId is the only owner-side field exposed. Anything beyond
    // the publicResource() shape (password hash, isActive, role, etc.)
    // must NOT appear.
    const forbiddenUserFields = ['password', 'isActive', 'isVerified', 'role'];
    for (const field of forbiddenUserFields) {
      // ownerId itself is a string. We check that the *unrelated*
      // fields don't show up nested under any "owner" key.
      const ownerBlock = blob.match(/"owner"\s*:\s*\{[^}]*\}/);
      assert(
        !ownerBlock || !new RegExp(`"${field}"`).test(ownerBlock[0]),
        `  no "${field}" leaks under any owner block`
      );
    }
  }

  // ── 5. 404 on unknown but well-formed id ───────────────────────────
  console.log('\n--- 5. unknown id → 404 ---');
  {
    const r = await http_(
      'GET',
      '/api/resources/000000000000000000000000',
      { token: volunteerToken }
    );
    assert(r.status === 404, 'GET unknown id → 404');
    assert(/resource not found/i.test(r.body && r.body.message),
      '  message says "Resource not found"');
  }

  // ── 6. 400 on malformed id ─────────────────────────────────────────
  console.log('\n--- 6. malformed id → 400 ---');
  {
    const r = await http_('GET', '/api/resources/not-an-objectid', {
      token: volunteerToken,
    });
    assert(r.status === 400, 'GET bad id → 400 (CastError)');

    const r2 = await http_('GET', '/api/resources/12345', {
      token: volunteerToken,
    });
    assert(r2.status === 400, 'GET short id → 400');

    const r3 = await http_('GET', '/api/resources/!@#$%^&*()', {
      token: volunteerToken,
    });
    // The 400 here comes from the route param decoder / CastError —
    // it should never silently fall through to a 200 or 500.
    assert(
      r3.status === 400 || r3.status === 404,
      `GET malformed id → 400/404 (got ${r3.status})`
    );
  }

  // ── 7. Resource with no location still renders ─────────────────────
  console.log('\n--- 7. resource without location ---');
  {
    const r = await http_('GET', `/api/resources/${resourceB._id.toString()}`, {
      token: volunteerToken,
    });
    assert(r.status === 200, 'GET resource without location → 200');
    assert(r.body.data.resource.location == null,
      '  location is null when owner did not set it');
  }

  // ── 8. The single-resource endpoint doesn't accept query params ────
  // Module 4.2's page never sends query params. We assert this isn't
  // a public attack surface: an unknown query key doesn't change the
  // response (the route handler is param-less — there's no zod schema
  // to fail). What matters here is that the response still 200s and
  // still excludes owner contact info.
  console.log('\n--- 8. unknown query keys are ignored on /:id ---');
  {
    const r = await http_(
      'GET',
      `/api/resources/${resourceA._id.toString()}?include=owner&evil=1`,
      { token: volunteerToken }
    );
    assert(r.status === 200, 'GET /:id?include=owner&evil=1 → 200 (ignored)');
    assert(
      r.body.data.resource.ownerId === ownerDoc._id.toString(),
      '  ownerId unchanged'
    );
    const blob = JSON.stringify(r.body);
    assert(!/alice-details@example\.com/.test(blob), '  no email leak even with ?include=owner');
    assert(!/\+8801710000301/.test(blob), '  no phone leak even with ?include=owner');
  }

  // ── 9. /:id works for every role (the route guard is just `protect`)
  console.log('\n--- 9. every role can read ---');
  {
    const ownerR = await http_(
      'GET',
      `/api/resources/${resourceA._id.toString()}`,
      { token: ownerToken }
    );
    assert(ownerR.status === 200, '  OWNER can GET /:id');

    const otherR = await http_(
      'GET',
      `/api/resources/${resourceA._id.toString()}`,
      { token: otherOwnerToken }
    );
    assert(otherR.status === 200, '  other OWNER can GET /:id');
  }

  // ── 10. The endpoint is stable against the 4.1 list endpoint ──────
  // The single-resource endpoint must agree with the list endpoint
  // on ownerId (Module 4.1 ships the list endpoint that the search
  // page renders cards from — clicking a card drills into /:id).
  console.log('\n--- 10. list vs single agree on ownerId ---');
  {
    const list = await http_('GET', '/api/resources', { token: volunteerToken });
    const a = list.body.data.resources.find(
      (x) => x.id === resourceA._id.toString()
    );
    assert(a, '  resource A is in the list');
    assert(a.ownerId === ownerDoc._id.toString(), '  list ownerId matches Alice');

    const single = await http_(
      'GET',
      `/api/resources/${resourceA._id.toString()}`,
      { token: volunteerToken }
    );
    assert(
      single.body.data.resource.ownerId === a.ownerId,
      '  single-resource ownerId matches the list endpoint'
    );
  }

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
