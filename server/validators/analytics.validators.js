/**
 * Analytics validators — Module 8.1.
 *
 * Strict zod schemas for the analytics query surface. All endpoints
 * are read-only and gated at the router level by
 * `authorize('MODERATOR', 'ADMIN')`. We keep the validator surface
 * intentionally tiny — most endpoints take no params at all — but a
 * few accept an optional `limit` for top-N style responses.
 *
 * Every schema is `.strict()` so unknown query keys are rejected at
 * the validator layer (regression mirrors the resource / request /
 * moderator validators).
 */

const { z } = require('zod');

// Reusable limit parser: optional positive integer string, capped at 50.
const positiveIntString = (max) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, 'must be a positive integer')
    .transform((s) => parseInt(s, 10))
    .refine((n) => n <= max, `must be at most ${max}`);

const limitSchema = positiveIntString(50);

// ── GET /api/analytics/total-by-category ─────────────────────────────────
// No query params. Counts of resources by category. `.strict()` so
// any future ?key=value is a 400.
const totalByCategoryQuerySchema = z.object({}).strict();

// ── GET /api/analytics/distribution-by-area ──────────────────────────────
// Optional `level` (DISTRICT|UPAZILA|UNION|WARD|VILLAGE) — when omitted
// the response rolls up to the area directly assigned on each resource.
const distributionByAreaQuerySchema = z
  .object({
    level: z
      .enum(['DISTRICT', 'UPAZILA', 'UNION', 'WARD', 'VILLAGE'])
      .optional(),
    limit: limitSchema.optional(),
  })
  .strict();

// ── GET /api/analytics/most-used-resources ───────────────────────────────
// Optional `limit` (1..50, default 10) for the top-N table.
const mostUsedResourcesQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^([1-9]|[1-4][0-9]|50)$/, 'limit must be 1..50')
      .optional(),
  })
  .strict();

// ── GET /api/analytics/active-emergency-assets ───────────────────────────
// No query params. Returns resources in areas where emergency mode
// is currently active.
const activeEmergencyAssetsQuerySchema = z.object({}).strict();

// ── GET /api/analytics/coverage-by-village ───────────────────────────────
// Optional `level` (default VILLAGE) — selects the roll-up level for
// the per-area count grid.
const coverageByVillageQuerySchema = z
  .object({
    level: z.enum(['VILLAGE', 'WARD', 'UNION', 'UPAZILA', 'DISTRICT']).optional(),
  })
  .strict();

module.exports = {
  totalByCategoryQuerySchema,
  distributionByAreaQuerySchema,
  mostUsedResourcesQuerySchema,
  activeEmergencyAssetsQuerySchema,
  coverageByVillageQuerySchema,
};
