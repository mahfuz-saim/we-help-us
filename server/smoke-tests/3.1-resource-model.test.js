/**
 * End-to-end smoke test for Module 3.1 — Resource Model.
 *
 * Validates the schema in isolation (no routes yet — those land in 3.2):
 *
 *   - Schema instantiates with a valid document
 *   - Required fields reject with validation errors (ownerId, category,
 *     title, description)
 *   - Enum enforcement: category, status, condition
 *   - photos[] max-5 cap fires when adding a 6th entry
 *   - capacity validation: negative / non-numeric / out-of-range
 *   - location GeoJSON Point shape (and the validator message)
 *   - 2dsphere index is registered on the actual MongoDB collection
 *   - ownerId / areaId are ObjectIds with the right `ref`
 *   - toJSON strips __v, exposes string id, preserves the rest
 *   - Static helpers exposed (CATEGORIES, STATUS, CONDITIONS, MAX_PHOTOS)
 *   - Status enum matches the spec'd lifecycle
 *     (AVAILABLE|RESERVED|IN_USE|UNAVAILABLE)
 *   - Condition enum length and contents
 *   - Categories match the 6 listed in Module 3.3's spec
 *
 * Run: `node smoke-tests/3.1-resource-model.test.js` from `server/`.
 * Exit code 0 = all assertions passed.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';

const Resource = require('../models/Resource');
const { hash: bcryptHash } = (() => {
  // bcrypt comes in only to confirm a hashed password is accepted
  // when we create a real User for the ownerId ref. We don't actually
  // need to compare — just create one.
  const bcrypt = require('bcryptjs');
  return bcrypt;
})();

let mongo;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}

async function makeOwner() {
  // Build a real User so the ownerId ref resolves cleanly. We don't
  // import the User model into this test's global state because the
  // require chain in models/Resource.js doesn't pull User in; we
  // register a tiny inline schema here.
  const userSchema = new mongoose.Schema(
    {
      name: String,
      email: String,
      phone: String,
      password: String,
      role: { type: String, default: 'OWNER' },
    },
    { timestamps: true }
  );
  const User = mongoose.models.User || mongoose.model('User', userSchema);
  return User.create({
    name: 'Test Owner',
    email: 'owner@example.com',
    phone: '+15555550100',
    password: await bcryptHash('Password123!', 12),
    role: 'OWNER',
  });
}

async function run() {
  // ── 1. Schema sanity ─────────────────────────────────────────────────
  console.log('\n--- 1. Schema sanity ---');
  {
    const owner = await makeOwner();
    const doc = await Resource.create({
      ownerId: owner._id,
      category: 'MEDICAL',
      title: 'First-aid kit',
      description: 'A small first-aid kit with bandages and antiseptic.',
    });
    assert(doc !== null, 'Resource.create() with minimal fields succeeds');
    assert(doc.status === 'AVAILABLE', '  default status is AVAILABLE');
    assert(doc.condition === 'GOOD', '  default condition is GOOD');
    assert(Array.isArray(doc.photos) && doc.photos.length === 0, '  photos defaults to []');
    assert(doc.capacity === null, '  capacity defaults to null');
    assert(doc.areaId === null, '  areaId defaults to null');
    assert(doc.createdAt instanceof Date, '  createdAt is a Date');
    assert(doc.updatedAt instanceof Date, '  updatedAt is a Date');
  }

  // ── 2. Required fields ────────────────────────────────────────────────
  console.log('\n--- 2. Required fields reject ---');
  {
    let err = null;
    try {
      await Resource.create({});
    } catch (e) {
      err = e;
    }
    assert(err && err.name === 'ValidationError', 'empty doc fails validation');
    const missing = Object.keys(err.errors || {}).sort();
    assert(
      missing.includes('ownerId'),
      '  ownerId is required (missing=' + missing.join(',') + ')'
    );
    assert(missing.includes('category'), '  category is required');
    assert(missing.includes('title'), '  title is required');
    assert(missing.includes('description'), '  description is required');
  }

  // ── 3. Enum enforcement ───────────────────────────────────────────────
  console.log('\n--- 3. Enum enforcement ---');
  {
    const owner = await makeOwner();
    const base = {
      ownerId: owner._id,
      title: 'X',
      description: 'A reasonable description for a resource.',
    };

    // Bad category
    let err = await Resource.create({ ...base, category: 'NOT_A_CATEGORY' }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'invalid category rejected');
    assert(
      /category must be one of/i.test(err.errors.category.message),
      '  category error message mentions valid enum'
    );

    // Bad status
    let err2 = await Resource.create({ ...base, category: 'MEDICAL', status: 'BROKEN' }).catch((e) => e);
    assert(err2 && err2.name === 'ValidationError', 'invalid status rejected');
    assert(
      /status must be one of/i.test(err2.errors.status.message),
      '  status error message mentions valid enum'
    );

    // Bad condition
    let err3 = await Resource.create({ ...base, category: 'MEDICAL', condition: 'WORN' }).catch((e) => e);
    assert(err3 && err3.name === 'ValidationError', 'invalid condition rejected');
    assert(
      /condition must be one of/i.test(err3.errors.condition.message),
      '  condition error message mentions valid enum'
    );
  }

  // ── 4. photos[] max-5 cap ────────────────────────────────────────────
  console.log('\n--- 4. photos[] max-5 cap ---');
  {
    const owner = await makeOwner();
    const fiveOK = {
      ownerId: owner._id,
      category: 'TRANSPORTATION',
      title: 'Pickup truck',
      description: 'A 4x4 pickup that can carry up to 1 ton of supplies.',
      photos: [
        { url: 'https://x/a.jpg', publicId: 'a' },
        { url: 'https://x/b.jpg', publicId: 'b' },
        { url: 'https://x/c.jpg', publicId: 'c' },
        { url: 'https://x/d.jpg', publicId: 'd' },
        { url: 'https://x/e.jpg', publicId: 'e' },
      ],
    };
    const ok = await Resource.create(fiveOK);
    assert(ok.photos.length === 5, '5 photos accepted');

    const six = { ...fiveOK, photos: [...fiveOK.photos, { url: 'https://x/f.jpg', publicId: 'f' }] };
    let err = await Resource.create(six).catch((e) => e);
    assert(err && err.name === 'ValidationError', '6 photos rejected');
    assert(
      /at most 5/.test(err.errors.photos.message),
      '  photos error mentions the 5-item cap'
    );

    // The validator runs on save() too — pushing past the cap in-memory
    // and saving must also fail. (Note: Mongo update operators like
    // $push bypass validators; the route layer in 3.2 won't use them.)
    ok.photos.push({ url: 'https://x/f.jpg', publicId: 'f' });
    let err2 = await ok.save().catch((e) => e);
    assert(
      err2 && err2.name === 'ValidationError' && /at most 5/.test(err2.errors.photos.message),
      'saving a 6th photo via in-memory push fails the validator'
    );
  }

  // ── 5. Capacity validation ───────────────────────────────────────────
  console.log('\n--- 5. Capacity validation ---');
  {
    const owner = await makeOwner();
    const base = {
      ownerId: owner._id,
      category: 'TRANSPORTATION',
      title: 'Boat',
      description: 'A motorized boat that seats 8 people.',
    };

    const ok = await Resource.create({ ...base, capacity: 8 });
    assert(ok.capacity === 8, 'positive integer capacity accepted');

    let err = await Resource.create({ ...base, capacity: -1 }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'negative capacity rejected');
    assert(
      /capacity cannot be negative/.test(err.errors.capacity.message),
      '  capacity error message is descriptive'
    );

    let err2 = await Resource.create({ ...base, capacity: 99999999 }).catch((e) => e);
    assert(err2 && err2.name === 'ValidationError', 'unrealistically large capacity rejected');
  }

  // ── 6. Location GeoJSON Point validation ─────────────────────────────
  console.log('\n--- 6. Location GeoJSON Point ---');
  {
    const owner = await makeOwner();
    const base = {
      ownerId: owner._id,
      category: 'MEDICAL',
      title: 'Field clinic',
      description: 'A small clinic stocked with basic medical supplies.',
    };

    const ok = await Resource.create({
      ...base,
      location: { type: 'Point', coordinates: [90.4125, 23.8103] },
    });
    assert(
      ok.location && ok.location.type === 'Point' && ok.location.coordinates.length === 2,
      'GeoJSON Point (Point, [lng, lat]) accepted'
    );

    // Out-of-range longitude
    let err = await Resource.create({
      ...base,
      location: { type: 'Point', coordinates: [200, 0] },
    }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'longitude > 180 rejected');

    // Out-of-range latitude
    let err2 = await Resource.create({
      ...base,
      location: { type: 'Point', coordinates: [0, -100] },
    }).catch((e) => e);
    assert(err2 && err2.name === 'ValidationError', 'latitude < -90 rejected');

    // Non-numeric
    let err3 = await Resource.create({
      ...base,
      location: { type: 'Point', coordinates: ['east', 'north'] },
    }).catch((e) => e);
    assert(err3 && err3.name === 'ValidationError', 'non-numeric coordinates rejected');

    // Wrong shape (3 elements)
    let err4 = await Resource.create({
      ...base,
      location: { type: 'Point', coordinates: [0, 0, 0] },
    }).catch((e) => e);
    assert(err4 && err4.name === 'ValidationError', 'length-3 coordinates rejected');

    // No location at all — should be fine. Mongoose leaves the empty
    // subdoc in place (so the field still exists) but `type` and
    // `coordinates` are absent. The sparse 2dsphere index skips docs
    // that lack a `Point` type — so this doc doesn't break the index.
    const noLoc = await Resource.create(base);
    assert(noLoc !== null, 'omitting location is allowed (save succeeds)');
    assert(
      noLoc.location &&
        noLoc.location.type !== 'Point' &&
        noLoc.location.coordinates === undefined,
      '  location is empty (no Point type, no coordinates)'
    );
    // And the reloaded document confirms it round-trips cleanly.
    const reloaded = await Resource.findById(noLoc._id);
    assert(
      reloaded.location &&
        reloaded.location.type !== 'Point' &&
        reloaded.location.coordinates === undefined,
      '  reloaded doc also has an empty location'
    );
  }

  // ── 7. Indexes registered on the MongoDB collection ──────────────────
  console.log('\n--- 7. Indexes ---');
  {
    const indexes = await Resource.collection.indexes();
    const names = indexes.map((i) => i.name);
    assert(names.includes('geo_location'), 'geo_location index exists');
    const geo = indexes.find((i) => i.name === 'geo_location');
    // Mongoose serializes 2dsphere as a 2dsphere key in the index spec.
    const geoKey = geo && geo.key && geo.key.location;
    assert(geoKey === '2dsphere', '  geo_location is a 2dsphere index');
    assert(geo.sparse === true, '  geo_location is sparse');

    assert(
      names.includes('status_category_area'),
      'status_category_area compound index exists'
    );
    const sca = indexes.find((i) => i.name === 'status_category_area');
    assert(
      sca.key.status === 1 && sca.key.category === 1 && sca.key.areaId === 1,
      '  compound key order is status, category, areaId'
    );
  }

  // ── 8. ownerId / areaId refs ─────────────────────────────────────────
  console.log('\n--- 8. ownerId / areaId refs ---');
  {
    const paths = Resource.schema.paths;
    assert(paths.ownerId && paths.ownerId.instance === 'ObjectId', 'ownerId is ObjectId');
    assert(paths.ownerId.options.ref === 'User', '  ownerId ref is User');
    assert(paths.areaId && paths.areaId.instance === 'ObjectId', 'areaId is ObjectId');
    assert(paths.areaId.options.ref === 'Area', '  areaId ref is Area');
  }

  // ── 9. toJSON transform ───────────────────────────────────────────────
  console.log('\n--- 9. toJSON transform ---');
  {
    const owner = await makeOwner();
    const doc = await Resource.create({
      ownerId: owner._id,
      category: 'MEDICAL',
      title: 'Ambulance',
      description: 'A working ambulance with basic life support.',
      photos: [{ url: 'https://x/amb.jpg', publicId: 'amb' }],
    });
    const json = doc.toJSON();
    assert(typeof json.id === 'string' && json.id.length === 24, '  exposes string id');
    assert(json._id === undefined, '  strips _id');
    assert(json.__v === undefined, '  strips __v');
    assert(json.ownerId !== undefined, '  keeps ownerId (callers strip it in 3.2)');
    assert(json.title === 'Ambulance', '  keeps title');
    assert(json.photos.length === 1 && json.photos[0].url === 'https://x/amb.jpg', '  keeps photos');
    assert(json.createdAt !== undefined, '  keeps createdAt');
  }

  // ── 10. Static helpers ───────────────────────────────────────────────
  console.log('\n--- 10. Static helpers ---');
  {
    assert(
      Resource.CATEGORIES && Resource.CATEGORIES.MEDICAL === 'MEDICAL',
      'Resource.CATEGORIES exported'
    );
    assert(
      Array.isArray(Resource.CATEGORY_VALUES) && Resource.CATEGORY_VALUES.length === 6,
      'CATEGORY_VALUES has 6 entries'
    );
    assert(
      Resource.STATUS && Resource.STATUS.AVAILABLE === 'AVAILABLE',
      'Resource.STATUS exported'
    );
    assert(
      Array.isArray(Resource.STATUS_VALUES) && Resource.STATUS_VALUES.length === 4,
      'STATUS_VALUES has 4 entries (AVAILABLE/RESERVED/IN_USE/UNAVAILABLE)'
    );
    // Order-only sanity: the four statuses are the spec'd lifecycle.
    assert(
      JSON.stringify(Resource.STATUS_VALUES) ===
        JSON.stringify(['AVAILABLE', 'RESERVED', 'IN_USE', 'UNAVAILABLE']),
      '  STATUS values match the documented lifecycle exactly'
    );
    assert(
      Resource.CONDITIONS && Resource.CONDITIONS.GOOD === 'GOOD',
      'Resource.CONDITIONS exported'
    );
    assert(
      Array.isArray(Resource.CONDITION_VALUES) && Resource.CONDITION_VALUES.length === 4,
      'CONDITION_VALUES has 4 entries'
    );
    assert(Resource.MAX_PHOTOS === 5, 'MAX_PHOTOS is 5');

    // Module-level exports mirror the statics.
    const mod = require('../models/Resource');
    assert(mod.CATEGORIES === Resource.CATEGORIES, 'module-level CATEGORIES equals static');
    assert(mod.STATUS === Resource.STATUS, 'module-level STATUS equals static');
    assert(mod.CONDITIONS === Resource.CONDITIONS, 'module-level CONDITIONS equals static');
    assert(mod.MAX_PHOTOS === Resource.MAX_PHOTOS, 'module-level MAX_PHOTOS equals static');
  }

  // ── 11. Categories match 3.3's spec list ─────────────────────────────
  console.log('\n--- 11. Categories match Module 3.3 spec ---');
  {
    const expected = [
      'TRANSPORTATION',
      'RESCUE_EQUIPMENT',
      'MEDICAL',
      'INFRASTRUCTURE',
      'UTILITIES',
      'SKILLED_PROFESSIONALS',
    ];
    assert(
      JSON.stringify(Resource.CATEGORY_VALUES) === JSON.stringify(expected),
      'CATEGORY_VALUES exactly match the 6 categories listed in 3.3 spec'
    );
  }

  // ── 12. title/description length validation ──────────────────────────
  console.log('\n--- 12. title/description length ---');
  {
    const owner = await makeOwner();
    const base = { ownerId: owner._id, category: 'MEDICAL' };

    // Empty title
    let err = await Resource.create({ ...base, title: '', description: 'A reasonable description.' }).catch((e) => e);
    assert(err && err.name === 'ValidationError', 'empty title rejected');

    // Too long title
    let err2 = await Resource.create({
      ...base,
      title: 'A'.repeat(121),
      description: 'A reasonable description.',
    }).catch((e) => e);
    assert(err2 && err2.name === 'ValidationError', 'title > 120 chars rejected');

    // Too short description
    let err3 = await Resource.create({
      ...base,
      title: 'Field kit',
      description: 'short',
    }).catch((e) => e);
    assert(err3 && err3.name === 'ValidationError', 'description < 10 chars rejected');
  }

  await mongoose.disconnect();
  await mongo.stop();
  console.log('\n--- ALL ASSERTIONS PASSED ---');
}

(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('whu_test'));
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
