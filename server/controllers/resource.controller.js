/**
 * Resource controller — Module 3.2 (Resource Registration API).
 *
 * Endpoints:
 *   - POST   /api/resources              (OWNER-only; multipart upload)
 *   - GET    /api/resources              (auth; pagination + filters)
 *   - GET    /api/resources/:id          (auth)
 *   - PATCH  /api/resources/:id          (auth; OWNER-only)
 *   - DELETE /api/resources/:id          (auth; OWNER or MODERATOR)
 *   - GET    /api/resources/nearby       (auth; geo query)
 *
 * Defence reminders baked into this controller:
 *   - **Role restriction**: only OWNERs can create resources. The
 *     public registration surface (Module 1.2) lets users self-register
 *     as OWNER or VOLUNTEER; volunteers browse + request, owners register
 *     inventory. Moderators are a privileged role created by the admin
 *     endpoint and never need to register resources.
 *   - **Privacy** (KEY DESIGN REMINDER): owner contact info (phone/email)
 *     is NEVER returned in any list/single response. The client only
 *     gets `ownerId` (a string). Module 5.2 reveals contact details
 *     after a request reaches APPROVED + COLLECTED.
 *   - **Photo uploads**: 5 files × 5MB × image-only enforced by multer
 *     (middlewares/upload.js). Cloudinary upload is best-effort per file
 *     — if Cloudinary is unconfigured, the whole request returns 503
 *     (matches the avatar-endpoint pattern in 1.4).
 *   - **Status flow** (AVAILABLE → RESERVED → IN_USE → AVAILABLE):
 *     PATCH accepts any of the four statuses for now — Module 3.5's
 *     dashboard toggles AVAILABLE ↔ UNAVAILABLE; Module 5.2's request
 *     controller will transition to RESERVED/IN_USE internally.
 */

const ApiError = require('../utils/apiError');
const { ok, created } = require('../utils/apiResponse');
const Resource = require('../models/Resource');
const User = require('../models/User');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');
const { FORBIDDEN_FIELDS } = require('../validators/resource.validators');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const DEFAULT_RADIUS_METERS = 5000; // 5 km
const MAX_RADIUS_METERS = 100000; // 100 km

// Owner-facing fields explicitly stripped from list/single responses.
// This is the privacy boundary — we strip on the way OUT, not on the
// way IN, so the underlying record keeps its integrity.
function publicResource(doc) {
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  // After `.populate('ownerId', 'name')` the `ownerId` field becomes a
  // populated subdoc like `{ _id, name }`. When unpopulated (the
  // create / list / update paths do not populate), it's still a raw
  // ObjectId. Handle both shapes so this helper stays safe across all
  // call sites. Same for `areaId`.
  const ownerName = (() => {
    const v = obj.ownerId;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // populated subdoc — has a `.name`
      return typeof v.name === 'string' ? v.name : null;
    }
    return null;
  })();
  const areaName = (() => {
    const v = obj.areaId;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return typeof v.name === 'string' ? v.name : null;
    }
    return null;
  })();
  return {
    id: obj.id,
    ownerId: obj.ownerId ? obj.ownerId.toString() : null,
    ownerName,
    category: obj.category,
    title: obj.title,
    description: obj.description,
    photos: Array.isArray(obj.photos) ? obj.photos : [],
    capacity: obj.capacity ?? null,
    condition: obj.condition,
    status: obj.status,
    areaId: obj.areaId ? obj.areaId.toString() : null,
    areaName,
    location: obj.location || null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    // intentionally omitted: __v, _id, owner contact info
  };
}

async function uploadPhotoBuffer(buffer, publicIdHint) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'we-help-us/resources',
        public_id: publicIdHint,
        overwrite: true,
        invalidate: true,
      },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
    stream.end(buffer);
  });
}

// ── POST /api/resources ────────────────────────────────────────────────────
async function createResource(req, res, next) {
  try {
    // Role gate: only OWNER can register inventory. The route mounts
    // `protect` so req.user is guaranteed present + active, but role
    // is still per-endpoint.
    if (!req.user || req.user.role !== User.ROLES.OWNER) {
      throw new ApiError(
        403,
        'Only users with the OWNER role can register resources.'
      );
    }

    // Photos: upload each file to Cloudinary. If Cloudinary isn't
    // configured we return 503 — same pattern as 1.4's avatar endpoint.
    let photos = [];
    if (req.files && req.files.length > 0) {
      if (!isCloudinaryConfigured()) {
        throw new ApiError(
          503,
          'Photo upload is not configured on this server. ' +
            'Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET to enable it.'
        );
      }
      for (const file of req.files) {
        const hint = `resource-${req.user._id}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        try {
          const result = await uploadPhotoBuffer(file.buffer, hint);
          if (!result || !result.secure_url || !result.public_id) {
            throw new ApiError(502, 'Cloudinary did not return a URL for one of the uploads.');
          }
          photos.push({ url: result.secure_url, publicId: result.public_id });
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(502, `Photo upload failed: ${err.message || 'unknown error'}`);
        }
      }
    }

    // Build the doc. `ownerId` comes from req.user, never from the body.
    //
    // `location` may arrive either as a parsed object (PATCH / JSON body)
    // or as a JSON-stringified multipart part (POST / multipart). We
    // normalize here so the rest of the function only deals with the
    // canonical {type, coordinates} shape. Bad payloads are dropped to
    // `undefined` (the schema validator is the source of truth for the
    // 400 response).
    const rawLocation = (() => {
      const v = req.body.location;
      if (v == null || v === '') return null;
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return v;
    })();

    const doc = new Resource({
      ownerId: req.user._id,
      category: req.body.category,
      title: req.body.title,
      description: req.body.description,
      photos,
      capacity: req.body.capacity ?? null,
      condition: req.body.condition,
      status: req.body.status,
      areaId: req.body.areaId || null,
      location:
        rawLocation && Array.isArray(rawLocation.coordinates)
          ? {
              type: 'Point',
              coordinates: rawLocation.coordinates,
            }
          : undefined,
    });

    await doc.save();

    return created(res, { resource: publicResource(doc) }, 'Resource created');
  } catch (err) {
    next(err);
  }
}

// ── GET /api/resources ─────────────────────────────────────────────────────
async function listResources(req, res, next) {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.areaId) filter.areaId = req.query.areaId;
    // `?mine=1` narrows the list to resources owned by the caller.
    // Module 3.5's owner dashboard uses this; Module 4.1 / 5.2 do not
    // (they want the full feed). We compare by reference then string
    // so an ObjectId never sneaks past the filter.
    if (req.query.mine === '1') {
      filter.ownerId = req.user._id;
    }
    if (req.query.q) {
      // Case-insensitive regex on title + description. Mongo will scan
      // either way; the status/category/areaId compound index keeps the
      // most common filters cheap.
      const safe = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { description: { $regex: safe, $options: 'i' } },
      ];
    }
    // `?minCapacity=N` keeps only resources with capacity >= N. The
    // validator guarantees a non-negative integer string. Resources
    // without a `capacity` field (null) are intentionally excluded
    // — the spec treats capacity as "this can hold N people", so an
    // unspecified capacity shouldn't match a "at least 3" search.
    if (req.query.minCapacity !== undefined) {
      filter.capacity = { $gte: Number(req.query.minCapacity) };
    }
    // `?lat=…&lng=…&radius=…` keeps resources within `radius` meters
    // of (lat, lng). We use `$geoWithin / $centerSphere` so the
    // existing 2dsphere index on `location` (Module 3.1) keeps the
    // query cheap AND skip/limit/countDocuments still work normally.
    // `$centerSphere` expects the radius in radians; we convert from
    // meters using Earth's mean radius (6378100 m) — same approach
    // the /nearby endpoint uses for its Haversine distance math.
    // The validator has already enforced the lat+lng+radius compose
    // rules, so this branch only fires when all three are present.
    if (
      req.query.lat !== undefined &&
      req.query.lng !== undefined &&
      req.query.radius !== undefined
    ) {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius);
      filter.location = {
        $geoWithin: {
          $centerSphere: [[lng, lat], radius / 6378100],
        },
      };
    }

    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = Math.min(
      req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      Resource.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Resource.countDocuments(filter),
    ]);

    return ok(res, {
      resources: docs.map(publicResource),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    }, 'Resources fetched');
  } catch (err) {
    next(err);
  }
}

// ── GET /api/resources/:id ────────────────────────────────────────────────
// Single resource. Populates `ownerId` (name only) and `areaId` (name
// only) so the resource details page can render the owner + area
// names instead of opaque hex ids. Contact info (email/phone) is
// NEVER populated here — that surfaces only through the request
// lifecycle once a request reaches APPROVED + COLLECTED (Module 5.2).
async function getResource(req, res, next) {
  try {
    const doc = await Resource.findById(req.params.id)
      .populate('ownerId', 'name')
      .populate('areaId', 'name');
    if (!doc) {
      throw new ApiError(404, 'Resource not found');
    }
    return ok(res, { resource: publicResource(doc) }, 'Resource fetched');
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/resources/:id ──────────────────────────────────────────────
async function updateResource(req, res, next) {
  try {
    const doc = await Resource.findById(req.params.id);
    if (!doc) {
      throw new ApiError(404, 'Resource not found');
    }

    // Owner check: only the original owner can edit. We compare strings
    // because ObjectId.equals would also work but string compare is
    // sufficient and clearer.
    if (doc.ownerId.toString() !== req.user._id.toString()) {
      throw new ApiError(
        403,
        'Only the owner of this resource can edit it.'
      );
    }

    // Defence in depth — even if the validator misses a field, the
    // controller will reject.
    const offending = Object.keys(req.body || {}).filter((k) =>
      FORBIDDEN_FIELDS.includes(k)
    );
    if (offending.length > 0) {
      throw new ApiError(
        400,
        `These fields are not editable through this endpoint: ${offending.join(', ')}`
      );
    }

    const updates = { ...req.body };

    // Normalize the GeoJSON Point the same way create does — the
    // validator gives us a {type, coordinates} object, and the schema
    // accepts it as-is.
    if (updates.location && Array.isArray(updates.location.coordinates)) {
      updates.location = {
        type: 'Point',
        coordinates: updates.location.coordinates,
      };
    }

    // .set() triggers Mongoose change-tracking + schema validators.
    doc.set(updates);
    await doc.save();

    return ok(res, { resource: publicResource(doc) }, 'Resource updated');
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/resources/:id ─────────────────────────────────────────────
async function deleteResource(req, res, next) {
  try {
    const doc = await Resource.findById(req.params.id);
    if (!doc) {
      throw new ApiError(404, 'Resource not found');
    }

    // Owner OR MODERATOR. Compare strings to avoid ObjectId pitfalls.
    const isOwner = doc.ownerId.toString() === req.user._id.toString();
    const isModerator = req.user.role === User.ROLES.MODERATOR;
    if (!isOwner && !isModerator) {
      throw new ApiError(
        403,
        'Only the owner or a moderator can delete this resource.'
      );
    }

    await Resource.deleteOne({ _id: doc._id });
    return ok(res, { id: doc._id.toString() }, 'Resource deleted');
  } catch (err) {
    next(err);
  }
}

// ── GET /api/resources/nearby ─────────────────────────────────────────────
async function nearbyResources(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Math.min(
      req.query.radius ? parseInt(req.query.radius, 10) : DEFAULT_RADIUS_METERS,
      MAX_RADIUS_METERS
    );

    // Build a filter that combines $near with optional category.
    // $near requires a 2dsphere index — same one we registered in 3.1.
    const filter = {
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radius,
        },
      },
    };
    if (req.query.category) filter.category = req.query.category;

    const docs = await Resource.find(filter).limit(MAX_LIMIT);

    // Compute approximate distance for each hit. We can't get an exact
    // distance from $near alone without aggregation, but the Haversine
    // approximation is good enough for "show me how far" UI affordances.
    const toRad = (d) => (d * Math.PI) / 180;
    const haversineMeters = (a, b) => {
      const R = 6371000;
      const dLat = toRad(b[1] - a[1]);
      const dLng = toRad(b[0] - a[0]);
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };

    const out = docs.map((d) => {
      const obj = publicResource(d);
      if (d.location && Array.isArray(d.location.coordinates)) {
        obj.distanceMeters = Math.round(
          haversineMeters([lng, lat], d.location.coordinates)
        );
      } else {
        obj.distanceMeters = null;
      }
      return obj;
    });

    return ok(res, {
      resources: out,
      query: {
        lat,
        lng,
        radius,
        category: req.query.category || null,
      },
    }, 'Nearby resources fetched');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createResource,
  listResources,
  getResource,
  updateResource,
  deleteResource,
  nearbyResources,
  // Exported so the moderator controller (Module 6.1) can reuse the
  // privacy strip without duplicating the field list.
  publicResource,
};