/**
 * ProfilePage — self-service profile (Module 1.4).
 *
 * Two visual sections:
 *   1. Account info (read-only) — avatar, name, role badge, joined date,
 *      last login. Hydrated from AuthContext on mount.
 *   2. Editable info — a react-hook-form with name, email, phone,
 *      and basic location (two number inputs for [lng, lat]).
 *      Submitting calls PATCH /api/users/me and refreshes the
 *      AuthContext user.
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
 */

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import RoleBadge from '../components/RoleBadge';
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
    handleSubmit,
    reset,
    setError,
    watch,
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
      lng: Array.isArray(coords) ? coords[0] : '',
      lat: Array.isArray(coords) ? coords[1] : '',
    });
  }, [user, reset]);

  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(values) {
    setServerError(null);
    const payload = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: values.phone.trim(),
    };
    const lng = parseFloatOrNull(values.lng);
    const lat = parseFloatOrNull(values.lat);
    if (lng !== null || lat !== null) {
      // Either both must be present or neither (so the controller
      // doesn't persist a half-formed Point). If only one is filled,
      // surface a client-side error.
      if (lng === null || lat === null) {
        setError('lng', { type: 'manual', message: 'Both lng and lat are required.' });
        return;
      }
      payload.location = { type: 'Point', coordinates: [lng, lat] };
    }

    setSaving(true);
    try {
      await api.patch('/users/me', payload);
      await refreshUser();
      toast.success('Profile saved');
      reset({ ...values });
      // Mark the form as pristine so the Save button disables again.
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

  const watchLng = watch('lng');
  const watchLat = watch('lat');

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
          <Meta label="Verified" value={user.isVerified ? 'Yes' : 'No'} />
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
            <legend className="block text-sm font-medium text-slate-700">
              Location (optional)
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              Longitude and latitude (e.g. <code>90.41</code>, <code>23.79</code> for
              Dhaka). The interactive area selector lands in Module 2.2.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field
                label="Longitude"
                htmlFor="lng"
                error={errors.lng?.message}
                inline
              >
                <input
                  id="lng"
                  type="number"
                  step="any"
                  placeholder="-180 to 180"
                  aria-invalid={Boolean(errors.lng)}
                  className={inputClass(Boolean(errors.lng))}
                  {...register('lng', {
                    validate: (val) => {
                      if (val === '' || val === undefined) return true;
                      const n = Number(val);
                      if (!Number.isFinite(n)) return 'Must be a number';
                      if (n < -180 || n > 180) return 'Must be between -180 and 180';
                      return true;
                    },
                  })}
                />
              </Field>
              <Field
                label="Latitude"
                htmlFor="lat"
                error={errors.lat?.message}
                inline
              >
                <input
                  id="lat"
                  type="number"
                  step="any"
                  placeholder="-90 to 90"
                  aria-invalid={Boolean(errors.lat)}
                  className={inputClass(Boolean(errors.lat))}
                  {...register('lat', {
                    validate: (val) => {
                      if (val === '' || val === undefined) return true;
                      const n = Number(val);
                      if (!Number.isFinite(n)) return 'Must be a number';
                      if (n < -90 || n > 90) return 'Must be between -90 and 90';
                      return true;
                    },
                  })}
                />
              </Field>
            </div>
            {(watchLng || watchLat) && lngLatMismatch(watchLng, watchLat) && (
              <p className="mt-1 text-xs text-alert-700">
                Both longitude and latitude must be filled, or leave both blank.
              </p>
            )}
          </fieldset>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              disabled={saving || !isDirty}
              onClick={() => reset()}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
  return { name: '', email: '', phone: '', lng: '', lat: '' };
}

function parseFloatOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lngLatMismatch(lng, lat) {
  const one = lng !== '' && lng !== undefined;
  const other = lat !== '' && lat !== undefined;
  return one !== other;
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
    'block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm',
    'placeholder:text-slate-400 focus:outline-none focus:ring-2',
    hasError
      ? 'border-alert-300 focus:border-alert-500 focus:ring-alert-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  ].join(' ');
}