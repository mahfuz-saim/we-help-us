/**
 * useEmergencyActivations — TanStack Query hooks for the Module 9
 * emergency system rework.
 *
 * Provides:
 *   - useEmergencyActivations(opts)       — list (auth, filterable)
 *   - useCreateVolunteerActivation()      — volunteer POST
 *   - useCreateModeratorActivation()      — moderator POST
 *   - useDeactivateEmergencyActivation()  — PATCH deactivate
 *   - useEmergencyMap()                   — moderator/admin map data
 *
 * All hooks share the same query-key family `['emergency-activations']`
 * (with sub-keys for filters). Mutations invalidate the family so list
 * views, the analytics map, and the resource list (which exposes
 * `areaEmergencyActive` per row) refresh in lockstep.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   Activation payloads return `activatedBy` as an ObjectId string —
 *   never email/phone/password. The hooks relay that as-is.
 *
 * Socket subscription (Module 9.5):
 *   `useNotificationSocket` listens for `emergency:activated` events
 *   and invalidates the `emergency-activations` family. That covers
 *   the analytics page + the resource list without extra wiring here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createModeratorActivation,
  createVolunteerActivation,
  deactivateEmergencyActivation,
  getEmergencyMap,
  listEmergencyActivations,
} from '../services/emergency';

const KEYS = {
  family: ['emergency-activations'],
  list: (filters = {}) => [...KEYS.family, 'list', filters],
  mine: (volunteerId) => [...KEYS.family, 'mine', volunteerId],
  map: () => [...KEYS.family, 'map'],
};

/**
 * Read the list of emergency activations.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootAreaId]
 * @param {string} [opts.areaId]
 * @param {boolean} [opts.active]
 * @param {boolean} [opts.enabled=true]
 */
export function useEmergencyActivations(opts = {}, { enabled = true } = {}) {
  const filters = {
    rootAreaId: opts.rootAreaId || null,
    areaId: opts.areaId || null,
    active: opts.active !== undefined ? opts.active : true,
  };
  return useQuery({
    queryKey: KEYS.list(filters),
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => {
      return await listEmergencyActivations(filters);
    },
  });
}

/**
 * Create a volunteer emergency activation.
 * Invalidates the list + map + resource caches on success.
 */
export function useCreateVolunteerActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body) => await createVolunteerActivation(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.family });
      // Resource list surfaces `areaEmergencyActive` per row.
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['owner-resources'] });
      qc.invalidateQueries({ queryKey: ['resource-requests'] });
    },
  });
}

/**
 * Create a moderator emergency activation (locked to moderator.areaId).
 */
export function useCreateModeratorActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body) => await createModeratorActivation(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.family });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['owner-resources'] });
      qc.invalidateQueries({ queryKey: ['resource-requests'] });
      // The legacy 6.3 hook shares the same data — refresh it too.
      qc.invalidateQueries({ queryKey: ['moderator-emergency-mode'] });
    },
  });
}

/**
 * Deactivate an emergency activation. Idempotent on the server.
 */
export function useDeactivateEmergencyActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => await deactivateEmergencyActivation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.family });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['owner-resources'] });
      qc.invalidateQueries({ queryKey: ['resource-requests'] });
      qc.invalidateQueries({ queryKey: ['moderator-emergency-mode'] });
    },
  });
}

/**
 * Read the moderator / admin emergency map (all active activations
 * in scope). Drives the analytics page's `EmergencyMapCard`.
 */
export function useEmergencyMap({ enabled = true } = {}) {
  return useQuery({
    queryKey: KEYS.map(),
    enabled,
    staleTime: 30 * 1000,
    queryFn: async () => await getEmergencyMap(),
  });
}
