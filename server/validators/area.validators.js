/**
 * Zod validators for the area endpoints (Module 2.1).
 *
 * The single endpoint — GET /api/areas — accepts an optional `level`
 * and an optional `parent` ObjectId. The combinations are:
 *
 *   ?level=DISTRICT             → all top-level districts
 *   ?parent=<districtId>        → all children of that node
 *                                 (level inferred from caller, or
 *                                  filtered by ?level too)
 *   ?level=UPAZILA&parent=<id>  → upazilas whose parent is <id>
 *
 * ObjectId is a 24-char hex string. We validate the format here so the
 * controller never has to deal with CastError noise from Mongoose.
 */

const { z } = require('zod');
const Area = require('../models/Area');

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'parent must be a valid ObjectId');

// `level` is optional but, if present, must be one of the enum values
// the model exposes. We import LEVEL_VALUES from the model so the
// client and server can never drift apart.
const listAreasQuerySchema = z
  .object({
    level: z
      .enum(Area.LEVEL_VALUES, {
        message:
          'level must be one of: ' + Area.LEVEL_VALUES.join(', '),
      })
      .optional(),
    parent: objectIdString.optional(),
  })
  .strict() // reject unknown query keys (defense vs typos)
  .refine(
    // At least one of `level` or `parent` should be present — without
    // either, we'd return the entire collection, which is a bad
    // default for a cascading dropdown. The client always provides
    // one (the UI starts with `?level=DISTRICT`).
    (q) => q.level !== undefined || q.parent !== undefined,
    { message: 'Provide either level or parent to filter areas.' }
  );

// Params schema for GET /api/areas/:id — used to resolve a stored
// areaId back to its hierarchy chain for the profile page summary.
const getAreaByIdParamsSchema = z
  .object({
    id: objectIdString,
  })
  .strict();

module.exports = {
  listAreasQuerySchema,
  getAreaByIdParamsSchema,
};