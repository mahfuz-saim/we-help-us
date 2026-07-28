/**
 * End-to-end smoke test for Module 5.1 — ResourceRequest Model.
 *
 * Validates the schema in isolation (no routes yet — those land in 5.2):
 *
 *   - Schema instantiates with a valid document and the four IDs
 *   - requiredAt defaults to a recent timestamp; the other three
 *     lifecycle timestamps default to null
 *   - Required fields reject: resourceId, ownerId, volunteerId
 *   - status enum enforcement (6 values: REQUESTED|APPROVED|REJECTED|
 *     COLLECTED|RETURNED|CANCELLED) — bad values fail validation
 *     with a friendly message
 *   - status defaults to REQUESTED on creation
 *   - moderatorNote length cap (1000 chars) and trim semantics
 *   - timestamps (createdAt / updatedAt) populated by Mongoose
 *   - All three ID fields are ObjectId refs to the right collections
 *     (Resource / User / User)
 *   - All four compound indexes are registered on the MongoDB
 *     collection with the expected key shapes and names
 *   - toJSON strips __v, exposes string id, keeps the lifecycle
 *     timestamps as Date / null
 *   - Static helpers exported: REQUEST_STATUS, REQUEST_STATUS_VALUES,
 *     ACTIVE_REQUEST_STATUSES, isActiveStatus(), hasActiveRequest()
 *   - ACTIVE_REQUEST_STATUSES contains exactly the three open states
 *     (REQUESTED / APPROVED / COLLECTED) — REJECTED / RETURNED /
 *     CANCELLED are not "active"
 *   - isActiveStatus() returns true for the active set, false otherwise
 *   - hasActiveRequest() returns the matching open request, or null
 *     if none exists or the existing one is closed
 *   - Privacy: the document does NOT denormalize any user contact
 *     info (no name/email/phone/password fields on the schema at all)
 *
 * Storage: Atlas-ephemeral-DB pattern (per-run `wehelpus_smoke_51_<ts>_<rand>`,
 * dropped on teardown). Same pattern as 3.5 / 4.1 / 4.2.
 *
 * Run: `node smoke-tests/5.1-resource-request-model.test.js` from `server/`.
 * Exit 0 = all assertions passed.
 */

const mongoose = require('mongoose');
// dotenv here mirrors the bootstrap in server.js and scripts/seed-areas.js
// — load MONGODB_URI / JWT_SECRET from server/.env before we read them.
// This test only loads the model (no app.js, no controllers), so it has
// to wire dotenv itself.
require('dotenv').config();

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';

const TEST_DB = `wehelpus_smoke_51_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const ResourceRequest = require('../models/ResourceRequest');

let mongoConnected = false;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

async function connect() {
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    throw new Error(
      'MONGODB_URI is not set. Copy server/.env.example to server/.env.'
    );
  }
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  await mongoose.connect(baseUri, { dbName: TEST_DB });
  mongoConnected = true;
}

async function disconnect() {
  if (!mongoConnected) return;
  try {
    await mongoose.connection.dropDatabase();
  } catch (e) {
    console.warn('  warn: dropDatabase failed', e.message);
  }
  await mongoose.disconnect();
  mongoConnected = false;
}

async function makeIds() {
  // ResourceRequest only needs ObjectIds for the three ID fields —
  // they don't need to point at real Resource / User docs because
  // this test never calls populate(). Mongoose validates the field
  // shape (ObjectId), not the existence of the referenced doc.
  const resourceId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();
  const volunteerId = new mongoose.Types.ObjectId();
  return { resourceId, ownerId, volunteerId };
}

async function run() {
  // ── 1. Schema sanity ─────────────────────────────────────────────────
  console.log('\n--- 1. Schema sanity ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();
    const before = Date.now();
    const doc = await ResourceRequest.create({
      resourceId,
      ownerId,
      volunteerId,
    });
    const after = Date.now();

    assert(doc !== null, 'ResourceRequest.create() with minimal fields succeeds');
    assert(
      doc.status === 'REQUESTED',
      '  default status is REQUESTED'
    );
    assert(
      doc.requestedAt instanceof Date,
      '  requestedAt defaults to a Date'
    );
    assert(
      doc.requestedAt.getTime() >= before &&
        doc.requestedAt.getTime() <= after,
      '  requestedAt is set to "now" at creation'
    );
    assert(doc.approvedAt === null, '  approvedAt defaults to null');
    assert(doc.collectedAt === null, '  collectedAt defaults to null');
    assert(doc.returnedAt === null, '  returnedAt defaults to null');
    assert(doc.moderatorNote === null, '  moderatorNote defaults to null');
    assert(doc.createdAt instanceof Date, '  createdAt is a Date');
    assert(doc.updatedAt instanceof Date, '  updatedAt is a Date');
  }

  // ── 2. Required fields reject ─────────────────────────────────────────
  console.log('\n--- 2. Required fields reject ---');
  {
    let err = null;
    try {
      await ResourceRequest.create({});
    } catch (e) {
      err = e;
    }
    assert(err && err.name === 'ValidationError', 'empty doc fails validation');
    const missing = Object.keys(err.errors || {}).sort();
    assert(
      missing.includes('resourceId'),
      '  resourceId is required (missing=' + missing.join(',') + ')'
    );
    assert(missing.includes('ownerId'), '  ownerId is required');
    assert(missing.includes('volunteerId'), '  volunteerId is required');
  }

  // ── 3. Enum enforcement ───────────────────────────────────────────────
  console.log('\n--- 3. Enum enforcement ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();
    const base = { resourceId, ownerId, volunteerId };

    let err = await ResourceRequest.create({
      ...base,
      status: 'NOT_A_STATUS',
    }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'invalid status rejected');
    assert(
      /status must be one of/i.test(err.errors.status.message),
      '  status error message mentions valid enum'
    );

    // The spec'd lifecycle has exactly 6 values. Try a near-miss
    // (uppercase typo) to confirm Mongoose is strict on the enum.
    let err2 = await ResourceRequest.create({
      ...base,
      status: 'requested', // wrong case
    }).catch((e) => e);
    assert(
      err2 && err2.name === 'ValidationError',
      'lowercase variant of a valid status is rejected'
    );
  }

  // ── 4. Default status ─────────────────────────────────────────────────
  console.log('\n--- 4. Default status ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();
    const doc = await ResourceRequest.create({ resourceId, ownerId, volunteerId });
    assert(doc.status === 'REQUESTED', 'status defaults to REQUESTED');
  }

  // ── 5. moderatorNote length cap + trim ───────────────────────────────
  console.log('\n--- 5. moderatorNote ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();

    const ok = await ResourceRequest.create({
      ...makeIds(),
      resourceId,
      ownerId,
      volunteerId,
      moderatorNote: '  Resolved by area moderator.  ',
    });
    assert(
      ok.moderatorNote === 'Resolved by area moderator.',
      'moderatorNote is trimmed (leading/trailing whitespace stripped)'
    );

    const long = 'A'.repeat(1001);
    let err = await ResourceRequest.create({
      resourceId: new mongoose.Types.ObjectId(),
      ownerId: new mongoose.Types.ObjectId(),
      volunteerId: new mongoose.Types.ObjectId(),
      moderatorNote: long,
    }).catch((e) => e);
    assert(
      err && err.name === 'ValidationError',
      'moderatorNote > 1000 chars rejected'
    );
    assert(
      /moderatorNote must be at most 1000 characters/.test(
        err.errors.moderatorNote.message
      ),
      '  moderatorNote error message is descriptive'
    );

    const exactly1000 = await ResourceRequest.create({
      resourceId: new mongoose.Types.ObjectId(),
      ownerId: new mongoose.Types.ObjectId(),
      volunteerId: new mongoose.Types.ObjectId(),
      moderatorNote: 'A'.repeat(1000),
    });
    assert(
      exactly1000.moderatorNote.length === 1000,
      'moderatorNote at exactly 1000 chars accepted'
    );
  }

  // ── 6. Timestamp updates via save() ───────────────────────────────────
  console.log('\n--- 6. Lifecycle timestamps set via save() ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();
    const doc = await ResourceRequest.create({
      resourceId,
      ownerId,
      volunteerId,
    });
    assert(doc.approvedAt === null, 'approvedAt is null on creation');

    doc.status = 'APPROVED';
    doc.approvedAt = new Date();
    await doc.save();

    const reloaded = await ResourceRequest.findById(doc._id);
    assert(reloaded.status === 'APPROVED', 'status moved to APPROVED');
    assert(reloaded.approvedAt instanceof Date, '  approvedAt is now a Date');
    assert(
      reloaded.collectedAt === null,
      '  collectedAt still null (not advanced yet)'
    );
    assert(reloaded.returnedAt === null, '  returnedAt still null');

    // Advance to COLLECTED.
    reloaded.status = 'COLLECTED';
    reloaded.collectedAt = new Date();
    await reloaded.save();

    const reloaded2 = await ResourceRequest.findById(doc._id);
    assert(reloaded2.status === 'COLLECTED', 'status moved to COLLECTED');
    assert(
      reloaded2.collectedAt instanceof Date,
      '  collectedAt is now a Date'
    );
  }

  // ── 7. Refs ───────────────────────────────────────────────────────────
  console.log('\n--- 7. Refs ---');
  {
    const paths = ResourceRequest.schema.paths;
    assert(
      paths.resourceId && paths.resourceId.instance === 'ObjectId',
      'resourceId is ObjectId'
    );
    assert(
      paths.resourceId.options.ref === 'Resource',
      '  resourceId ref is Resource'
    );
    assert(
      paths.ownerId && paths.ownerId.instance === 'ObjectId',
      'ownerId is ObjectId'
    );
    assert(paths.ownerId.options.ref === 'User', '  ownerId ref is User');
    assert(
      paths.volunteerId && paths.volunteerId.instance === 'ObjectId',
      'volunteerId is ObjectId'
    );
    assert(
      paths.volunteerId.options.ref === 'User',
      '  volunteerId ref is User'
    );
  }

  // ── 8. Indexes registered on the MongoDB collection ───────────────────
  console.log('\n--- 8. Indexes ---');
  {
    const indexes = await ResourceRequest.collection.indexes();
    const names = indexes.map((i) => i.name);
    assert(
      names.includes('resource_volunteer'),
      'resource_volunteer compound index exists'
    );
    const rv = indexes.find((i) => i.name === 'resource_volunteer');
    assert(
      rv.key.resourceId === 1 && rv.key.volunteerId === 1,
      '  resource_volunteer key order is resourceId, volunteerId'
    );

    assert(
      names.includes('owner_status'),
      'owner_status compound index exists'
    );
    const os = indexes.find((i) => i.name === 'owner_status');
    assert(
      os.key.ownerId === 1 && os.key.status === 1,
      '  owner_status key order is ownerId, status'
    );

    assert(
      names.includes('volunteer_status'),
      'volunteer_status compound index exists'
    );
    const vs = indexes.find((i) => i.name === 'volunteer_status');
    assert(
      vs.key.volunteerId === 1 && vs.key.status === 1,
      '  volunteer_status key order is volunteerId, status'
    );

    assert(
      names.includes('status_created'),
      'status_created compound index exists'
    );
    const sc = indexes.find((i) => i.name === 'status_created');
    assert(
      sc.key.status === 1 && sc.key.createdAt === -1,
      '  status_created key order is status ASC, createdAt DESC'
    );
  }

  // ── 9. toJSON transform ───────────────────────────────────────────────
  console.log('\n--- 9. toJSON transform ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();
    const doc = await ResourceRequest.create({
      resourceId,
      ownerId,
      volunteerId,
      moderatorNote: 'note',
    });
    const json = doc.toJSON();
    assert(typeof json.id === 'string' && json.id.length === 24, '  exposes string id');
    assert(json._id === undefined, '  strips _id');
    assert(json.__v === undefined, '  strips __v');
    assert(json.resourceId !== undefined, '  keeps resourceId');
    assert(json.ownerId !== undefined, '  keeps ownerId');
    assert(json.volunteerId !== undefined, '  keeps volunteerId');
    assert(json.status === 'REQUESTED', '  keeps status');
    assert(json.requestedAt instanceof Date, '  keeps requestedAt');
    assert(json.approvedAt === null, '  keeps approvedAt (null)');
    assert(json.collectedAt === null, '  keeps collectedAt (null)');
    assert(json.returnedAt === null, '  keeps returnedAt (null)');
    assert(json.moderatorNote === 'note', '  keeps moderatorNote');
    assert(json.createdAt !== undefined, '  keeps createdAt');
    assert(json.updatedAt !== undefined, '  keeps updatedAt');

    // Privacy — toJSON must NOT expose any contact info fields.
    for (const field of ['password', 'email', 'phone', 'name']) {
      assert(
        json[field] === undefined,
        `  toJSON does NOT expose ${field}`
      );
    }
  }

  // ── 10. Static helpers — REQUEST_STATUS + REQUEST_STATUS_VALUES ───────
  console.log('\n--- 10. Static helpers (REQUEST_STATUS) ---');
  {
    assert(
      ResourceRequest.REQUEST_STATUS &&
        ResourceRequest.REQUEST_STATUS.REQUESTED === 'REQUESTED',
      'REQUEST_STATUS exported'
    );
    assert(
      Array.isArray(ResourceRequest.REQUEST_STATUS_VALUES) &&
        ResourceRequest.REQUEST_STATUS_VALUES.length === 6,
      'REQUEST_STATUS_VALUES has 6 entries'
    );
    // Order-only sanity: the six values match the spec'd lifecycle.
    assert(
      JSON.stringify(ResourceRequest.REQUEST_STATUS_VALUES) ===
        JSON.stringify([
          'REQUESTED',
          'APPROVED',
          'REJECTED',
          'COLLECTED',
          'RETURNED',
          'CANCELLED',
        ]),
      '  REQUEST_STATUS values match the documented lifecycle exactly'
    );

    // Module-level exports mirror the statics.
    const mod = require('../models/ResourceRequest');
    assert(
      mod.REQUEST_STATUS === ResourceRequest.REQUEST_STATUS,
      'module-level REQUEST_STATUS equals static'
    );
    assert(
      mod.REQUEST_STATUS_VALUES === ResourceRequest.REQUEST_STATUS_VALUES,
      'module-level REQUEST_STATUS_VALUES equals static'
    );
  }

  // ── 11. ACTIVE_REQUEST_STATUSES + isActiveStatus() ────────────────────
  console.log('\n--- 11. ACTIVE_REQUEST_STATUSES ---');
  {
    assert(
      Array.isArray(ResourceRequest.ACTIVE_REQUEST_STATUSES) &&
        ResourceRequest.ACTIVE_REQUEST_STATUSES.length === 3,
      'ACTIVE_REQUEST_STATUSES has 3 entries'
    );
    assert(
      JSON.stringify([...ResourceRequest.ACTIVE_REQUEST_STATUSES].sort()) ===
        JSON.stringify(['APPROVED', 'COLLECTED', 'REQUESTED']),
      '  ACTIVE_REQUEST_STATUSES is REQUESTED / APPROVED / COLLECTED'
    );

    // isActiveStatus returns true for active statuses, false otherwise.
    for (const s of ['REQUESTED', 'APPROVED', 'COLLECTED']) {
      assert(
        ResourceRequest.isActiveStatus(s) === true,
        `isActiveStatus('${s}') === true`
      );
    }
    for (const s of ['REJECTED', 'RETURNED', 'CANCELLED']) {
      assert(
        ResourceRequest.isActiveStatus(s) === false,
        `isActiveStatus('${s}') === false`
      );
    }
    // Defensive: garbage input returns false, doesn't throw.
    assert(
      ResourceRequest.isActiveStatus('GARBAGE') === false,
      'isActiveStatus(\'GARBAGE\') === false'
    );
    assert(
      ResourceRequest.isActiveStatus(null) === false,
      'isActiveStatus(null) === false'
    );
    assert(
      ResourceRequest.isActiveStatus(undefined) === false,
      'isActiveStatus(undefined) === false'
    );
  }

  // ── 12. hasActiveRequest() static helper ──────────────────────────────
  console.log('\n--- 12. hasActiveRequest() ---');
  {
    const { resourceId, ownerId, volunteerId } = await makeIds();

    // No doc yet → null.
    const none = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(none === null, 'no matching doc → null');

    // Create a REQUESTED request — should be returned.
    const req1 = await ResourceRequest.create({ resourceId, ownerId, volunteerId });
    const found1 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(found1 !== null, 'REQUESTED doc is found by hasActiveRequest');
    assert(found1._id.equals(req1._id), '  returns the same doc');

    // A second volunteer with no doc → null.
    const otherVolunteer = new mongoose.Types.ObjectId();
    const none2 = await ResourceRequest.hasActiveRequest(resourceId, otherVolunteer);
    assert(none2 === null, 'different volunteer → null');

    // Move req1 to REJECTED — should no longer count as active.
    req1.status = 'REJECTED';
    await req1.save();
    const none3 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(none3 === null, 'REJECTED doc is NOT active');

    // Move it to APPROVED — should be active again.
    req1.status = 'APPROVED';
    await req1.save();
    const found2 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(found2 !== null, 'APPROVED doc is active');

    // Move to COLLECTED — still active.
    req1.status = 'COLLECTED';
    await req1.save();
    const found3 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(found3 !== null, 'COLLECTED doc is active');

    // Move to RETURNED — terminal, no longer active.
    req1.status = 'RETURNED';
    await req1.save();
    const none4 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(none4 === null, 'RETURNED doc is NOT active');

    // CANCELLED — also terminal.
    req1.status = 'CANCELLED';
    await req1.save();
    const none5 = await ResourceRequest.hasActiveRequest(resourceId, volunteerId);
    assert(none5 === null, 'CANCELLED doc is NOT active');
  }

  // ── 13. Privacy: schema does not denormalize contact info ─────────────
  console.log('\n--- 13. Privacy boundary ---');
  {
    const paths = ResourceRequest.schema.paths;
    const pathNames = Object.keys(paths);
    for (const field of ['password', 'email', 'phone', 'name', 'ownerName', 'ownerEmail', 'ownerPhone']) {
      assert(
        !pathNames.includes(field),
        `schema has no "${field}" field (privacy boundary)`
      );
    }
    // The schema only carries IDs — no contact info denormalization.
    assert(pathNames.includes('resourceId'), 'schema carries resourceId');
    assert(pathNames.includes('ownerId'), 'schema carries ownerId');
    assert(pathNames.includes('volunteerId'), 'schema carries volunteerId');
  }

  // ── 14. Module-level freeze of exports ────────────────────────────────
  console.log('\n--- 14. Freeze of exported enums ---');
  {
    // The enum OBJECTS are frozen (so callers can't accidentally mutate
    // e.g. REQUEST_STATUS.REQUESTED = 'whatever'). The VALUE ARRAYS are
    // produced by Object.values() / spread, so freezing them would force
    // an awkward double-freeze dance — match the Resource.js pattern
    // (which only freezes the enum objects).
    assert(
      Object.isFrozen(ResourceRequest.REQUEST_STATUS),
      'REQUEST_STATUS enum object is frozen'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.REQUESTED === 'REQUESTED',
      '  REQUEST_STATUS.REQUESTED is the expected string'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.APPROVED === 'APPROVED',
      '  REQUEST_STATUS.APPROVED is the expected string'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.REJECTED === 'REJECTED',
      '  REQUEST_STATUS.REJECTED is the expected string'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.COLLECTED === 'COLLECTED',
      '  REQUEST_STATUS.COLLECTED is the expected string'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.RETURNED === 'RETURNED',
      '  REQUEST_STATUS.RETURNED is the expected string'
    );
    assert(
      ResourceRequest.REQUEST_STATUS.CANCELLED === 'CANCELLED',
      '  REQUEST_STATUS.CANCELLED is the expected string'
    );
  }

  await disconnect();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  try {
    await connect();
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    if (mongoConnected) {
      try {
        await disconnect();
      } catch {}
    }
    process.exitCode = 1;
  }
})();