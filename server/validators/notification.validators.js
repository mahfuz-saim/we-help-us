/**
 * Zod validators for Notification APIs (Module 7.2).
 *
 * Recipient scope is NEVER accepted from the query, path, or body. Every
 * controller derives recipientId from req.user._id, so callers cannot read or
 * mutate another user's notifications by supplying a different user id.
 */

const { z } = require('zod');
const { NOTIFICATION_TYPE_VALUES } = require('../models/Notification');

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid ObjectId');

const positiveInteger = (field) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${field} must be a positive integer`)
    .optional();

// GET /api/notifications — recipient scope comes from req.user.
const listNotificationsQuerySchema = z
  .object({
    isRead: z.enum(['true', 'false']).optional(),
    type: z
      .enum(NOTIFICATION_TYPE_VALUES, {
        message:
          'type must be one of: ' + NOTIFICATION_TYPE_VALUES.join(', '),
      })
      .optional(),
    page: positiveInteger('page'),
    limit: positiveInteger('limit'),
  })
  .strict();

// PATCH /api/notifications/:id/read
const notificationIdParamsSchema = z
  .object({
    id: objectIdString,
  })
  .strict();

// Both PATCH actions accept no writable fields. An empty/missing body is
// valid; unknown keys are rejected instead of being silently ignored.
const emptyActionBodySchema = z.object({}).strict().optional();

module.exports = {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  emptyActionBodySchema,
};
