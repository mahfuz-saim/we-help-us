/**
 * Socket.io emitter — Module 7.4.
 *
 * Thin convenience layer on top of `getIO()` so callers (notification
 * triggers, request controller) never need to reach for the io handle
 * directly. The helpers are deliberately tolerant: a Socket.io outage
 * MUST NOT break the user-facing HTTP lifecycle.
 *
 * Room conventions:
 *   - `user_<id>`         — every authenticated socket joins this on
 *                           handshake. Used to deliver `notification:new`
 *                           and other per-user events.
 *   - `area_<areaId>`     — public room for an area. Future map clients
 *                           subscribe here for `resource:status` updates.
 *   - `public_resources`  — wildcard room; emits every status change so
 *                           the map view can refresh even before area
 *                           partitioning is finalised. Module 7.5's UI
 *                           can choose whichever room shape fits its
 *                           subscription model.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The notification payload mirrors `publicNotification()` from
 *   server/controllers/notification.controller.js — it never includes
 *   email / phone / password. The trigger service is the single source
 *   of the payload; this module only forwards it.
 */

const { getIO } = require('./index');

const PUBLIC_RESOURCES_ROOM = 'public_resources';

function userRoom(userId) {
  return `user_${userId}`;
}

function areaRoom(areaId) {
  return `area_${areaId}`;
}

function safeEmit(target, event, payload) {
  try {
    const io = getIO();
    io.to(target).emit(event, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sockets] emit ${event} → ${target} failed:`,
      err && err.message ? err.message : err
    );
  }
}

/**
 * Deliver a `notification:new` event to a single recipient's room. The
 * payload is the contact-free notification shape (recipientId, title,
 * message, type, relatedId, isRead, createdAt). No email/phone/password.
 */
function emitNotificationToUser(userId, payload) {
  if (!userId) return;
  safeEmit(userRoom(userId), 'notification:new', payload);
}

/**
 * Broadcast a resource status change. Used by the request lifecycle
 * after each Resource.status flip. Both the area-specific room and the
 * global public room get the event so the map view (Module 7.5 UI)
 * can subscribe to whichever scope it needs.
 */
function emitResourceStatusUpdate({ resourceId, status, areaId }) {
  const payload = { resourceId, status };
  if (areaId) safeEmit(areaRoom(areaId), 'resource:status', payload);
  safeEmit(PUBLIC_RESOURCES_ROOM, 'resource:status', payload);
}

module.exports = {
  emitNotificationToUser,
  emitResourceStatusUpdate,
  userRoom,
  areaRoom,
  PUBLIC_RESOURCES_ROOM,
};
