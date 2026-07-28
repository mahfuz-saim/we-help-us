/**
 * Distance helpers (Module 4.1).
 *
 * The resource list endpoint returns `location: { type: 'Point', coordinates: [lng, lat] }`
 * for every geo-located resource. Combined with the signed-in user's `user.location`,
 * we can compute "how far is this from me" on the client without a separate
 * /resources/nearby round-trip.
 *
 * This is a mirror of the Haversine formula the server uses inside
 * `nearbyResources` (server/controllers/resource.controller.js). The two should
 * agree to within 1m on any plausible lat/lng.
 */

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two GeoJSON points, in meters.
 *
 * @param {[number, number]} a  [lng, lat]
 * @param {[number, number]} b  [lng, lat]
 * @returns {number} meters (rounded to nearest integer)
 */
export function haversineMeters(a, b) {
  if (!a || !b) return null;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  if (
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng2) ||
    !Number.isFinite(lat2) ||
    lng1 < -180 ||
    lng1 > 180 ||
    lng2 < -180 ||
    lng2 > 180 ||
    lat1 < -90 ||
    lat1 > 90 ||
    lat2 < -90 ||
    lat2 > 90
  ) {
    return null;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h)));
}

/**
 * Format a meter distance for display.
 *   850   -> "850 m"
 *   2300  -> "2.3 km"
 *   12500 -> "13 km"   (one decimal place only below 10 km)
 */
export function formatDistance(meters) {
  if (meters == null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${meters} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}