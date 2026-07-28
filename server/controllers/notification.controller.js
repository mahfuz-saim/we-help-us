/**
 * Notification controller — Module 7.2.
 *
 * Authenticated, recipient-scoped inbox surface:
 *   - GET    /api/notifications              (recipient-scoped list)
 *   - PATCH  /api/notifications/:id/read     (mark one read)
 *   - PATCH  /api/notifications/mark-all-read (mark all read)
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The recipient is ALWAYS `req.user._id`. Callers cannot read or
 *     mutate another user's notifications. Mark-one returns 404 on a
 *     foreign id so existence is not disclosed. Mark-all writes a
 *     filter locked to recipientId so a request never affects rows
 *     belonging to other users, even if the controller is later
 *     wired to new flows.
 *   - The response is the public notification shape only. We do NOT
 *     populate `relatedId` — it is polymorphic by design and the type
 *     alone tells consumers which workflow they need to visit. The
 *     body copy is owned by the trigger that produced the notification.
 *   - Every notification is addressed to a single user. There is no
 *     broadcast channel here.
 *
 * Role restrictions:
 *   - Notifications are role-agnostic. Any authenticated user can read
 *     their own inbox; there is no role-gated view. Module 7.3 will add
 *     the request-lifecycle triggers that produce notifications; this
 *     module only ships the recipient endpoints.
 */

const ApiError = require('../utils/apiError');
const { ok } = require('../utils/apiResponse');
const Notification = require('../models/Notification');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * Strip a notification doc down to the wire shape. The model already
 * removes __v and renames _id → id, so we just keep the explicit
 * recipient/contact-free fields. We never include the populated
 * `relatedId` — callers fetch the related resource through their own
 * permission-aware endpoints.
 */
function publicNotification(doc) {
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

function paginationFrom(req) {
  const page = req.query.page ? parseInt(req.query.page, 10) : 1;
  const limit = Math.min(
    req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ── GET /api/notifications ─────────────────────────────────────────────────
// Recipient-scoped list. Supports optional `isRead` and `type` filters; the
// result is paginated and ordered newest-first. No recipient can see another
// user's inbox even if they supply a recipientId — the controller ignores
// any such field.
async function listNotifications(req, res, next) {
  try {
    const { page, limit, skip } = paginationFrom(req);

    const filter = { recipientId: req.user._id };
    if (req.query.isRead !== undefined) {
      filter.isRead = req.query.isRead === 'true';
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }

    const [docs, total, unreadTotal] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({
        recipientId: req.user._id,
        isRead: false,
      }),
    ]);

    return ok(
      res,
      {
        notifications: docs.map(publicNotification),
        unreadCount: unreadTotal,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      'Notifications fetched'
    );
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/notifications/:id/read ─────────────────────────────────────
// Mark one notification read. Foreign ids (not owned by req.user) return 404
// rather than 403 — we treat notification existence as a privacy boundary so
// callers cannot probe for the presence of another user's inbox.
async function markOneRead(req, res, next) {
  try {
    const { id } = req.params;
    const doc = await Notification.findOneAndUpdate(
      { _id: id, recipientId: req.user._id },
      { $set: { isRead: true } },
      { returnDocument: 'after' }
    );
    if (!doc) {
      throw new ApiError(404, 'Notification not found');
    }
    return ok(res, publicNotification(doc), 'Notification marked as read');
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/notifications/mark-all-read ─────────────────────────────────
// Marks every unread row for req.user as read in a single update. The query
// is locked to the recipientId so it cannot touch rows owned by other users.
async function markAllRead(req, res, next) {
  try {
    const result = await Notification.updateMany(
      { recipientId: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    return ok(
      res,
      { modifiedCount: result.modifiedCount || 0 },
      'Notifications marked as read'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  markOneRead,
  markAllRead,
  publicNotification,
};