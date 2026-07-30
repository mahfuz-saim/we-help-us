/**
 * emergency.js — axios wrappers for the Module 9 emergency endpoints.
 *
 * Endpoints:
 *   POST  /api/emergency-activations                  (volunteer)
 *   POST  /api/moderator/emergency-activations        (moderator)
 *   GET   /api/emergency-activations                  (auth, list)
 *   PATCH /api/emergency-activations/:id/deactivate   (auth, gated)
 *   GET   /api/analytics/emergency-map                (moderator/admin)
 *
 * Privacy:
 *   The server returns `activatedBy` as a public shape (id only,
 *   no email/phone). The hooks consume that directly.
 */

import api from './api';

/**
 * Create a volunteer emergency activation.
 *
 * @param {object} body
 * @param {string} body.rootAreaId - any area in the volunteer's chain
 * @param {string} body.message - coordination message
 * @param {object} [body.center] - GeoJSON Point { type: 'Point', coordinates: [lng, lat] }
 * @param {number} [body.radiusMeters] - 1..50000, paired with center
 * @param {string} [body.expiresAt] - ISO string, future, ≤7 days out
 * @returns {Promise<{ activation: object }>}
 */
export async function createVolunteerActivation(body) {
  const { data } = await api.post('/emergency-activations', body);
  return data?.data || null;
}

/**
 * Create a moderator emergency activation (always scoped to mod.areaId).
 *
 * @param {object} body - same shape as createVolunteerActivation
 * @returns {Promise<{ activation: object }>}
 */
export async function createModeratorActivation(body) {
  const { data } = await api.post('/moderator/emergency-activations', body);
  return data?.data || null;
}

/**
 * List emergency activations.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootAreaId] - exact match
 * @param {string} [opts.areaId] - matches self OR descendant
 * @param {boolean} [opts.active] - default true
 */
export async function listEmergencyActivations(opts = {}) {
  const params = {};
  if (opts.rootAreaId) params.rootAreaId = opts.rootAreaId;
  if (opts.areaId) params.areaId = opts.areaId;
  if (opts.active !== undefined) params.active = opts.active ? '1' : '0';
  const { data } = await api.get('/emergency-activations', { params });
  return data?.data?.activations || [];
}

/**
 * Deactivate an emergency activation. Idempotent.
 *
 * @param {string} id
 * @returns {Promise<{ activation: object }>}
 */
export async function deactivateEmergencyActivation(id) {
  const { data } = await api.patch(
    `/emergency-activations/${encodeURIComponent(id)}/deactivate`
  );
  return data?.data || null;
}

/**
 * Fetch the moderator / admin emergency map (active activations).
 * Returns `{ activations: [{ id, rootAreaId, level, scope, center,
 * radiusMeters, descendantAreaIds, message, activatedBy,
 * activatedByRole, activatedAt, expiresAt, isActive }] }`.
 */
export async function getEmergencyMap() {
  const { data } = await api.get('/analytics/emergency-map');
  return data?.data?.activations || [];
}
