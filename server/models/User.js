/**
 * User model — We Help Us
 *
 * Spec (plan.txt → Module 1.1):
 *   - name, phone (unique, required), email (unique, required),
 *     password (hashed), role (OWNER|VOLUNTEER|MODERATOR|ADMIN, default OWNER),
 *     isVerified, areaId, location (GeoJSON Point)
 *   - 2dsphere index on location
 *   - unique indexes on email and phone
 *
 * Design reminders baked into this model:
 *   - **Role escalation**: public registration is OWNER/VOLUNTEER only.
 *     The schema allows the full role enum (so MODERATOR / ADMIN can be
 *     created by the protected admin route in Module 1.2 or by the seed
 *     script in Module 9.5), but the route layer in 1.2 will reject any
 *     other role from a public request body.
 *   - **Privacy**: the `toJSON` transform strips `password` and any other
 *     sensitive fields. Owner contact (phone/email) is exposed only by
 *     the request-lifecycle code in Module 5.2 after APPROVED+COLLECTED.
 *   - **Geospatial**: `location` is a GeoJSON Point. The 2dsphere index
 *     enables $near / $geoWithin queries for nearby resources / users.
 *
 * Note: this module only ships the schema. The actual register / login
 * routes land in Module 1.2.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = Object.freeze({
  OWNER: 'OWNER',
  VOLUNTEER: 'VOLUNTEER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
});

// Roles that can be created via public registration. The auth route in
// Module 1.2 will reject anything outside this list from public sign-up.
const PUBLIC_REGISTRATION_ROLES = Object.freeze([
  ROLES.OWNER,
  ROLES.VOLUNTEER,
]);

const BCRYPT_COST = 12;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone: accept digits, optional leading +, spaces, hyphens. Minimum 7
// digits after stripping non-digits. Format normalization (e.g., to
// E.164) lands in Module 1.2.
const phoneDigitsRegex = /^\+?[\d\s\-()]{7,20}$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
      minlength: [2, 'name must be at least 2 characters'],
      maxlength: [80, 'name must be at most 80 characters'],
    },

    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [emailRegex, 'email is not a valid address'],
      maxlength: [254, 'email is too long'],
    },

    phone: {
      type: String,
      required: [true, 'phone is required'],
      unique: true,
      trim: true,
      match: [phoneDigitsRegex, 'phone number is not valid'],
    },

    password: {
      type: String,
      required: [true, 'password is required'],
      minlength: [8, 'password must be at least 8 characters'],
      select: false, // never returned by default
    },

    role: {
      type: String,
      enum: {
        values: Object.values(ROLES),
        message: 'role must be one of: ' + Object.values(ROLES).join(', '),
      },
      default: ROLES.OWNER,
      required: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      // Soft-disable flag for the protected admin route (Module 1.2)
      // and moderator tooling. Defaults to true; toggling to false
      // blocks login at the auth layer.
      type: Boolean,
      default: true,
    },

    avatarUrl: {
      type: String,
      default: null,
    },

    areaId: {
      // Reference to Area (Module 2.1). Stored as ObjectId even though
      // the Area model doesn't exist yet — populate() will just no-op.
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Area',
      default: null,
      index: true,
    },

    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        validate: {
          validator: (arr) =>
            Array.isArray(arr) &&
            arr.length === 2 &&
            Number.isFinite(arr[0]) &&
            Number.isFinite(arr[1]) &&
            arr[0] >= -180 &&
            arr[0] <= 180 &&
            arr[1] >= -90 &&
            arr[1] <= 90,
          message:
            'location.coordinates must be [lng, lat] within valid ranges',
        },
      },
    },

    // Set by the auth flow on successful login. Not updated by the
    // model itself — Module 1.2 will write to it.
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    toJSON: {
      virtuals: false,
      transform: (_doc, ret) => {
        // Strip sensitive fields.
        delete ret.password;
        delete ret.__v;
        ret.id = ret._id?.toString();
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: false },
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
// `unique: true` on email and phone is declared inline on the field
// definitions above; Mongoose turns that into a unique index. The 2dsphere
// index and the role+isActive compound index are declared explicitly here.
userSchema.index({ location: '2dsphere' }, { name: 'geo_location' });
// Compound index used by moderator dashboards (Module 5.5/6.x) to
// quickly find active users by role in an area.
userSchema.index({ role: 1, isActive: 1 }, { name: 'role_active' });

// ── Password hashing ───────────────────────────────────────────────────────
// bcrypt on every save where password is dirty. Cost 12 is the project's
// default — tune via BCRYPT_COST env var later if needed.
userSchema.pre('save', async function hashPassword(next) {
  try {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(BCRYPT_COST);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ── Instance methods ───────────────────────────────────────────────────────
userSchema.methods.comparePassword = function comparePassword(plain) {
  if (!plain || !this.password) return Promise.resolve(false);
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.isPubliclyRegisterableRole = function isPubliclyRegisterableRole() {
  return PUBLIC_REGISTRATION_ROLES.includes(this.role);
};

// Don't return the password even if explicitly selected — used by routes
// that need to compare against the hash.
userSchema.methods.toSafeObject = function toSafeObject() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  obj.id = obj._id?.toString();
  delete obj._id;
  return obj;
};

// ── Static helpers ─────────────────────────────────────────────────────────
userSchema.statics.ROLES = ROLES;
userSchema.statics.PUBLIC_REGISTRATION_ROLES = PUBLIC_REGISTRATION_ROLES;
userSchema.statics.BCRYPT_COST = BCRYPT_COST;

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.PUBLIC_REGISTRATION_ROLES = PUBLIC_REGISTRATION_ROLES;