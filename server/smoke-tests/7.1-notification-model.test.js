/**
 * End-to-end smoke test for Module 7.1 — Notification Model.
 *
 * Validates the schema in isolation (no routes yet — those land in 7.2):
 *
 *   - Schema instantiates with a valid document
 *   - Required fields reject with validation errors
 *     (recipientId, title, message)
 *   - Enum enforcement on `type`
 *   - Title / message length validation (1–120 / 1–1000)
 *   - isRead defaults to false and is settable
 *   - relatedId accepts ObjectId, accepts null (polymorphic-by-design)
 *   - recipientId is an ObjectId with the right `ref`
 *   - createdAt is a Date and is set automatically
 *   - toJSON strips __v, exposes string id, preserves the rest
 *   - Indexes registered on the actual MongoDB collection
 *     (recipient_read_created)
 *   - Static helpers exposed (TYPES, TYPE_VALUES)
 *   - Module-level exports mirror the statics
 *
 * Run: `node smoke-tests/7.1-notification-model.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';

const Notification = require('../models/Notification');

let mongo;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

async function makeRecipientId() {
  // Notification.recipientId references User. We don't need a real User doc
  // for these checks — a freshly generated ObjectId is enough to satisfy the
  // ObjectId path validation.
  return new mongoose.Types.ObjectId();
}

async function run() {
  // ── 1. Schema sanity ─────────────────────────────────────────────────
  console.log('\n--- 1. Schema sanity ---');
  {
    const recipientId = await makeRecipientId();
    const doc = await Notification.create({
      recipientId,
      title: 'Your request was approved',
      message: 'The owner approved your request for the first-aid kit.',
      type: 'REQUEST_APPROVED',
    });
    assert(doc !== null, 'Notification.create() with required fields succeeds');
    assert(doc.isRead === false, '  isRead defaults to false');
    assert(doc.relatedId === null, '  relatedId defaults to null');
    assert(doc.createdAt instanceof Date, '  createdAt is a Date');
    assert(doc.updatedAt instanceof Date, '  updatedAt is a Date');
    assert(doc.type === 'REQUEST_APPROVED', '  type round-trips');
  }

  // ── 2. Required fields reject ────────────────────────────────────────
  console.log('\n--- 2. Required fields reject ---');
  {
    let err = null;
    try {
      await Notification.create({});
    } catch (e) {
      err = e;
    }
    assert(err && err.name === 'ValidationError', 'empty doc fails validation');
    const missing = Object.keys(err.errors || {}).sort();
    assert(
      missing.includes('recipientId'),
      '  recipientId is required (missing=' + missing.join(',') + ')'
    );
    assert(missing.includes('title'), '  title is required');
    assert(missing.includes('message'), '  message is required');
  }

  // ── 3. Enum enforcement on `type` ────────────────────────────────────
  console.log('\n--- 3. Enum enforcement on type ---');
  {
    const recipientId = await makeRecipientId();
    const base = {
      recipientId,
      title: 'Hi',
      message: 'A friendly ping.',
    };

    let err = await Notification.create({
      ...base,
      type: 'NOT_A_TYPE',
    }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'invalid type rejected');
    assert(
      /type must be one of/i.test(err.errors.type.message),
      '  type error message mentions valid enum'
    );

    // Default type is GENERAL when omitted.
    const def = await Notification.create(base);
    assert(def.type === 'GENERAL', 'type defaults to GENERAL');
  }

  // ── 4. Title / message length validation ─────────────────────────────
  console.log('\n--- 4. Title / message length ---');
  {
    const recipientId = await makeRecipientId();
    const base = { recipientId };

    // Empty title
    let err = await Notification.create({ ...base, title: '', message: 'ok' }).catch(
      (e) => e
    );
    assert(err && err.name === 'ValidationError', 'empty title rejected');

    // Too-long title
    let err2 = await Notification.create({
      ...base,
      title: 'A'.repeat(121),
      message: 'ok',
    }).catch((e) => e);
    assert(err2 && err2.name === 'ValidationError', 'title > 120 chars rejected');

    // Empty message
    let err3 = await Notification.create({ ...base, title: 'ok', message: '' }).catch(
      (e) => e
    );
    assert(err3 && err3.name === 'ValidationError', 'empty message rejected');

    // Too-long message
    let err4 = await Notification.create({
      ...base,
      title: 'ok',
      message: 'm'.repeat(1001),
    }).catch((e) => e);
    assert(err4 && err2.name === 'ValidationError', 'message > 1000 chars rejected');
  }

  // ── 5. isRead flag ───────────────────────────────────────────────────
  console.log('\n--- 5. isRead flag ---');
  {
    const recipientId = await makeRecipientId();
    const doc = await Notification.create({
      recipientId,
      title: 'Read me',
      message: 'Please read this notification.',
    });
    assert(doc.isRead === false, 'fresh notification is unread');
    doc.isRead = true;
    await doc.save();
    const reloaded = await Notification.findById(doc._id);
    assert(reloaded.isRead === true, 'isRead persists across save/reload');
  }

  // ── 6. relatedId polymorphic-by-design ───────────────────────────────
  console.log('\n--- 6. relatedId ---');
  {
    const recipientId = await makeRecipientId();
    const relatedId = new mongoose.Types.ObjectId();

    const withRelated = await Notification.create({
      recipientId,
      title: 'Request update',
      message: 'Your request was approved.',
      type: 'REQUEST_APPROVED',
      relatedId,
    });
    assert(
      withRelated.relatedId && withRelated.relatedId.toString() === relatedId.toString(),
      'relatedId accepts an ObjectId'
    );

    const withoutRelated = await Notification.create({
      recipientId,
      title: 'System',
      message: 'Welcome to We Help Us.',
      type: 'GENERAL',
    });
    assert(withoutRelated.relatedId === null, 'relatedId defaults to null when omitted');
  }

  // ── 7. recipientId is an ObjectId ref User ───────────────────────────
  console.log('\n--- 7. recipientId ref ---');
  {
    const paths = Notification.schema.paths;
    assert(
      paths.recipientId && paths.recipientId.instance === 'ObjectId',
      'recipientId is ObjectId'
    );
    assert(
      paths.recipientId.options.ref === 'User',
      '  recipientId ref is User'
    );
  }

  // ── 8. toJSON transform ───────────────────────────────────────────────
  console.log('\n--- 8. toJSON transform ---');
  {
    const recipientId = await makeRecipientId();
    const doc = await Notification.create({
      recipientId,
      title: 'Volunteer verified',
      message: 'A volunteer in your area was just verified.',
      type: 'VOLUNTEER_VERIFIED',
      relatedId: new mongoose.Types.ObjectId(),
    });
    const json = doc.toJSON();
    assert(typeof json.id === 'string' && json.id.length === 24, '  exposes string id');
    assert(json._id === undefined, '  strips _id');
    assert(json.__v === undefined, '  strips __v');
    assert(json.recipientId !== undefined, '  keeps recipientId');
    assert(json.title === 'Volunteer verified', '  keeps title');
    assert(json.message !== undefined, '  keeps message');
    assert(json.type === 'VOLUNTEER_VERIFIED', '  keeps type');
    assert(json.isRead === false, '  keeps isRead');
    assert(json.createdAt !== undefined, '  keeps createdAt');
  }

  // ── 9. Indexes registered on the MongoDB collection ──────────────────
  console.log('\n--- 9. Indexes ---');
  {
    const indexes = await Notification.collection.indexes();
    const names = indexes.map((i) => i.name);
    assert(
      names.includes('recipient_read_created'),
      'recipient_read_created compound index exists'
    );
    const compound = indexes.find((i) => i.name === 'recipient_read_created');
    assert(
      compound.key.recipientId === 1 &&
        compound.key.isRead === 1 &&
        compound.key.createdAt === -1,
      '  compound key order is recipientId, isRead, createdAt desc'
    );

    // recipientId index is created inline via `index: true` on the field.
    assert(names.some((n) => n !== '_id_'), '  at least one non-_id index registered');
  }

  // ── 10. Static helpers ───────────────────────────────────────────────
  console.log('\n--- 10. Static helpers ---');
  {
    assert(
      Notification.TYPES && Notification.TYPES.GENERAL === 'GENERAL',
      'Notification.TYPES exported'
    );
    assert(
      Array.isArray(Notification.TYPE_VALUES) && Notification.TYPE_VALUES.length >= 5,
      'TYPE_VALUES has the canonical lifecycle + general'
    );
    assert(
      Notification.TYPE_VALUES.includes('REQUEST_CREATED'),
      'TYPE_VALUES includes REQUEST_CREATED'
    );
    assert(
      Notification.TYPE_VALUES.includes('REQUEST_APPROVED'),
      'TYPE_VALUES includes REQUEST_APPROVED'
    );
    assert(
      Notification.TYPE_VALUES.includes('REQUEST_REJECTED'),
      'TYPE_VALUES includes REQUEST_REJECTED'
    );
    assert(
      Notification.TYPE_VALUES.includes('VOLUNTEER_VERIFIED'),
      'TYPE_VALUES includes VOLUNTEER_VERIFIED'
    );
    assert(
      Notification.TYPE_VALUES.includes('EMERGENCY_MODE'),
      'TYPE_VALUES includes EMERGENCY_MODE'
    );

    // Module-level exports mirror the statics.
    const mod = require('../models/Notification');
    assert(mod.NOTIFICATION_TYPES === Notification.TYPES, 'module-level TYPES equals static');
    assert(
      mod.NOTIFICATION_TYPE_VALUES === Notification.TYPE_VALUES,
      'module-level TYPE_VALUES equals static'
    );
  }

  await mongoose.disconnect();
  await mongo.stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('whu_test_71'));
  try {
    await run();
  } catch (err) {
    console.error('\n  ✗ FATAL:', err && err.message);
    console.error(err && err.stack);
    process.exitCode = 1;
    try {
      await mongoose.disconnect();
    } catch {}
    try {
      await mongo.stop();
    } catch {}
  }
})();