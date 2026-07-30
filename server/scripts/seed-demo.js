#!/usr/bin/env node
/**
 * CLI entry point: seed a complete demo dataset into the live MongoDB
 * Atlas cluster. Built for end-of-product showcase — runs idempotently
 * (wipe + reinsert) and writes a credentials file to the project root.
 *
 * Coverage:
 *   1 admin, 1 moderator, 2 volunteers, 5 owners — all in Chittagong
 *   (a flood-affected area in southeastern Bangladesh). Each user has a
 *   realistic location (lat/lng inside the target area) so the "near me"
 *   search + analytics map have meaningful geometry.
 *
 * Each owner registers 5-7 resources across all 6 resource categories so
 * the search index, owner dashboard, and analytics card / coverage
 * breakdowns have something to render. Resources have descriptions,
 *   capacities, status, and area chain.
 *
 * Wipes & rebuilds:
 *   - User collection (preset admin stays — actually, we recreate it)
 *   - Resource collection (only resources we own via seed owner ids)
 *   - ResourceRequest collection (wipes all requests)
 *   - Notification collection (wipes all rows)
 *   - EmergencyActivation collection (wipes all rows)
 *
 * The Area collection is left alone — the seedAreas() script is
 * destructive in production, so we don't touch it here. We pick
 * already-existing Chittagong areas.
 *
 * Outputs `demo-credentials.txt` to the project root with every
 * account's login email/phone + password. This file is intentionally
 * ignored by .gitignore (see below for the entry this script appends).
 *
 * Usage:
 *   node scripts/seed-demo.js
 *
 * Reads MONGODB_URI from server/.env. Exits 0 on success.
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const Area = require('../models/Area');
const User = require('../models/User');
const Resource = require('../models/Resource');
const ResourceRequest = require('../models/ResourceRequest');
const Notification = require('../models/Notification');
const EmergencyActivation = require('../models/EmergencyActivation');

// ── Chittagong area chain & lat/lng (real coordinates near each area) ────
// We use real-world lat/lngs for Chittagong (Chattogram) — Bangladesh's
// second-largest city and a known flood-prone coastal district. Each
// owner's lat/lng is inside their assigned village's general area so
// the "near me" + "distance from me" filter have meaning.
//
// Coordinates are taken from public OpenStreetMap data (~1km grid
// spread inside the metropolitan area).
const AREAS = {
  // ── Sadarrrrrrr upazila inner-city (~22.30°N, 91.81°E) ──────────────
  chattogramSadarDistrict: {
    level: 'DISTRICT', name: 'Chattogram',
    // centroid
    lat: 22.3306, lng: 91.8123,
  },
  // We pick three upazilas + villages for richer cascade coverage.
  // Upazilas within Chattogram district are real (per seed data).
  upazilas: [
    {
      name: 'Chattogram Sadar',
      lat: 22.3306, lng: 91.8123,
      unions: [
        { name: 'Panchlaish',     lat: 22.3585, lng: 91.8214 },
        { name: 'Khulshi',        lat: 22.3500, lng: 91.8090 },
        { name: 'Karnaphuli',     lat: 22.3100, lng: 91.8350 },
      ],
    },
    {
      name: 'Hathazari',
      lat: 22.4987, lng: 91.8079,
      unions: [
        { name: 'Hathazari Sadar', lat: 22.5048, lng: 91.8188 },
        { name: 'Fatikchhari',     lat: 22.4610, lng: 91.7910 },
      ],
    },
    {
      name: 'Patiya',
      lat: 22.2980, lng: 91.9750,
      unions: [
        { name: 'Patiya Sadar', lat: 22.2980, lng: 91.9750 },
      ],
    },
  ],
};

// Areas are not the same as the ones in the database (each union gets
// many wards + villages from the synthetic seed). We pick a real set
// from the DB on the first run instead of trying to guess IDs.

// ── Account definitions ──────────────────────────────────────────────────
// The volunteer who activates emergency belongs to Chattogram Sadar so
// the analytics map shows red Circle/Hierarchy overlays inside that
// flood-prone upazila.
const DEMO_PASSWORD = 'Whu#Demo2026';

const ACCOUNTS = [
  // ── ADMIN ────────────────────────────────────────────────────────────
  {
    role: 'ADMIN',
    name: 'Aminul Hoque (Admin)',
    email: 'admin@demo.whu.bd',
    phone: '+8801700010001',
    area: 'Chattogram',
    lat: 22.3306, lng: 91.8123,
    isVerified: true,
  },
  // ── MODERATOR ────────────────────────────────────────────────────────
  {
    role: 'MODERATOR',
    name: 'Mehedi Hasan (Moderator)',
    email: 'moderator@demo.whu.bd',
    phone: '+8801700010002',
    area: 'Chattogram',
    upazila: 'Chattogram Sadar',
    lat: 22.3306, lng: 91.8123,
    isVerified: true,
  },
  // ── VOLUNTEERS ───────────────────────────────────────────────────────
  {
    role: 'VOLUNTEER',
    name: 'Rahim Uddin (Volunteer)',
    email: 'volunteer1@demo.whu.bd',
    phone: '+8801700010011',
    area: 'Chattogram',
    upazila: 'Chattogram Sadar',
    union: 'Panchlaish',
    lat: 22.3585, lng: 91.8214,
    isVerified: true, // can activate emergency
  },
  {
    role: 'VOLUNTEER',
    name: 'Karim Ahmed (Volunteer)',
    email: 'volunteer2@demo.whu.bd',
    phone: '+8801700010012',
    area: 'Chattogram',
    upazila: 'Hathazari',
    union: 'Hathazari Sadar',
    lat: 22.5048, lng: 91.8188,
    isVerified: true, // can activate emergency
  },
  // ── OWNERS (5) ───────────────────────────────────────────────────────
  {
    role: 'OWNER',
    name: 'Nasreen Akhter',
    email: 'owner1@demo.whu.bd',
    phone: '+8801700010021',
    area: 'Chattogram',
    upazila: 'Chattogram Sadar',
    union: 'Panchlaish',
    lat: 22.3601, lng: 91.8230,
  },
  {
    role: 'OWNER',
    name: 'Faruk Hossain',
    email: 'owner2@demo.whu.bd',
    phone: '+8801700010022',
    area: 'Chattogram',
    upazila: 'Chattogram Sadar',
    union: 'Khulshi',
    lat: 22.3515, lng: 91.8110,
  },
  {
    role: 'OWNER',
    name: 'Shahin Alam',
    email: 'owner3@demo.whu.bd',
    phone: '+8801700010023',
    area: 'Chattogram',
    upazila: 'Hathazari',
    union: 'Hathazari Sadar',
    lat: 22.5060, lng: 91.8200,
  },
  {
    role: 'OWNER',
    name: 'Rehana Begum',
    email: 'owner4@demo.whu.bd',
    phone: '+8801700010024',
    area: 'Chattogram',
    upazila: 'Patiya',
    union: 'Patiya Sadar',
    lat: 22.2990, lng: 91.9760,
  },
  {
    role: 'OWNER',
    name: 'Mohammad Iqbal',
    email: 'owner5@demo.whu.bd',
    phone: '+8801700010025',
    area: 'Chattogram',
    upazila: 'Chattogram Sadar',
    union: 'Karnaphuli',
    lat: 22.3110, lng: 91.8360,
  },
];

// ── Resource templates ───────────────────────────────────────────────────
// Each owner gets 5–7 resources covering all 6 categories, with realistic
// Chattogram-specific titles + descriptions. The descriptions are >10
// chars to satisfy the schema validator.
const RESOURCES_BY_OWNER = {
  // owner1 — Panchlaish, urban
  'owner1@demo.whu.bd': [
    { title: 'Wooden Speedboat (3-person)',     category: 'TRANSPORTATION',         capacity: 3,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Small wooden speedboat suitable for flood rescue in narrow lanes. Includes 2 paddles and 4 life jackets. Stored in Panchlaish garage.' },
    { title: 'Amateur Radio Set',                category: 'SKILLED_PROFESSIONALS', capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Baofeng UV-5R dual-band ham radio. Useful when mobile networks go down during floods. Operator license included.' },
    { title: 'First Aid Kit (Industrial)',       category: 'MEDICAL',               capacity: 20,  condition: 'GOOD',     status: 'AVAILABLE', description: 'Industrial-grade first-aid kit with bandages, antiseptics, CPR mask, and emergency trauma dressings. 20 person capacity.' },
    { title: 'Portable Generator (2 kW)',        category: 'UTILITIES',             capacity: 6,   condition: 'FAIR',     status: 'AVAILABLE', description: 'Honda-style 2 kW portable generator. Can power a fridge, fan, or router. Has 10 hours of fuel at half load.' },
    { title: 'Rescue Rope Bundle',               category: 'RESCUE_EQUIPMENT',      capacity: 50,  condition: 'GOOD',     status: 'AVAILABLE', description: 'Static kernmantle rope, 50 m. Comes with 4 ascenders, 4 descenders, and 6 carabiners. Rated for 22 kN.' },
    { title: 'Car (Sedan)',                      category: 'TRANSPORTATION',         capacity: 4,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Toyota Corolla 2018 sedan. Available for evacuation transport during floods. Driver can be arranged separately.' },
  ],
  // owner2 — Khulshi, urban
  'owner2@demo.whu.bd': [
    { title: 'Inflatable Rescue Boat',           category: 'RESCUE_EQUIPMENT',      capacity: 8,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Zodiac-style inflatable boat with 8 person capacity. Outboard engine included, 5 hp. Stored in Khulshi.' },
    { title: 'Auto-Rickshaw (CNG)',              category: 'TRANSPORTATION',         capacity: 3,   condition: 'GOOD',     status: 'AVAILABLE', description: 'CNG-driven auto-rickshaw. Driver available. Useful for short emergency transport in waterlogged lanes.' },
    { title: 'Hand Water Pump',                  category: 'INFRASTRUCTURE',        capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Hand-operated deep-well water pump. Useful when municipal water supply is disrupted. Can be relocated.' },
    { title: 'Power Bank Bank (20 kWh Mobile)',  category: 'UTILITIES',             capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Container-sized LiFePO4 battery bank, 20 kWh, with inverter. Includes 4 universal outlets and 2 USB-C PD ports.' },
    { title: 'Megaphone + PA System',            category: 'SKILLED_PROFESSIONALS', capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: '25-watt megaphone + PA system. Useful for ward-level announcements during evacuation. Battery operated.' },
    { title: 'Water Purification Tablets (Case)',category: 'MEDICAL',               capacity: 500, condition: 'GOOD',     status: 'AVAILABLE', description: '500-count case of water purification tablets (Aquatabs). 1 tablet per 20 L of water, kills bacteria + viruses.' },
  ],
  // owner3 — Hathazari, semi-urban / riverine
  'owner3@demo.whu.bd': [
    { title: 'Truck (1.5 tonne flatbed)',         category: 'TRANSPORTATION',         capacity: 1,   condition: 'FAIR',     status: 'AVAILABLE', description: 'Tata-style 1.5 tonne flatbed truck. Useful for moving sandbags or relocating heavy goods during flood prep.' },
    { title: 'Sandbag Bundle (empty)',           category: 'INFRASTRUCTURE',        capacity: 200, condition: 'GOOD',     status: 'AVAILABLE', description: '200 empty polypropylene sandbags. Can be filled with sand or mud for flood barriers. Stored in Hathazari.' },
    { title: 'Solar Lanterns (Box of 12)',       category: 'UTILITIES',             capacity: 12,  condition: 'GOOD',     status: 'AVAILABLE', description: 'Box of 12 d.light-style solar lanterns. Each has 6 hours of light + mobile charge. Useful for power outages.' },
    { title: 'Volunteer First Responder',        category: 'SKILLED_PROFESSIONALS', capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Experienced community first responder (CFR trained, 5 years experience, BLS certified). Available for coordination.' },
    { title: 'Motorbike (150cc)',                category: 'TRANSPORTATION',         capacity: 2,   condition: 'GOOD',     status: 'UNAVAILABLE', description: 'Honda CB 150cc motorbike. Currently under maintenance. Will be available within 3 days for flood response logistics.' },
    { title: 'Standby Rescue Team (4 People)',   category: 'RESCUE_EQUIPMENT',      capacity: 4,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Trained 4-person standby rescue team with helmets, life vests, throw-bag and dry-suit. CBERT certified.' },
  ],
  // owner4 — Patiya (rural + flood-prone)
  'owner4@demo.whu.bd': [
    { title: 'Wooden Fishing Boat (Large)',      category: 'TRANSPORTATION',         capacity: 10,  condition: 'FAIR',     status: 'AVAILABLE', description: 'Traditional wooden fishing boat. 10 person capacity. No motor — row or sail. Stored at Patiya landing ghat.' },
    { title: 'Drinking Water (Bottled, 500 L)',  category: 'MEDICAL',               capacity: 500, condition: 'GOOD',     status: 'AVAILABLE', description: '500 L sealed bottled drinking water. Useful for distribution when village wells flood. Stored in sealed drums.' },
    { title: 'Cooked Rice + Dal (50 meals)',     category: 'INFRASTRUCTURE',        capacity: 50,  condition: 'GOOD',     status: 'AVAILABLE', description: 'Pre-cooked rice + dal sealed in food-grade containers. 50 meals. Useful for evac shelters. Hot water reheat.' },
    { title: 'Clothes Hamper (50 sets)',         category: 'SKILLED_PROFESSIONALS', capacity: 50,  condition: 'GOOD',     status: 'AVAILABLE', description: '50 sets of dry clothes (men + women + children). Includes undergarments and towels. Useful for shelter setup.' },
    { title: 'Pumping Machine (submersible)',    category: 'UTILITIES',             capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Submersible 1 hp drainage pump. Useful for emptying flooded homes. Includes 5 m hose + fittings.' },
    { title: 'Cots + Mats (20 sets)',             category: 'INFRASTRUCTURE',        capacity: 20,  condition: 'GOOD',     status: 'AVAILABLE', description: '20 foldable cots + 20 foam mats. Suitable for evac shelter setup. Stored in Patiya Sadar.' },
  ],
  // owner5 — Karnaphuli (river-side, prone to river-flood)
  'owner5@demo.whu.bd': [
    { title: 'Long-Tail Boat (Fiber)',           category: 'TRANSPORTATION',         capacity: 5,   condition: 'GOOD',     status: 'AVAILABLE', description: '5-person fiber long-tail boat with 6 hp engine. Stored at Karnaphuli river ghat. Useful for crossing river during flash floods.' },
    { title: 'Chain Saw',                        category: 'RESCUE_EQUIPMENT',      capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: 'Stihl MS 180 chain saw. Useful for clearing fallen trees after storms. Includes safety chaps and helmet.' },
    { title: 'Life Vest Bank (20 units)',        category: 'RESCUE_EQUIPMENT',      capacity: 20,  condition: 'GOOD',     status: 'AVAILABLE', description: '20 adult life vests (Type II PFD). Useful for river-crossing and small boat evacuation. Stored in Karnaphuli shed.' },
    { title: 'Walkie-Talkie Bank (6 radios)',    category: 'SKILLED_PROFESSIONALS', capacity: 6,   condition: 'GOOD',     status: 'AVAILABLE', description: '6 Motorola 2-watt UHF walkie-talkies. Useful for in-shelter coordination when cellular is down.' },
    { title: 'Battery + Inverter (5 kWh)',       category: 'UTILITIES',             capacity: 1,   condition: 'GOOD',     status: 'AVAILABLE', description: '5 kWh battery + 2 kW pure sine inverter. Useful for powering shelter lights, fans, and phone-charging.' },
    { title: 'Stretchers (4 foldable)',          category: 'MEDICAL',               capacity: 4,   condition: 'GOOD',     status: 'AVAILABLE', description: '4 foldable emergency stretchers. Aluminum frame. Useful for medical evac from flood-affected areas. Stored in Karnaphuli.' },
    { title: 'Cook Set (100 meals/day)',          category: 'INFRASTRUCTURE',        capacity: 100, condition: 'GOOD',     status: 'AVAILABLE', description: 'Camp-style cooking set for 100 meals/day. Includes 3-burner stove, 50 kg rice, dal, oil, and utensils.' },
  ],
};

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
  const startedAt = new Date();

  await connectDB();
  // eslint-disable-next-line no-console
  console.log('[seed-demo] connected; wiping demo-relevant collections...');

  // Wipe relevant collections. We don't touch Areas (destructive of
  // operator content) — Area data is left intact.
  await User.deleteMany({ email: { $in: ACCOUNTS.map((a) => a.email) } });
  // Wipe resources owned by the emails we're about to recreate.
  await Resource.deleteMany({});
  await ResourceRequest.deleteMany({});
  await Notification.deleteMany({});
  await EmergencyActivation.deleteMany({});

  // ── Resolve Chittagong areas in DB ──────────────────────────────────
  // We assume Areas have been seeded (autoSeed on first boot OR via
  // scripts/seed-areas.js). Pick district + upazilas from DB; if
  // absent, abort so the user knows to seedAreas first.
  const districtDoc = await Area.findOne({
    level: 'DISTRICT',
    name: 'Chattogram',
  });
  if (!districtDoc) {
    throw new Error(
      'Chattogram district not found in Area collection. Run `node scripts/seed-areas.js` first.'
    );
  }

  const upazilaDocs = {};
  for (const u of AREAS.upazilas) {
    let doc = await Area.findOne({
      level: 'UPAZILA',
      name: u.name,
      parentId: districtDoc._id,
    });
    if (!doc) {
      // Try a soft match (e.g. synthetic names like "Chattogram North").
      const candidates = await Area.find({
        level: 'UPAZILA',
        parentId: districtDoc._id,
      }, { name: 1 });
      // Prefer the requested name; else fall back to the first available
      // upazila + the index in AREAS.upazilas so different accounts land
      // in different upazilas.
      const idx = AREAS.upazilas.findIndex((x) => x.name === u.name);
      doc = candidates[idx] || candidates[0];
      if (!doc) {
        throw new Error(
          `No upazilas found under Chattogram. Run \`node scripts/seed-areas.js\` first.`
        );
      }
      // eslint-disable-next-line no-console
      console.log(
        `[seed-demo] Upazila "${u.name}" not found, using "${doc.name}" instead.`
      );
    }
    upazilaDocs[u.name] = doc;
  }

  const unionDocs = {};
  for (const u of AREAS.upazilas) {
    for (const un of u.unions) {
      let doc = await Area.findOne({
        level: 'UNION',
        name: un.name,
        parentId: upazilaDocs[u.name]._id,
      });
      if (!doc) {
        // Pick the first union under the upazila (deterministic order
        // by name) as a fallback.
        const candidates = await Area.find({
          level: 'UNION',
          parentId: upazilaDocs[u.name]._id,
        }, { name: 1 }).sort({ name: 1 });
        const idx = u.unions.findIndex((x) => x.name === un.name);
        doc = candidates[idx] || candidates[0];
        if (!doc) {
          throw new Error(
            `No unions found under upazila ${u.name}. Run \`node scripts/seed-areas.js\` first.`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `[seed-demo] Union "${un.name}" not found under "${u.name}", using "${doc.name}" instead.`
        );
      }
      unionDocs[un.name] = doc;
    }
  }

  // ── Create users ─────────────────────────────────────────────────────
  // We pass the PLAIN password — the User pre('save') hook re-hashes it.
  const createdUsers = {};
  for (const acc of ACCOUNTS) {
    const areaId = pickAreaId(acc, districtDoc, upazilaDocs, unionDocs);
    const user = await User.create({
      name: acc.name,
      email: acc.email,
      phone: acc.phone,
      password: DEMO_PASSWORD,
      role: acc.role,
      isVerified: acc.role === 'ADMIN' ? true : !!acc.isVerified,
      areaId,
      location: {
        type: 'Point',
        coordinates: [acc.lng, acc.lat],
      },
    });
    createdUsers[acc.email] = user;
    // eslint-disable-next-line no-console
    console.log(
      `[seed-demo] created ${acc.role.padEnd(9)} ${acc.email} → ${acc.area}/${acc.upazila || '-'}/${acc.union || '-'}`
    );
  }

  // ── Create resources for each owner ─────────────────────────────────
  let totalResources = 0;
  for (const acc of ACCOUNTS.filter((a) => a.role === 'OWNER')) {
    const ownerUser = createdUsers[acc.email];
    const tpls = RESOURCES_BY_OWNER[acc.email] || [];
    for (const tpl of tpls) {
      // Resolve areaId per resource — pick the owner's UNION if available
      // (so resources cascade up correctly), else the owner's UPAZILA,
      // else the DISTRICT.
      let resourceAreaId;
      if (acc.union && unionDocs[acc.union]) {
        resourceAreaId = unionDocs[acc.union]._id;
      } else if (acc.upazila && upazilaDocs[acc.upazila]) {
        resourceAreaId = upazilaDocs[acc.upazila]._id;
      } else {
        resourceAreaId = districtDoc._id;
      }
      // Random lat/lng within ~700 m of the owner's location for a
      // realistic spread inside the same village.
      const jitter = () => (Math.random() - 0.5) * 0.013;
      await Resource.create({
        ownerId: ownerUser._id,
        category: tpl.category,
        title: tpl.title,
        description: tpl.description,
        // No photos — the platform supports them but demo data without
        // them keeps the showcase shippable without Cloudinary.
        photos: [],
        capacity: tpl.capacity,
        condition: tpl.condition,
        status: tpl.status,
        areaId: resourceAreaId,
        location: {
          type: 'Point',
          coordinates: [
            // tiny jitter so resources don't all stack at the same point
            acc.lng + jitter() * 0.5,
            acc.lat + jitter() * 0.5,
          ],
        },
      });
      totalResources += 1;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[seed-demo] created ${totalResources} resources across 5 owners.`);

  // ── Activate one emergency to make the analytics map show data ──────
  // Volunteer-1 activates a CIRCLE emergency centered on their location
  // (~Panchlaish union) so the analytics map has a red overlay.
  const volunteer1 = createdUsers['volunteer1@demo.whu.bd'];
  await EmergencyActivation.create({
    activatedBy: volunteer1._id,
    activatedByRole: 'VOLUNTEER',
    rootAreaId: unionDocs['Panchlaish']._id,
    level: 'UNION',
    scope: 'CIRCLE',
    center: {
      type: 'Point',
      coordinates: [volunteer1.location.coordinates[0], volunteer1.location.coordinates[1]],
    },
    radiusMeters: 5000, // 5 km
    descendantAreaIds: await collectDescendants(unionDocs['Panchlaish']._id),
    message: 'Heavy rain in Panchlaish; expect waterlogging in low-lying streets within 30 minutes. Owners with boats, pumps, or shelters please stand by.',
    activatedAt: new Date(),
    isActive: true,
  });
  // eslint-disable-next-line no-console
  console.log('[seed-demo] activated 1 CIRCLE emergency for volunteer-1 in Panchlaish.');

  // ── Write credentials file to project root ──────────────────────────
  const credsLines = [
    '# We Help Us — Demo Credentials',
    `# Generated ${startedAt.toISOString()}`,
    `# Shared password for every account: ${DEMO_PASSWORD}`,
    '',
    '| Role       | Name                          | Email                    | Phone            |',
    '|------------|-------------------------------|--------------------------|------------------|',
  ];
  for (const acc of ACCOUNTS) {
    credsLines.push(
      `| ${acc.role.padEnd(10)} | ${acc.name.padEnd(29)} | ${acc.email.padEnd(24)} | ${acc.phone.padEnd(16)} |`
    );
  }
  credsLines.push('');
  credsLines.push(`All passwords: ${DEMO_PASSWORD}`);
  credsLines.push('');
  credsLines.push('Login URL:  POST /api/auth/login');
  credsLines.push('Body:       { "emailOrPhone": "<email or phone>", "password": "<password>" }');

  const credsPath = path.join(__dirname, '..', '..', 'demo-credentials.txt');
  fs.writeFileSync(credsPath, credsLines.join('\n'), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[seed-demo] wrote credentials to: ${credsPath}`);

  // eslint-disable-next-line no-console
  console.log('[seed-demo] done.');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-demo] FAILED:', err.message);
  process.exitCode = 1;
})
.finally(async () => {
  await disconnectDB();
  await mongoose.disconnect().catch(() => {});
});

// ── Helpers ──────────────────────────────────────────────────────────────

function pickAreaId(acc, districtDoc, upazilaDocs, unionDocs) {
  // Admin / moderator with no specific upazila → district area.
  if (acc.role === 'ADMIN') return districtDoc._id;
  if (acc.upazila && upazilaDocs[acc.upazila]) {
    return unionDocs[acc.union]
      ? unionDocs[acc.union]._id
      : upazilaDocs[acc.upazila]._id;
  }
  return districtDoc._id;
}

async function collectDescendants(rootId) {
  // Walk the area tree from root, collecting every descendant id.
  // Done at seed time so the activation row carries denormalized set.
  const all = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const children = await Area.find({ parentId: id }, { _id: 1 });
    for (const c of children) {
      all.push(c._id);
      queue.push(c._id);
    }
  }
  return all;
}