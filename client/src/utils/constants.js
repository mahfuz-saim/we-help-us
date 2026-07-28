/**
 * Project-wide constants.
 *
 * Anything that mirrors server-side enums, route paths, or design-system
 * tokens belongs here so it's a single source of truth.
 */

import {
  CATEGORIES,
  CATEGORY_VALUES,
  CATEGORY_META,
} from './categories';

// Roles — must match the User.role enum on the server (Module 1.1).
export const ROLES = Object.freeze({
  OWNER: 'OWNER',
  VOLUNTEER: 'VOLUNTEER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
});

// Roles that a member of the public can self-register as.
// Per KEY DESIGN REMINDER: "Role escalation: public registration is
// OWNER/VOLUNTEER only, always".
export const PUBLIC_REGISTRATION_ROLES = Object.freeze([
  ROLES.OWNER,
  ROLES.VOLUNTEER,
]);

// Resource categories — canonical source is client/src/utils/categories.js
// (Module 3.3, shared with server/utils/categories.js). We re-export
// the meta here as `RESOURCE_CATEGORIES` so existing imports keep
// working — the source of truth is the categories module.
export const RESOURCE_CATEGORIES = CATEGORY_META;

// Resource statuses — must match server-side Resource.status enum (Module 3.1).
export const RESOURCE_STATUS = Object.freeze({
  AVAILABLE:   { value: 'AVAILABLE',   label: 'Available',   color: 'safe' },
  RESERVED:    { value: 'RESERVED',    label: 'Reserved',    color: 'caution' },
  IN_USE:      { value: 'IN_USE',      label: 'In Use',      color: 'caution' },
  UNAVAILABLE: { value: 'UNAVAILABLE', label: 'Unavailable', color: 'alert' },
});

// Upload limits — must match server/middlewares/upload.js (KEY DESIGN REMINDER).
export const UPLOAD_LIMITS = Object.freeze({
  MAX_FILES: 5,
  MAX_FILE_SIZE_MB: 5,
  ACCEPTED_MIME_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
  ],
  ACCEPTED_EXTENSIONS: '.jpg,.jpeg,.png,.webp,.gif',
});

// LocalStorage key for the JWT access token.
export const TOKEN_STORAGE_KEY = 'whu_token';

// Default pagination size.
export const DEFAULT_PAGE_SIZE = 20;

// Administrative hierarchy — must match server-side Area model (Module 2.1).
// Ordered top → bottom so the cascading dropdown iterates in order.
export const AREA_LEVELS = Object.freeze([
  { value: 'DISTRICT', label: 'District' },
  { value: 'UPAZILA',  label: 'Upazila' },
  { value: 'UNION',    label: 'Union' },
  { value: 'WARD',     label: 'Ward' },
  { value: 'VILLAGE',  label: 'Village' },
]);

// Default map view — centered on Dhaka, Bangladesh. The OpenStreetMap
// default tiles render at zoom 13 for ~city-block detail.
export const DEFAULT_MAP_CENTER = Object.freeze({ lat: 23.8103, lng: 90.4125 });
export const DEFAULT_MAP_ZOOM = 12;

// Re-export the category enum so consumers can choose:
//   import { CATEGORIES, CATEGORY_VALUES } from '../utils/constants';
// without reaching into the categories module directly.
export { CATEGORIES, CATEGORY_VALUES };
