#!/usr/bin/env node
/**
 * CLI entry point: seed the Area collection with the Bangladesh
 * administrative hierarchy.
 *
 * Usage:
 *   node scripts/seed-areas.js
 *
 * This script is destructive — it wipes the `areas` collection and
 * re-seeds. Run it once after MongoDB is reachable.
 *
 * Exits 0 on success, 1 on failure.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const { seedAreas } = require('../utils/seedAreas');

(async () => {
  try {
    await connectDB();
    // eslint-disable-next-line no-console
    console.log('[seed] connected; seeding Bangladesh hierarchy...');

    const result = await seedAreas();

    // eslint-disable-next-line no-console
    console.log(
      `[seed] inserted ${result.districts} districts, ` +
        `${result.upazilas} upazilas, ${result.unions} unions, ` +
        `${result.wards} wards, ${result.villages} villages ` +
        `(${result.total} total)`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[seed] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
    await mongoose.disconnect().catch(() => {});
  }
})();