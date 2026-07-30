/**
 * Notification triggers — Module 7.3.
 *
 * Service helpers that fan out lifecycle notifications from inside the
 * request controllers. The contract is intentionally narrow:
 *
 *   - Each trigger is fire-and-forget. It returns synchronously and
 *     resolves any DB work on the next tick. A trigger NEVER throws
 *     back into the calling controller — a failed write must not
 *     flip the user-facing request lifecycle to a 500. Failures are
 *     logged at warn level so the smoke + dev console can still see
 *     the diagnostic.
 *
 *   - Notification copy is privacy-safe. We never embed email, phone,
 *     or password. The actor's name is intentionally NOT included
 *     either — the dashboard already knows who took the action from
 *     the populated request response. Phrases like "A volunteer has
 *     requested" avoid saying anything about the actor.
 *
 *   - Recipient resolution:
 *       * REQUEST_CREATED → owner of the resource + every active
 *         MODERATOR whose areaId matches the resource's areaId.
 *       * REQUEST_APPROVED → the requesting volunteer.
 *       * REQUEST_REJECTED → the requesting volunteer.
 *       * REQUEST_COLLECTED → the resource owner.
 *       * REQUEST_RETURNED → the resource owner.
 *       * REQUEST_COMPLETED → the requesting volunteer.
 *
 *   - Self-notification is skipped: a moderator who also owns the
 *     resource will not see the moderator-broadcast row when they
 *     create their own (hypothetical) request — and the actor who
 *     takes an action doesn't get a redundant "you did X" row.
 *
 *   - relatedId is set to the request id for every lifecycle row so
 *     the future notification UI (Module 7.5) can deep-link back to
 *     the underlying request.
 */

const Notification = require('../models/Notification');
const User = require('../models/User');
const EmergencyActivation = require('../models/EmergencyActivation');
const {
  emitNotificationToUser,
  emitEmergencyActivated,
} = require('../sockets/emitter');

/**
 * Module 7.4 — contact-free wire shape for real-time payloads. Mirrors
 * server/controllers/notification.controller.js's `publicNotification`
 * helper so the REST GET and the Socket.io event agree byte-for-byte.
 */
function publicNotificationPayload(doc) {
  if (!doc) return null;
  const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: obj.id,
    recipientId: obj.recipientId ? obj.recipientId.toString() : null,
    title: obj.title,
    message: obj.message,
    type: obj.type,
    relatedId: obj.relatedId ? obj.relatedId.toString() : null,
    isRead: obj.isRead === true,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function safeCreate(doc) {
  // Returns the created notification (or null on failure). Errors are
  // logged but never propagated — triggers must be best-effort. Module
  // 7.4: a successful insert is also broadcast to the recipient's
  // `user_<id>` Socket.io room so the dashboard's bell + toast can
  // surface the row immediately (no manual refetch).
  try {
    const created = await Notification.create(doc);
    const payload = publicNotificationPayload(created);
    if (payload) emitNotificationToUser(payload.recipientId, payload);
    return created;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[notifications] trigger failed:',
      err && err.message ? err.message : err
    );
    return null;
  }
}

async function notifyMany(recipientIds, { title, message, type, relatedId }) {
  const ids = Array.from(
    new Set(
      recipientIds
        .filter((id) => id !== null && id !== undefined)
        .map((id) => id.toString())
    )
  );
  if (ids.length === 0) return;
  const docs = ids.map((recipientId) => ({
    recipientId,
    title,
    message,
    type,
    relatedId: relatedId ?? null,
  }));
  // Create one at a time so a duplicate-key / validation error on one
  // row doesn't abort the batch — triggers must be best-effort. The
  // outer caller (controller) awaits `notifyMany` so the row is
  // observable by the time the HTTP response returns. The socket emit
  // inside `safeCreate` runs as a side effect once the DB write lands.
  for (const doc of docs) await safeCreate(doc);
}

async function moderatorRecipientsForArea(areaId, { excludeUserId } = {}) {
  if (!areaId) return [];
  const mods = await User.find({
    role: User.ROLES.MODERATOR,
    areaId,
    isActive: true,
  }).select('_id');
  return mods
    .map((m) => m._id)
    .filter((id) =>
      excludeUserId ? id.toString() !== excludeUserId.toString() : true
    );
}

// ── Trigger entry points ───────────────────────────────────────────────────

/**
 * REQUEST_CREATED — fire after a volunteer successfully creates a new
 * request. Notify the resource owner + every active in-area moderator.
 */
function onRequestCreated({ request, resource, actor }) {
  const recipients = [resource.ownerId];
  moderatorRecipientsForArea(resource.areaId, { excludeUserId: actor._id })
    .then((mods) => {
      recipients.push(...mods);
      return notifyMany(recipients, {
        title: 'New resource request',
        message: 'A volunteer has requested one of your resources.',
        type: Notification.TYPES.REQUEST_CREATED,
        relatedId: request._id,
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        '[notifications] onRequestCreated fan-out failed:',
        err && err.message ? err.message : err
      );
    });
}

/**
 * REQUEST_APPROVED — fire after the owner approves. Notify the volunteer
 * whose request was approved. The owner is the actor; skip self-notify.
 */
function onRequestApproved({ request, actor }) {
  if (!request.volunteerId) return;
  if (request.volunteerId.toString() === actor._id.toString()) return;
  notifyMany([request.volunteerId], {
    title: 'Your request was approved',
    message:
      'The resource owner approved your request. Open it to coordinate pickup.',
    type: Notification.TYPES.REQUEST_APPROVED,
    relatedId: request._id,
  });
}

/**
 * REQUEST_REJECTED — fire after the owner OR a moderator rejects.
 * Notify the requesting volunteer.
 */
function onRequestRejected({ request, actor }) {
  if (!request.volunteerId) return;
  if (request.volunteerId.toString() === actor._id.toString()) return;
  notifyMany([request.volunteerId], {
    title: 'Your request was rejected',
    message: 'Your request was rejected. You can browse other resources now.',
    type: Notification.TYPES.REQUEST_REJECTED,
    relatedId: request._id,
  });
}

/**
 * REQUEST_COLLECTED — fire after the volunteer marks the resource
 * collected. Notify the resource owner so they can track pickup.
 */
function onRequestCollected({ request, actor }) {
  if (!request.ownerId) return;
  if (request.ownerId.toString() === actor._id.toString()) return;
  notifyMany([request.ownerId], {
    title: 'Resource collected',
    message: 'The volunteer marked the resource as collected.',
    type: Notification.TYPES.REQUEST_COLLECTED,
    relatedId: request._id,
  });
}

/**
 * REQUEST_RETURNED — fire after the volunteer returns the resource.
 * Notify the resource owner so they can confirm completion.
 */
function onRequestReturned({ request, actor }) {
  if (!request.ownerId) return;
  if (request.ownerId.toString() === actor._id.toString()) return;
  notifyMany([request.ownerId], {
    title: 'Resource returned',
    message:
      'The volunteer has returned the resource. Please confirm completion.',
    type: Notification.TYPES.REQUEST_RETURNED,
    relatedId: request._id,
  });
}

/**
 * REQUEST_COMPLETED — fire after the owner confirms the resource is
 * back in their hands. Notify the requesting volunteer.
 */
function onRequestCompleted({ request, actor }) {
  if (!request.volunteerId) return;
  if (request.volunteerId.toString() === actor._id.toString()) return;
  notifyMany([request.volunteerId], {
    title: 'Request completed',
    message:
      'The owner has confirmed the resource is back. Thanks for helping.',
    type: Notification.TYPES.REQUEST_COMPLETED,
    relatedId: request._id,
  });
}

/**
 * Module 9 — EMERGENCY_MODE. Fire after a successful activation
 * (volunteer OR moderator). The `recipients` argument is the shape
 * returned by `resolveEmergencyRecipients(activation)` in
 * `server/utils/emergencyScope.js`:
 *
 *   { owners: ObjectId[], volunteers: ObjectId[], moderators: ObjectId[],
 *     all: ObjectId[] }
 *
 * Default behaviour: notify owners + moderators (the people who need
 * to know). Volunteers receive the broadcast via the per-user socket
 * push as well, but only when the helper is invoked with
 * `includeVolunteers: true`.
 *
 * Title + message: the volunteer's / moderator's free-text description
 * is forwarded verbatim. We don't sanitise — phone numbers are the
 * coordination channel in this context.
 *
 * Socket push: `emitEmergencyActivated(...)` is fired to the area room
 * + the public room so the analytics page + map view + resource list
 * can subscribe to live updates without polling.
 *
 * Self-notification is skipped: the activator doesn't get their own
 * "you activated emergency mode" row (the UI already knows — they
 * just clicked the button).
 */
async function onEmergencyActivated({ activation, recipients, includeVolunteers }) {
  if (!activation || !activation._id) return;
  if (!recipients) return;

  const skipId =
    activation.activatedBy && activation.activatedBy._id
      ? activation.activatedBy._id.toString()
      : activation.activatedBy
        ? activation.activatedBy.toString()
        : null;

  const all = [
    ...(recipients.owners || []),
    ...(recipients.moderators || []),
    ...(includeVolunteers ? recipients.volunteers || [] : []),
  ];
  const filtered = skipId
    ? all.filter((id) => id.toString() !== skipId)
    : all;

  // Await so the controller's HTTP response is only sent once the
  // Notification rows are persisted (avoids smoke + UI races).
  await notifyMany(filtered, {
    title: '🚨 Emergency mode activated',
    message: activation.message,
    type: Notification.TYPES.EMERGENCY_MODE,
    relatedId: activation._id,
  });

  // Live socket push for the map / analytics / resource-list views.
  // We send the public shape (no email/phone) so subscribers can use
  // it directly without re-fetching.
  try {
    const publicShape = EmergencyActivation.publicShape(activation);
    emitEmergencyActivated(publicShape);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[notifications] onEmergencyActivated socket push failed:',
      err && err.message ? err.message : err
    );
  }
}

module.exports = {
  onRequestCreated,
  onRequestApproved,
  onRequestRejected,
  onRequestCollected,
  onRequestReturned,
  onRequestCompleted,
  onEmergencyActivated,
  // Re-exported so `utils/emergencyScope.resolveEmergencyRecipients`
  // can fan-out moderator notifications without re-implementing the
  // area→user lookup. Avoids a duplicate "all moderators in area"
  // helper.
  moderatorRecipientsForArea,
};
