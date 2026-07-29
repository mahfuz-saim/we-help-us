/**
 * ProfilePage — self-service profile (Module 1.4 + Module 2.2 + 2.2 fix).
 *
 * Two visual sections:
 *   1. Account info (read-only) — avatar, name, role badge, joined date,
 *      last login. Hydrated from AuthContext on mount.
 *   2. Editable info — a react-hook-form with name, email, phone,
 *      and location. The location picker (AreaSelector from Module 2.2)
 *      runs in two modes:
 *        - DISPLAY mode (default after first save): renders a read-only
 *          summary showing the saved hierarchy label + a static Leaflet
 *          map with a single fixed marker. No tabs, no inputs.
 *          An "Edit location" button sits next to the fieldset.
 *        - EDIT mode (the picker itself): the interactive three-mode
 *          AreaSelector renders. A "Cancel" button reverts the local
 *          form state to the last saved snapshot.
 *      If the user has never saved a location, the page starts in EDIT
 *      mode automatically (nothing to display yet).
 *      Submitting the form PATCHes /api/users/me and refreshes the
 *      AuthContext; after a successful save the page flips back to
 *      DISPLAY mode so the user sees the freshly persisted record.
 *
 * Plus an avatar upload form that POSTs a multipart avatar to
 * /api/users/me/avatar. Cloudinary may be unconfigured on the server;
 * in that case the response is a 503 and we surface a friendly notice
 * instead of treating it as an error.
 *
 * KEY DESIGN REMINDERS honored:
 *   - Role escalation: the editable form does NOT include role. The
 *     server also rejects role/password/isActive/isVerified in the
 *     PATCH body (defense in depth).
 *   - Role-based access: this page is reachable only by authenticated
 *     users (ProtectedRoute wraps it in App.jsx).
 *   - Upload limits: the file picker uses `accept` + the same constants
 *     exported from utils/constants — 5 MB / image-only.
 *   - Privacy: AreaSelector emits areaId (deepest node) + lng/lat. We
 *     NEVER read owner contact info from the area tree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import RoleBadge from '../components/RoleBadge';
import AreaSelector from '../components/AreaSelector';
import { extractFormError } from '../utils/formErrors';
import { UPLOAD_LIMITS } from '../utils/constants';

const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const delta = Date.now() - t;
  if (delta < 60_000) return 'just now';
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))} h ago`;
  return formatDate(iso);
}

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();

  // We deliberately do NOT fetch /api/users/me on mount. The AuthContext
  // already hydrates the user once on app load (via GET /auth/me) or
  // sets it from the login/register response. The profile data only
  // changes when THIS page mutates it (PATCH /api/users/me or avatar
  // upload), and we call refreshUser() right after those — so the
  // AuthContext always holds the canonical state. Calling it again on
  // mount just creates an extra round-trip with no new information.

  // ── Editable form ──────────────────────────────────────────────────────
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    formState: { errors, isDirty },
  } = useForm({
    mode: 'onTouched',
    defaultValues: blankDefaults(),
  });

  // Re-seed the form whenever the user object changes (after a PATCH or
  // after the initial AuthContext hydration).
  useEffect(() => {
    if (!user) return;
    const coords = user?.location?.coordinates;
    reset({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      // The AreaSelector is bound to `area` via Controller below.
      // On mount we seed its initial areaId/lng/lat/areaLabel from
      // the existing user record.
      area: {
        areaId: user.areaId || null,
        lng: Array.isArray(coords) ? coords[0] : null,
        lat: Array.isArray(coords) ? coords[1] : null,
        areaLabel: null, // selector re-derives the chain itself
      },
    });
  }, [user, reset]);

  // ── Location display/edit toggle ───────────────────────────────────────
  // After the first successful save, the page shows the location as a
  // read-only summary (AreaSelector with `displayMode === true`). The
  // user clicks "Edit location" to flip to the interactive picker.
  // If the user has never saved a location, we start in EDIT mode
  // immediately — there's nothing to display yet, so the picker is
  // always visible.
  //
  // `savedLocation` is a stable snapshot of what the server currently
  // has for this user; it powers the read-only summary and is the
  // rollback target when the user clicks "Cancel" mid-edit.
  const savedLocation = useMemo(() => {
    if (!user) return null;
    const coords = user.location && user.location.coordinates;
    const lng = Array.isArray(coords) ? coords[0] : null;
    const lat = Array.isArray(coords) ? coords[1] : null;
    const hasArea = Boolean(user.areaId);
    const hasPoint = lng != null && lat != null;
    if (!hasArea && !hasPoint) return null;
    return {
      areaId: user.areaId || null,
      lng,
      lat,
      // The chain label isn't persisted server-side — the read-only
      // summary just receives the leaf id + a label derived from it.
      // When the user enters edit mode, the dropdowns walk the chain
      // forward from this id so the prior selections are restored.
      areaLabel: null,
    };
  }, [user]);

  const [locationEditing, setLocationEditing] = useState(
    // Initial value: edit mode iff nothing to display.
    () => true // will be replaced as soon as user hydrates below
  );

  // Once `user` arrives (initial AuthContext hydration), decide the
  // initial mode based on whether saved location data exists.
  useEffect(() => {
    if (!user) return;
    setLocationEditing(!savedLocation);
    // We intentionally only depend on `user` (not `savedLocation`) —
    // `savedLocation` is itself derived from `user` and using both
    // would loop. The flip only matters on the first hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function locationSeedFromSaved() {
    if (!savedLocation) {
      return { areaId: null, lng: null, lat: null, areaLabel: null };
    }
    return {
      areaId: savedLocation.areaId,
      lng: savedLocation.lng,
      lat: savedLocation.lat,
      areaLabel: null,
    };
  }

  function onStartEditLocation() {
    // Re-seed the form's `area` field with the saved snapshot so the
    // picker opens with the prior selection prefilled. We do NOT touch
    // name/email/phone — the user might already be mid-edit on those
    // fields when they click "Edit location" on the fieldset.
    setValue('area', locationSeedFromSaved(), {
      shouldDirty: false, // don't mark the form dirty just from opening
    });
    setLocationEditing(true);
  }

  function onCancelEditLocation() {
    // Revert ONLY the `area` field to the last saved snapshot — leave
    // name/email/phone alone, the user might be editing those in
    // parallel and we shouldn't blow them away.
    setValue('area', locationSeedFromSaved(), { shouldDirty: false });
    setLocationEditing(false);
  }

  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(values) {
    setServerError(null);
    const payload = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: values.phone.trim(),
    };

    // AreaSelector emits {areaId, lng, lat, areaLabel}. Translate it
    // into the server-expected shapes (areaId + GeoJSON Point).
    const sel = values.area || {};
    if (sel.areaId) {
      payload.areaId = sel.areaId;
    }
    if (sel.lng != null && sel.lat != null) {
      payload.location = { type: 'Point', coordinates: [sel.lng, sel.lat] };
    }

    setSaving(true);
    try {
      await api.patch('/users/me', payload);
      await refreshUser();
      toast.success('Profile saved');
      reset({ ...values });
      // Mark the form as pristine so the Save button disables again.
      // Return to read-only location display (if there was one to show).
      // The useEffect that watches `user` will pick up the new areaId/
      // location and recompute `savedLocation` accordingly.
      setLocationEditing(false);
    } catch (err) {
      const { topMessage, fieldErrors, status } = extractFormError(err);
      setServerError({ message: topMessage, status });
      for (const [field, msg] of Object.entries(fieldErrors)) {
        if (['name', 'email', 'phone'].includes(field)) {
          setError(field, { type: 'server', message: msg });
        }
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Avatar upload form ────────────────────────────────────────────────
  const fileRef = useRef(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarError, setAvatarError] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  function onPickAvatar(e) {
    setAvatarError(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }
    if (!UPLOAD_LIMITS.ACCEPTED_MIME_TYPES.includes(file.type)) {
      setAvatarError(
        `Unsupported image type. Allowed: ${UPLOAD_LIMITS.ACCEPTED_EXTENSIONS}.`
      );
      setAvatarFile(null);
      setAvatarPreview(null);
      // Reset the <input> so the user can pick again.
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > UPLOAD_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024) {
      setAvatarError(
        `Avatar must be under ${UPLOAD_LIMITS.MAX_FILE_SIZE_MB} MB.`
      );
      setAvatarFile(null);
      setAvatarPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setAvatarFile(file);
    // Build a data: URL preview so the user sees what they picked.
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function onUploadAvatar() {
    if (!avatarFile) return;
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('avatar', avatarFile);
      // axios sets the multipart boundary header itself — do NOT set
      // Content-Type manually or the boundary is lost.
      await api.post('/users/me/avatar', form);
      await refreshUser();
      toast.success('Avatar updated');
      setAvatarFile(null);
      setAvatarPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      const { topMessage, status } = extractFormError(err);
      if (status === 503) {
        setAvatarError(
          topMessage ||
            'Avatar upload is not configured on this server. Contact an admin.'
        );
      } else {
        setAvatarError(topMessage);
      }
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (!user) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <AvatarPreview
            src={avatarPreview || user.avatarUrl || null}
            name={user.name || user.email || '?'}
          />
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-slate-900">
              {user.name || 'Unnamed user'}
              {user.role === 'VOLUNTEER' && user.isVerified && (
                <span
                  title="Verified volunteer"
                  aria-label="Verified volunteer"
                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-safe-100 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-safe-800"
                >
                  <span aria-hidden>✓</span> Verified
                </span>
              )}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <RoleBadge role={user.role} />
              <span aria-hidden>·</span>
              <span className="truncate">{user.email}</span>
            </div>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Meta label="Joined" value={formatDate(user.createdAt)} />
          <Meta label="Last login" value={formatRelative(user.lastLoginAt)} />
          {user.role === 'VOLUNTEER' ? (
            <Meta
              label="Verification"
              value={
                user.isVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-safe-100 px-2 py-0.5 text-xs font-semibold text-safe-800">
                    <span aria-hidden>✓</span> Verified by moderator
                  </span>
                ) : (
                  <span className="text-slate-500">Not yet verified</span>
                )
              }
            />
          ) : (
            <Meta
              label="Verified"
              value={
                user.isVerified
                  ? 'Yes'
                  : user.role === 'ADMIN' || user.role === 'MODERATOR'
                    ? 'Privileged (verified by definition)'
                    : 'No'
              }
            />
          )}
        </dl>
      </header>

      {/* ── Editable profile ───────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Profile</h2>
        <p className="mt-1 text-sm text-slate-600">
          Update your name, contact information, and location.
        </p>

        {serverError && (
          <div
            role="alert"
            className={
              'mt-4 rounded-md border p-3 text-sm ' +
              (serverError.status === 409
                ? 'border-caution-300 bg-caution-50 text-caution-800'
                : 'border-alert-200 bg-alert-50 text-alert-800')
            }
          >
            {serverError.message}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
          <Field label="Full name" htmlFor="name" error={errors.name?.message}>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
              aria-invalid={Boolean(errors.name)}
              className={inputClass(Boolean(errors.name))}
              {...register('name', {
                required: 'Name is required',
                minLength: { value: 2, message: 'Name must be at least 2 characters' },
                maxLength: { value: 80, message: 'Name is too long' },
              })}
            />
          </Field>

          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              className={inputClass(Boolean(errors.email))}
              {...register('email', {
                required: 'Email is required',
                pattern: { value: EMAIL_REGEX, message: 'Enter a valid email address' },
              })}
            />
          </Field>

          <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+880 1XXXXXXXXX"
              aria-invalid={Boolean(errors.phone)}
              className={inputClass(Boolean(errors.phone))}
              {...register('phone', {
                required: 'Phone is required',
                pattern: {
                  value: PHONE_REGEX,
                  message: 'Enter a valid phone (digits, +, spaces, hyphens; 7–20 chars)',
                },
              })}
            />
          </Field>

          <fieldset>
            <div className="flex items-center justify-between gap-2">
              <legend className="block text-sm font-medium text-slate-700">
                Location
              </legend>
              {savedLocation && !locationEditing && (
                <button
                  type="button"
                  onClick={onStartEditLocation}
                  disabled={saving}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Edit location
                </button>
              )}
              {savedLocation && locationEditing && (
                <button
                  type="button"
                  onClick={onCancelEditLocation}
                  disabled={saving}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {locationEditing
                ? 'Pick where you live — by district hierarchy, by address search, or by dropping a pin on the map. All three are optional.'
                : 'Your saved location. Click Edit to change it.'}
            </p>
            <div className="mt-2">
              {locationEditing ? (
                <Controller
                  control={control}
                  name="area"
                  render={({ field }) => (
                    <AreaSelector
                      initialAreaId={field.value?.areaId || null}
                      initialLng={field.value?.lng ?? null}
                      initialLat={field.value?.lat ?? null}
                      initialAreaLabel={field.value?.areaLabel || null}
                      onChange={(next) => field.onChange(next)}
                      disabled={saving}
                    />
                  )}
                />
              ) : (
                <AreaSelector
                  initialAreaId={savedLocation?.areaId ?? null}
                  initialLng={savedLocation?.lng ?? null}
                  initialLat={savedLocation?.lat ?? null}
                  initialAreaLabel={savedLocation?.areaLabel ?? null}
                  displayMode
                  onChange={() => {
                    /* read-only — parent owns the toggle */
                  }}
                />
              )}
            </div>
          </fieldset>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="rounded-md bg-alert-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => reset()}
              className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      {/* ── Avatar upload ──────────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Avatar</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a profile picture. Image files only, up to{' '}
          {UPLOAD_LIMITS.MAX_FILE_SIZE_MB} MB.
        </p>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <AvatarPreview
            src={avatarPreview || user.avatarUrl || null}
            name={user.name || user.email || '?'}
            size="lg"
          />
          <div className="flex-1 min-w-[12rem]">
            <input
              ref={fileRef}
              id="avatar"
              type="file"
              accept={UPLOAD_LIMITS.ACCEPTED_EXTENSIONS}
              onChange={onPickAvatar}
              className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {avatarError && (
              <p role="alert" className="mt-2 text-sm text-alert-700">
                {avatarError}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onUploadAvatar}
                disabled={!avatarFile || uploadingAvatar}
                className="rounded-md bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
              >
                {uploadingAvatar ? 'Uploading…' : 'Upload avatar'}
              </button>
              {avatarFile && !uploadingAvatar && (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarFile(null);
                    setAvatarPreview(null);
                    setAvatarError(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className="rounded-md border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 min-h-[44px]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Helpers / sub-components ────────────────────────────────────────────────

function blankDefaults() {
  return {
    name: '',
    email: '',
    phone: '',
    area: { areaId: null, lng: null, lat: null, areaLabel: null },
  };
}

function AvatarPreview({ src, name, size = 'md' }) {
  const dim = size === 'lg' ? 'h-20 w-20 text-xl' : 'h-14 w-14 text-base';
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('') || '?';
  return (
    <div
      className={
        dim +
        ' flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-600 ring-2 ring-white'
      }
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-slate-900">{value}</dd>
    </div>
  );
}

function Field({ label, htmlFor, error, hint, inline, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className={
          (inline ? 'sr-only' : 'block') + ' text-sm font-medium text-slate-700'
        }
      >
        {label}
      </label>
      <div className={inline ? '' : 'mt-1'}>{children}</div>
      {hint && !error && !inline && (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-alert-700">{error}</p>}
    </div>
  );
}

function inputClass(hasError) {
  return [
    'block w-full rounded-md border bg-white px-3 py-2.5 text-sm shadow-sm min-h-[44px]',
    'placeholder:text-slate-400 focus:outline-none focus:ring-2',
    hasError
      ? 'border-alert-300 focus:border-alert-500 focus:ring-alert-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  ].join(' ');
}