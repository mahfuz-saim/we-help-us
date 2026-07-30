/**
 * User controller — self-service profile endpoints (Module 1.4).
 *
 * Endpoints:
 *   - GET    /api/users/me       → current user
 *   - PATCH  /api/users/me       → update editable fields
 *   - POST   /api/users/me/avatar → upload avatar to Cloudinary
 *
 * All routes are mounted behind `protect` — `req.user` is always the
 * freshly-loaded user document.
 *
 * Defense reminders baked into this controller:
 *   - Role escalation: `role` is NOT editable through PATCH. Only
 *     privileged admin endpoints (Module 1.2) can mint MODERATOR/ADMIN.
 *   - Password: NOT editable here. Password change lands in a later
 *     module (likely 7.x — auth lifecycle).
 *   - isVerified / isActive: NOT editable by the user. Both are
 *     moderator/admin tooling concerns.
 *   - Avatar uploads go through Cloudinary only when configured.
 *     Otherwise we return 503 so the client can show a useful message
 *     instead of a confusing 500.
 */

const ApiError = require('../utils/apiError');
const { ok } = require('../utils/apiResponse');
const User = require('../models/User');
const { FORBIDDEN_FIELDS } = require('../validators/user.validators');
const {
  cloudinary,
  isCloudinaryConfigured,
} = require('../config/cloudinary');

const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;

// ── GET /api/users/me ──────────────────────────────────────────────────────
async function getMe(req, res, next) {
  try {
    // `protect` already loaded and validated the user; safe to return it.
    return ok(res, { user: req.user.toSafeObject() });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/users/me ────────────────────────────────────────────────────
async function updateMe(req, res, next) {
  try {
    // Defense in depth: explicitly reject any forbidden field, even if
    // the validator schema omitted them. Belt-and-braces against
    // refactors that might widen the editable surface.
    const offendingKeys = Object.keys(req.body || {}).filter((k) =>
      FORBIDDEN_FIELDS.includes(k)
    );
    if (offendingKeys.length > 0) {
      throw new ApiError(
        400,
        `These fields are not editable through this endpoint: ${offendingKeys.join(', ')}`
      );
    }

    const updates = { ...req.body };

    // Uniqueness pre-checks for email/phone changes. Returning a clean
    // 409 with `details.field` matches the convention from
    // auth.controller.register / admin.controller.createPrivilegedUser.
    if (typeof updates.email === 'string' && updates.email !== req.user.email) {
      const dupe = await User.findOne({
        email: updates.email.toLowerCase(),
        _id: { $ne: req.user._id },
      }).lean();
      if (dupe) {
        throw new ApiError(
          409,
          'A user with this email already exists',
          { field: 'email' }
        );
      }
      // Lowercase on persist — mirrors the schema's `lowercase: true`.
      updates.email = updates.email.toLowerCase();
    }

    if (typeof updates.phone === 'string' && updates.phone !== req.user.phone) {
      // Light pre-check before hitting the DB — caught early.
      if (!PHONE_REGEX.test(updates.phone)) {
        throw new ApiError(400, 'phone contains invalid characters');
      }
      const dupe = await User.findOne({
        phone: updates.phone,
        _id: { $ne: req.user._id },
      }).lean();
      if (dupe) {
        throw new ApiError(
          409,
          'A user with this phone already exists',
          { field: 'phone' }
        );
      }
    }

    // `set()` triggers Mongoose change-tracking + schema validators
    // (e.g. the `location.coordinates` range validator from 1.1).
    req.user.set(updates);
    await req.user.save();

    return ok(res, { user: req.user.toSafeObject() }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

// ── POST /api/users/me/avatar ─────────────────────────────────────────────
async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      throw new ApiError(400, 'No avatar file provided (expected field "avatar").');
    }

    if (!isCloudinaryConfigured()) {
      throw new ApiError(
        503,
        'Avatar upload is not configured on this server. ' +
          'Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET to enable it.'
      );
    }

    // Stream the in-memory buffer to Cloudinary via upload_stream.
    // We do NOT delete the previous asset here — Module 9.5 owns
    // cleanup. We log the old URL for traceability.
    const oldAvatarUrl = req.user.avatarUrl || null;

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'we-help-us/avatars',
          public_id: `user-${req.user._id}`,
          overwrite: true,
          invalidate: true,
        },
        (err, response) => {
          if (err) return reject(err);
          resolve(response);
        }
      );
      stream.end(req.file.buffer);
    });

    if (!result || !result.secure_url) {
      throw new ApiError(502, 'Cloudinary did not return a URL for the upload.');
    }

    req.user.avatarUrl = result.secure_url;
    await req.user.save();

    // eslint-disable-next-line no-console
    console.log(
      `[user] avatar replaced: user=${req.user._id} ${oldAvatarUrl || '(none)'} → ${result.secure_url}`
    );

    return ok(
      res,
      { user: req.user.toSafeObject() },
      'Avatar updated'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, uploadAvatar };