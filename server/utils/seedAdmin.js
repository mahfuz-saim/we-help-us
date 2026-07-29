/**
 * Seed a permanent ADMIN account on every server boot.
 *
 * Mirrors the `seedAreasIfEmpty()` pattern: idempotent, safe to call on
 * every startup, exits as a no-op if the admin already exists. The
 * intention is that a fresh database, or any deployment that drops the
 * users collection, gets a usable admin account without a manual
 * `node scripts/seed-admin.js` step.
 *
 * Defaults (per the project spec):
 *   email:    admin@admin.com
 *   password: admin123
 *   name:     System Admin
 *   phone:    +10000000000
 *   role:     ADMIN
 *   isVerified: true   (no email verification needed for the seeded admin)
 *   isActive:   true
 *
 * All fields above are overridable via env vars so production deployments
 * can change them without code changes:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE
 *
 * The user record is created via the normal `User` model so the
 * `pre('save')` password-hashing hook (bcrypt, cost 12) runs the same
 * way it does for any other registration.
 *
 * Bypass the auto-seed with `SKIP_ADMIN_AUTOSEED=1` (useful for tests).
 */

const mongoose = require('mongoose');
const User = require('../models/User');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@admin.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Admin';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+10000000000';

/**
 * Idempotently ensure the admin user exists. Returns the created record
 * on first boot, or `null` if the admin already exists. Safe to call on
 * every server start.
 *
 * @param {object} [opts]
 * @param {object} [opts.connection=mongoose.connection]
 * @returns {Promise<null | {email: string, role: string}>}
 */
async function seedAdminIfMissing(opts = {}) {
  const { connection = mongoose.connection } = opts;
  if (connection.readyState !== 1) {
    throw new Error('seedAdminIfMissing: MongoDB is not connected');
  }

  const existing = await User.findOne({ email: ADMIN_EMAIL }).lean();
  if (existing) {
    return null;
  }

  const user = new User({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    phone: ADMIN_PHONE,
    password: ADMIN_PASSWORD, // pre('save') hook bcrypt-hashes this
    role: User.ROLES.ADMIN,
    isVerified: true,
    isActive: true,
  });
  await user.save();

  return { email: ADMIN_EMAIL, role: User.ROLES.ADMIN };
}

module.exports = {
  seedAdminIfMissing,
  ADMIN_EMAIL,
};
