/**
 * Notification model — We Help Us
 *
 * Spec (plan.txt → Module 7.1):
 *   - recipientId (ref User)
 *   - title
 *   - message
 *   - type
 *   - relatedId
 *   - isRead
 *   - createdAt
 *
 * This module intentionally ships the persistence layer only. The user's
 * notification endpoints land in Module 7.2, request-lifecycle triggers in
 * Module 7.3, and Socket.io delivery in Module 7.4.
 *
 * Design reminders baked into this model:
 *   - Privacy: a notification stores only the recipient's User id. It never
 *     denormalizes email, phone, password, or owner contact details. Message
 *     producers must keep notification copy privacy-safe; the model provides
 *     no route that could expose another user's notifications.
 *   - Role restrictions: notifications are role-agnostic records addressed
 *     to one authenticated user. Module 7.2 will enforce recipient ownership
 *     at the API layer rather than trusting a caller-supplied recipientId.
 *   - Related records: `relatedId` is deliberately an unpopulated ObjectId.
 *     Different notification types may point at a ResourceRequest, Resource,
 *     User, or Area. Consumers use the type to choose the correct workflow;
 *     blindly populating a polymorphic reference could cross privacy bounds.
 */

const mongoose = require('mongoose');

/**
 * Canonical notification categories anticipated by Module 7.3's request and
 * moderation triggers. Keeping the values on the model prevents producers,
 * APIs, and clients from drifting while retaining a GENERAL fallback for
 * system messages that are not tied to a lifecycle event.
 */
const NOTIFICATION_TYPES = Object.freeze({
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_APPROVED: 'REQUEST_APPROVED',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  REQUEST_COLLECTED: 'REQUEST_COLLECTED',
  REQUEST_RETURNED: 'REQUEST_RETURNED',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  // Module 7.3 — owner confirmed the resource is back. Distinct from
  // REQUEST_RETURNED (which fires when the volunteer marks the return)
  // so the volunteer sees both events as two separate rows when they
  // happen.
  REQUEST_COMPLETED: 'REQUEST_COMPLETED',
  VOLUNTEER_VERIFIED: 'VOLUNTEER_VERIFIED',
  EMERGENCY_MODE: 'EMERGENCY_MODE',
  GENERAL: 'GENERAL',
});

const NOTIFICATION_TYPE_VALUES = Object.values(NOTIFICATION_TYPES);

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'recipientId is required'],
      index: true,
    },

    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      minlength: [1, 'title is required'],
      maxlength: [120, 'title must be at most 120 characters'],
    },

    message: {
      type: String,
      required: [true, 'message is required'],
      trim: true,
      minlength: [1, 'message is required'],
      maxlength: [1000, 'message must be at most 1000 characters'],
    },

    type: {
      type: String,
      required: [true, 'type is required'],
      enum: {
        values: NOTIFICATION_TYPE_VALUES,
        message:
          'type must be one of: ' + NOTIFICATION_TYPE_VALUES.join(', '),
      },
      default: NOTIFICATION_TYPES.GENERAL,
    },

    relatedId: {
      // Polymorphic reference by design. The notification type determines
      // whether this points to a request, resource, user, or area. Do not add
      // a `ref` here: automatic population could reveal data outside the
      // recipient-safe response assembled by future controllers.
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    isRead: {
      type: Boolean,
      default: false,
      required: true,
    },
  },
  {
    timestamps: true, // createdAt is required by 7.1; updatedAt aids read receipts.
    toJSON: {
      virtuals: false,
      transform: (_doc, ret) => {
        ret.id = ret._id?.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: false },
  }
);

// Module 7.2's primary query: newest notifications for one recipient, often
// narrowed to unread rows for the bell count. The compound order supports
// both `{ recipientId }` and `{ recipientId, isRead }` query prefixes while
// preserving newest-first scans.
notificationSchema.index(
  { recipientId: 1, isRead: 1, createdAt: -1 },
  { name: 'recipient_read_created' }
);

notificationSchema.statics.TYPES = NOTIFICATION_TYPES;
notificationSchema.statics.TYPE_VALUES = NOTIFICATION_TYPE_VALUES;

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_TYPE_VALUES = NOTIFICATION_TYPE_VALUES;
