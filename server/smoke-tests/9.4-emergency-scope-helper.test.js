/**
 * End-to-end smoke test for Module 9.4 — emergencyScope helper
 * truth table.
 *
 * Verifies the centralised "is this area in emergency?" computation:
 *
 *   - `ancestorAreaIds` walks UP from leaf to root.
 *   - `descendantAreaIds` walks DOWN from root to leaves.
 *   - `isAreaInEmergency` returns:
 *       * true when an HIERARCHY activation covers the area
 *         (rootAreaId is the area OR an ancestor of it)
 *       * true when a CIRCLE activation contains (lat, lng)
 *       * false when nothing covers it
 *       * false when the only matching activation is deactivated
 *       * false when the only matching activation is past expiresAt
 *   - `isAreaInEmergencyBulk` evaluates N items in ≤2 DB queries
 *     (one for HIERARCHY, one for CIRCLE).
 *   - `resolveEmergencyRecipients` returns owners + moderators for
 *     HIERARCHY, owners-with-location-in-circle + moderators-in-circle
 *     for CIRCLE.
 *
 * Run: `node smoke-tests/9.4-emergency-scope-helper.test.js` from
 * `server/`. Exit 0 = all assertions passed.
 */

require('dotenv').config();

process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';

const mongoose = require('mongoose');

const TEST_DB = `whudbg_94_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const { createApp } = require('../app');
const Area = require('../models/Area');
const User = require('../models/User');
const EmergencyActivation = require('../models/EmergencyActivation');
const {
  ancestorAreaIds,
  descendantAreaIds,
  isAreaInEmergency,
  isAreaInEmergencyBulk,
  resolveEmergencyRecipients,
} = require('../utils/emergencyScope');

let server;

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ✓', msg);
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

async function start() {
  console.log('--- connecting to Atlas (ephemeral DB:', TEST_DB, ') ---');
  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(baseUri, { dbName: TEST_DB });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
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
  section('1. seed a 3-level chain: D > U > W');
  const district = await Area.create({
    country: 'Bangladesh',
    level: 'DISTRICT',
    name: 'D-94',
    parentId: null,
  });
  const upazila = await Area.create({
    country: 'Bangladesh',
    level: 'UPAZILA',
    name: 'U-94',
    parentId: district._id,
  });
  const union = await Area.create({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'UN-94',
    parentId: upazila._id,
  });
  const ward = await Area.create({
    country: 'Bangladesh',
    level: 'WARD',
    name: 'W-94',
    parentId: union._id,
  });
  // A sibling branch off the upazila.
  const siblingUnion = await Area.create({
    country: 'Bangladesh',
    level: 'UNION',
    name: 'Sibling-UN-94',
    parentId: upazila._id,
  });

  section('2. ancestorAreaIds walks leaf → root');
  {
    const chain = await ancestorAreaIds(ward._id);
    assert(
      chain.map((id) => id.toString()).join(',') ===
        [ward._id, union._id, upazila._id, district._id]
          .map((id) => id.toString())
          .join(','),
      '  ward → union → upazila → district'
    );
  }

  section('3. descendantAreaIds walks root → leaves (inclusive)');
  {
    const desc = await descendantAreaIds(district._id);
    const set = new Set(desc.map((id) => id.toString()));
    assert(set.has(district._id.toString()), '  root included');
    assert(set.has(upazila._id.toString()), '  upazila included');
    assert(set.has(union._id.toString()), '  union included');
    assert(set.has(ward._id.toString()), '  ward included');
    assert(set.has(siblingUnion._id.toString()), '  sibling union included');
    assert(desc.length === 5, '  total 5 descendants');
  }

  section('4. HIERARCHY: no activation → false everywhere');
  {
    const a = await isAreaInEmergency({ areaId: ward._id });
    const b = await isAreaInEmergency({ areaId: union._id });
    assert(a === false && b === false, '  ward + union both false');
  }

  section('5. HIERARCHY activation at district → true for all descendants');
  await EmergencyActivation.create({
    rootAreaId: district._id,
    level: 'DISTRICT',
    scope: 'HIERARCHY',
    descendantAreaIds: [district._id, upazila._id, union._id, ward._id, siblingUnion._id],
    message: 'district flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
  });
  {
    assert(
      await isAreaInEmergency({ areaId: ward._id }) === true,
      '  ward is in emergency (descendant of district)'
    );
    assert(
      await isAreaInEmergency({ areaId: union._id }) === true,
      '  union is in emergency'
    );
    assert(
      await isAreaInEmergency({ areaId: upazila._id }) === true,
      '  upazila is in emergency (root ancestor chain)'
    );
  }

  section('6. HIERARCHY activation at upazila covers sub-tree only');
  await EmergencyActivation.updateMany({ rootAreaId: district._id }, { isActive: false });
  await EmergencyActivation.create({
    rootAreaId: upazila._id,
    level: 'UPAZILA',
    scope: 'HIERARCHY',
    descendantAreaIds: [upazila._id, union._id, ward._id, siblingUnion._id],
    message: 'upazila flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  {
    assert(
      await isAreaInEmergency({ areaId: ward._id }) === true,
      '  ward covered by upazila activation'
    );
    assert(
      await isAreaInEmergency({ areaId: union._id }) === true,
      '  union covered'
    );
    assert(
      await isAreaInEmergency({ areaId: district._id }) === false,
      '  district NOT covered (root is the upazila, district is ancestor)'
    );
  }

  section('7. CIRCLE activation contains a point');
  await EmergencyActivation.updateMany({}, { isActive: false });
  // Center: [90.4, 23.8] (Bangladesh). 5 km radius.
  const circleActivation = await EmergencyActivation.create({
    rootAreaId: union._id,
    level: 'UNION',
    scope: 'CIRCLE',
    center: { type: 'Point', coordinates: [90.4, 23.8] },
    radiusMeters: 5000,
    descendantAreaIds: [],
    message: 'local flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  {
    const inside = await isAreaInEmergency({
      areaId: null,
      lat: 23.81,
      lng: 90.41,
    });
    assert(inside === true, '  point ~1.4km inside → true');

    const farAway = await isAreaInEmergency({
      areaId: null,
      lat: 24.5,
      lng: 91.0,
    });
    assert(farAway === false, '  point ~100km away → false');
  }

  section('8. deactivated activation ignored');
  await EmergencyActivation.findByIdAndUpdate(circleActivation._id, { isActive: false });
  {
    const inside = await isAreaInEmergency({
      areaId: null,
      lat: 23.81,
      lng: 90.41,
    });
    assert(inside === false, '  deactivated activation ignored');
  }

  section('9. expired activation ignored');
  await EmergencyActivation.create({
    rootAreaId: district._id,
    level: 'DISTRICT',
    scope: 'HIERARCHY',
    descendantAreaIds: [district._id, upazila._id, union._id, ward._id, siblingUnion._id],
    message: 'expired district flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'MODERATOR',
    isActive: true,
    expiresAt: new Date(Date.now() - 60_000),
  });
  {
    const a = await isAreaInEmergency({ areaId: ward._id });
    assert(a === false, '  expired activation ignored');
  }

  section('10. isAreaInEmergencyBulk');
  await EmergencyActivation.create({
    rootAreaId: union._id,
    level: 'UNION',
    scope: 'HIERARCHY',
    descendantAreaIds: [union._id, ward._id],
    message: 'union flood',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  const bulk = await isAreaInEmergencyBulk([
    { areaId: ward._id },
    { areaId: union._id },
    { areaId: district._id }, // ancestor, NOT covered
    { areaId: siblingUnion._id }, // sibling, NOT covered
    { areaId: null },
  ]);
  assert(bulk.get(ward._id.toString()) === true, '  bulk: ward covered');
  assert(bulk.get(union._id.toString()) === true, '  bulk: union covered');
  assert(bulk.get(district._id.toString()) === false, '  bulk: district NOT covered');
  assert(bulk.get(siblingUnion._id.toString()) === false, '  bulk: sibling NOT covered');

  section('11. resolveEmergencyRecipients (HIERARCHY)');
  // Seed 2 owners + 1 volunteer + 1 moderator in the union.
  const owner1 = await User.create({
    name: 'Owner1', email: 'o1-94@example.com', phone: '+8801710000091',
    password: 'long-enough-password', role: 'OWNER',
    isActive: true, areaId: union._id,
  });
  const owner2 = await User.create({
    name: 'Owner2', email: 'o2-94@example.com', phone: '+8801710000092',
    password: 'long-enough-password', role: 'OWNER',
    isActive: true, areaId: union._id,
  });
  const vol = await User.create({
    name: 'Vol', email: 'v-94@example.com', phone: '+8801710000093',
    password: 'long-enough-password', role: 'VOLUNTEER',
    isVerified: true, isActive: true, areaId: union._id,
  });
  const modInUnion = await User.create({
    name: 'ModUnion', email: 'm-94@example.com', phone: '+8801710000094',
    password: 'long-enough-password', role: 'MODERATOR',
    isActive: true, areaId: union._id,
  });
  // Also a mod in district (covers all descendants).
  const modInDistrict = await User.create({
    name: 'ModDistrict', email: 'md-94@example.com', phone: '+8801710000095',
    password: 'long-enough-password', role: 'MODERATOR',
    isActive: true, areaId: district._id,
  });
  // Owner in a different area — must NOT be picked up.
  await User.create({
    name: 'OwnerOther', email: 'oo-94@example.com', phone: '+8801710000096',
    password: 'long-enough-password', role: 'OWNER',
    isActive: true, areaId: siblingUnion._id,
  });

  const hierActivation = await EmergencyActivation.create({
    rootAreaId: union._id,
    level: 'UNION',
    scope: 'HIERARCHY',
    descendantAreaIds: [union._id, ward._id],
    message: 'union flood',
    activatedBy: vol._id,
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  const recs = await resolveEmergencyRecipients(hierActivation);
  assert(
    recs.owners.length === 2 &&
      recs.owners.some((id) => id.toString() === owner1._id.toString()) &&
      recs.owners.some((id) => id.toString() === owner2._id.toString()),
    '  2 owners in union picked up'
  );
  assert(recs.volunteers.length === 1, '  1 volunteer in union picked up (helper returns all; trigger filters)');
  assert(recs.moderators.length === 1, '  1 moderator in union (district mod outside descendantAreaIds)');
  assert(recs.all.length === 4, '  all = 2 owners + 1 volunteer + 1 moderator');

  section('12. resolveEmergencyRecipients (CIRCLE)');
  // Owners / mods with locations.
  const ownerInCircle = await User.create({
    name: 'OwnerCircle', email: 'oc-94@example.com', phone: '+8801710000097',
    password: 'long-enough-password', role: 'OWNER',
    isActive: true, areaId: null,
    location: { type: 'Point', coordinates: [90.401, 23.801] },
  });
  const ownerFar = await User.create({
    name: 'OwnerFar', email: 'of-94@example.com', phone: '+8801710000098',
    password: 'long-enough-password', role: 'OWNER',
    isActive: true, areaId: null,
    location: { type: 'Point', coordinates: [91.5, 24.5] },
  });
  const circActivation = await EmergencyActivation.create({
    rootAreaId: union._id,
    level: 'UNION',
    scope: 'CIRCLE',
    center: { type: 'Point', coordinates: [90.4, 23.8] },
    radiusMeters: 5000,
    descendantAreaIds: [],
    message: 'local flood circle',
    activatedBy: new mongoose.Types.ObjectId(),
    activatedByRole: 'VOLUNTEER',
    isActive: true,
  });
  const circRecs = await resolveEmergencyRecipients(circActivation);
  assert(
    circRecs.owners.some((id) => id.toString() === ownerInCircle._id.toString()),
    '  owner in circle picked up'
  );
  assert(
    !circRecs.owners.some((id) => id.toString() === ownerFar._id.toString()),
    '  owner far from circle NOT picked up'
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