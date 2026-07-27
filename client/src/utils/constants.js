/**
 * Project-wide constants.
 *
 * Anything that mirrors server-side enums, route paths, or design-system
 * tokens belongs here so it's a single source of truth.
 */

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

// Resource categories — must match server-side Resource.category enum (Module 3.1).
// Plus emoji icons for quick visual identification (Module 3.3 maps these
// to Leaflet DivIcons).
export const RESOURCE_CATEGORIES = Object.freeze([
  { value: 'TRANSPORTATION',     label: 'Transportation',          icon: '🚗' },
  { value: 'RESCUE_EQUIPMENT',   label: 'Rescue Equipment',        icon: '🛟' },
  { value: 'MEDICAL',            label: 'Medical',                 icon: '⛑️' },
  { value: 'INFRASTRUCTURE',     label: 'Infrastructure',          icon: '🏗️' },
  { value: 'UTILITIES',          label: 'Utilities',               icon: '💡' },
  { value: 'SKILLED_PROFESSIONALS', label: 'Skilled Professionals', icon: '🧑‍🔧' },
]);

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
