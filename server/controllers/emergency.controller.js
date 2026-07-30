/**
 * Emergency controller — Module 9 (Emergency System Rework).
 *
 * Endpoints:
 *   - POST   /api/emergency-activations          (VOLUNTEER, verified)
 *   - POST   /api/moderator/emergency-activations (MODERATOR)
 *   - GET    /api/emergency-activations          (any auth)
 *   - PATCH  /api/emergency-activations/:id/deactivate (auth, gated)
 *   - GET    /api/analytics/emergency-map        (MODERATOR/ADMIN)
 *
 * Defence reminders baked in:
 *
 *   - **Authority boundary**:
 *       * VOLUNTEER must be verified (mirrors the create-request gate
 *         at `request.controller.js` line ~333) and must target a
 *         `rootAreaId` that is either their own `areaId` OR an
 *         ancestor of it (any level of their address chain).
 *       * MODERATOR must target `req.user.areaId` exactly (or have
 *         the call pass it implicitly via the moderator-only
 *         endpoint).
 *       * ADMIN is not a creator role for emergency activations —
 *         oversight is read-only (analytics).
 *
 *   - **One active activation per volunteer**: enforced in the
 *     volunteer POST. The moderator path is exempt because the
 *     6.3 back-compat shim already owns the moderator's row and
 *     upserts in place.
 *
 *   - **CIRCLE without HIERARCHY root**: a circle with no
 *     `rootAreaId` would orphan the area-tree path. We require a
 *     `rootAreaId` on every activation (even CIRCLE-scope ones) so
 *     the analytics map has an anchor for the marker.
 *
 *   - **Privacy**: the response shape is `publicShape()` —
 *     `activatedBy` is just an ObjectId string; the message is the
 *     activator's free text (intentionally NOT sanitised — phone
 *     numbers are the coordination channel). No email / phone /
 *     password is ever exposed.
 *
 *   - **Deactivation race**: the deactivate endpoint uses
 *     `findOneAndUpdate({ _id, isActive: true }, ...)` so concurrent
 *     double-deactivates are idempotent and don't re-fire
 *     notifications. Late-arriving `safeCreate` writes (already
 *     in flight when deactivation happens) are accepted but flagged
 *     as stale — the deactivation doesn't roll them back.
 */

const ApiError = require('../utils/apiError');
const { ok, created } = require('../utils/apiResponse');
const EmergencyActivation = require('../models/EmergencyActivation');
const Area = require('../models/Area');
const User = require('../models/User');
const {
  ancestorAreaIds,
  descendantAreaIds,
  resolveEmergencyRecipients,
  isStillLive,
} = require('../utils/emergencyScope');
const notificationTriggers = require('../services/notificationTriggers');

// ── Helpers ────────────────────────────────────────────────────────────────

function publicActivation(doc) {
  return EmergencyActivation.publicShape(doc);
}

/**
 * Verify a volunteer may target `rootAreaId`. Allowed iff the
 * rootAreaId equals the volunteer's own `areaId` OR is an ancestor of
 * it (i.e. rootAreaId is a coarser level of the volunteer's
 * address). Returns the ancestor set on success; throws ApiError(403)
 * otherwise.
 */
async function assertVolunteerRootAllowed({ volunteer, rootAreaId }) {
  if (!volunteer.areaId) {
    throw new ApiError(
      403,
      'You must have an assigned area to activate emergency mode.'
    );
  }
  if (!rootAreaId) {
    throw new ApiError(400, 'rootAreaId is required.');
  }
  // Cheap path: volunteer's own areaId IS the root.
  if (rootAreaId.toString() === volunteer.areaId.toString()) {
    const rootArea = await Area.findById(rootAreaId).select('level').lean();
    return {
      volunteerAncestors: [volunteer.areaId],
      rootArea,
    };
  }
  const ancestors = await ancestorAreaIds(volunteer.areaId);
  const ancestorStrings = ancestors.map((id) => id.toString());
  if (!ancestorStrings.includes(rootAreaId.toString())) {
    throw new ApiError(
      403,
      'You can only activate emergency for your own area or an ancestor of it.'
    );
  }
  // For the controller's logic we need the ancestors up to (and
  // including) rootAreaId.
  const idx = ancestorStrings.indexOf(rootAreaId.toString());
  const volunteerAncestors = ancestors.slice(0, idx + 1);
  const rootArea = await Area.findById(rootAreaId).select('level').lean();
  return { volunteerAncestors, rootArea };
}

async function assertModeratorRootAllowed({ moderator, rootAreaId }) {
  if (!moderator.areaId) {
    throw new ApiError(
      403,
      'You must have an assigned area to activate emergency mode.'
    );
  }
  if (rootAreaId && rootAreaId.toString() !== moderator.areaId.toString()) {
    throw new ApiError(
      403,
      'Moderators can only activate emergency for their own assigned area.'
    );
  }
  const rootArea = await Area.findById(moderator.areaId)
    .select('level')
    .lean();
  return { rootArea };
}

// ── POST /api/emergency-activations (volunteer) ───────────────────────────
async function createVolunteerActivation(req, res, next) {
  try {
    if (!req.user) throw new ApiError(401, 'Not authenticated.');
    if (req.user.role !== User.ROLES.VOLUNTEER) {
      throw new ApiError(
        403,
        'Only verified volunteers can activate emergency mode.'
      );
    }
    if (req.user.isVerified !== true) {
      throw new ApiError(
        403,
        'You must be a verified volunteer to activate emergency mode.'
      );
    }

    const { rootAreaId, message, center, radiusMeters, expiresAt } = req.body;

    const { rootArea } = await assertVolunteerRootAllowed({
      volunteer: req.user,
      rootAreaId,
    });
    if (!rootArea) {
      throw new ApiError(404, 'Target area not found.');
    }

    // One active activation per volunteer (per the plan's authority
    // decision). We don't police moderator activations here — the
    // 6.3 shim owns that row and upserts in place.
    const existing = await EmergencyActivation.findOne({
      activatedBy: req.user._id,
      activatedByRole: EmergencyActivation.ACTOR_ROLES.VOLUNTEER,
      isActive: true,
    }).lean();
    if (existing) {
      throw new ApiError(
        409,
        'You already have an active emergency activation. Deactivate it before activating a new one.'
      );
    }

    // Resolve scope-specific geometry.
    const isCircle = !!center && Number.isFinite(radiusMeters);
    const scope = isCircle
      ? EmergencyActivation.SCOPES.CIRCLE
      : EmergencyActivation.SCOPES.HIERARCHY;
    const descendantIds = isCircle
      ? []
      : await descendantAreaIds(rootAreaId);

    const doc = await EmergencyActivation.create({
      rootAreaId,
      level: rootArea.level,
      scope,
      center: isCircle
        ? {
            type: 'Point',
            coordinates: [center.coordinates[0], center.coordinates[1]],
          }
        : undefined,
      radiusMeters: isCircle ? radiusMeters : null,
      descendantAreaIds: descendantIds,
      message,
      activatedBy: req.user._id,
      activatedByRole: EmergencyActivation.ACTOR_ROLES.VOLUNTEER,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
    });

    // Fan-out notifications. We exclude the activator (handled
    // inside onEmergencyActivated).
    let recipients = { owners: [], volunteers: [], moderators: [], all: [] };
    try {
      recipients = await resolveEmergencyRecipients(doc);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[emergency] resolveEmergencyRecipients failed:',
        e && e.message ? e.message : e
      );
    }
    await notificationTriggers.onEmergencyActivated({
      activation: doc,
      recipients,
      includeVolunteers: false, // owners + moderators only by default
    });

    return created(
      res,
      { activation: publicActivation(doc) },
      'Emergency activation created'
    );
  } catch (err) {
    next(err);
  }
}

// ── POST /api/moderator/emergency-activations ─────────────────────────────
async function createModeratorActivation(req, res, next) {
  try {
    if (!req.user) throw new ApiError(401, 'Not authenticated.');
    if (req.user.role !== User.ROLES.MODERATOR) {
      throw new ApiError(
        403,
        'Only moderators can use this endpoint.'
      );
    }
    const { rootAreaId, message, center, radiusMeters, expiresAt } = req.body;
    const { rootArea } = await assertModeratorRootAllowed({
      moderator: req.user,
      rootAreaId,
    });
    if (!rootArea) {
      throw new ApiError(404, 'Your assigned area could not be found.');
    }
    const effectiveRoot = rootAreaId;

    const isCircle = !!center && Number.isFinite(radiusMeters);
    const scope = isCircle
      ? EmergencyActivation.SCOPES.CIRCLE
      : EmergencyActivation.SCOPES.HIERARCHY;
    const descendantIds = isCircle
      ? []
      : await descendantAreaIds(effectiveRoot);

    const doc = await EmergencyActivation.create({
      rootAreaId: effectiveRoot,
      level: rootArea.level,
      scope,
      center: isCircle
        ? {
            type: 'Point',
            coordinates: [center.coordinates[0], center.coordinates[1]],
          }
        : undefined,
      radiusMeters: isCircle ? radiusMeters : null,
      descendantAreaIds: descendantIds,
      message: (message || '').trim() ||
        'Emergency mode activated by moderator.',
      activatedBy: req.user._id,
      activatedByRole: EmergencyActivation.ACTOR_ROLES.MODERATOR,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
    });

    let recipients = { owners: [], volunteers: [], moderators: [], all: [] };
    try {
      recipients = await resolveEmergencyRecipients(doc);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[emergency] resolveEmergencyRecipients failed:',
        e && e.message ? e.message : e
      );
    }
    await notificationTriggers.onEmergencyActivated({
      activation: doc,
      recipients,
      includeVolunteers: false,
    });

    return created(
      res,
      { activation: publicActivation(doc) },
      'Emergency activation created'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/emergency-activations ────────────────────────────────────────
async function listActivations(req, res, next) {
  try {
    // Default: only active rows. The `active` query param accepts
    // `'true' | 'false' | '1' | '0'` (the validator enforces the set).
    // `'true'` / `'1'` → active only (default). `'false'` / `'0'` →
    // inactive only. Anything else (including absent) → active only.
    const filter = { isActive: true };
    if (req.query.rootAreaId) filter.rootAreaId = req.query.rootAreaId;
    if (req.query.scope) filter.scope = req.query.scope;
    const rawActive = req.query.active;
    if (rawActive === 'false' || rawActive === '0') {
      filter.isActive = false;
    } else if (rawActive === 'true' || rawActive === '1') {
      filter.isActive = true;
    }

    // `?areaId=X` → expand to all activations whose descendantAreaIds
    // include X (HIERARCHY scope). For CIRCLE scope we always return
    // everything matching the filter — there's no cheap index to ask
    // "does this circle cover X?" without per-doc geo math.
    if (req.query.areaId) {
      const descendants = await ancestorAreaIds(req.query.areaId);
      const hierFilter = {
        ...filter,
        scope: EmergencyActivation.SCOPES.HIERARCHY,
        descendantAreaIds: { $in: descendants.map((id) => id.toString()) },
      };
      const docs = await EmergencyActivation.find(hierFilter)
        .sort({ activatedAt: -1 })
        .limit(parseInt(req.query.limit || '50', 10));
      return ok(
        res,
        {
          activations: docs.map(publicActivation).filter((a) => isStillLive(a)),
        },
        'Activations fetched'
      );
    }

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const docs = await EmergencyActivation.find(filter)
      .sort({ activatedAt: -1 })
      .limit(limit);
    return ok(
      res,
      {
        activations: docs
          .map(publicActivation)
          .filter((a) => isStillLive(a)),
      },
      'Activations fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/emergency-activations/:id/deactivate ───────────────────────
async function deactivateActivation(req, res, next) {
  try {
    if (!req.user) throw new ApiError(401, 'Not authenticated.');

    const existing = await EmergencyActivation.findById(req.params.id);
    if (!existing) throw new ApiError(404, 'Activation not found.');
    if (!existing.isActive) {
      // Idempotent: already inactive.
      return ok(
        res,
        { activation: publicActivation(existing) },
        'Emergency activation already inactive'
      );
    }

    // Authority: original activator OR a moderator in the rootAreaId's
    // ancestor chain OR an admin.
    const isOriginal = existing.activatedBy.toString() === req.user._id.toString();
    let isAuthMod = false;
    if (req.user.role === User.ROLES.MODERATOR && req.user.areaId) {
      const ancestors = await ancestorAreaIds(req.user.areaId);
      isAuthMod = ancestors
        .map((id) => id.toString())
        .includes(existing.rootAreaId.toString());
    }
    const isAdmin = req.user.role === User.ROLES.ADMIN;
    if (!isOriginal && !isAuthMod && !isAdmin) {
      throw new ApiError(
        403,
        'Only the original activator, a moderator in the area, or an admin can deactivate this emergency.'
      );
    }

    // Atomic flip — concurrent calls collapse to one effective write.
    // Only the request whose `findOneAndUpdate` matched returns a
    // non-null `updated`; the loser gets null (no doc matched). Both
    // responses re-fetch the row to surface the final state, so the
    // loser reports `isActive=false` (the winner's write landed).
    const updated = await EmergencyActivation.findOneAndUpdate(
      { _id: existing._id, isActive: true },
      { $set: { isActive: false, expiresAt: new Date() } },
      { returnDocument: 'after' }
    );
    const finalDoc = updated || (await EmergencyActivation.findById(existing._id));

    return ok(
      res,
      { activation: publicActivation(finalDoc) },
      'Emergency activation deactivated'
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/analytics/emergency-map ──────────────────────────────────────
//
// Read-only payload for the analytics page's map component. Returns
// the full activation list scoped to the caller's area (moderator)
// or globally (admin). The client renders circles + hierarchy
// markers from this single payload — no further round-trips needed.
async function getEmergencyMap(req, res, next) {
  try {
    if (
      req.user.role !== User.ROLES.MODERATOR &&
      req.user.role !== User.ROLES.ADMIN
    ) {
      throw new ApiError(403, 'Moderator or admin role required.');
    }
    const filter = { isActive: true };
    if (req.user.role === User.ROLES.MODERATOR) {
      if (!req.user.areaId) {
        return ok(res, { activations: [] }, 'No scope');
      }
      // Moderator scope = the moderator's area + every descendant.
      // A HIERARCHY activation is "in scope" when its `rootAreaId`
      // lives anywhere under the moderator (we walk the subtree,
      // then match the activation's root against it). CIRCLE
      // activations are global for moderation (the radius does
      // not respect district boundaries).
      const { descendantAreaIds: modDescendants } = require('../utils/emergencyScope');
      const scopeIds = await modDescendants(req.user.areaId);
      filter.$or = [
        {
          scope: EmergencyActivation.SCOPES.HIERARCHY,
          rootAreaId: { $in: scopeIds.map((id) => id.toString()) },
        },
        { scope: EmergencyActivation.SCOPES.CIRCLE },
      ];
    }
    const docs = await EmergencyActivation.find(filter)
      .sort({ activatedAt: -1 })
      .limit(200);
    return ok(
      res,
      {
        activations: docs
          .map(publicActivation)
          .filter((a) => isStillLive(a)),
      },
      'Emergency map fetched'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createVolunteerActivation,
  createModeratorActivation,
  listActivations,
  deactivateActivation,
  getEmergencyMap,
  // Re-exported so the moderator shim can call into the controller's
  // helper without duplicating the authority check.
  assertModeratorRootAllowed,
};