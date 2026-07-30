/**
 * AdminCreateModeratorPage — admin UI for minting a new MODERATOR.
 *
 * Minimum-viable create flow: only the mandatory fields (name, email,
 * phone, password) are required. The role is hardcoded to 'MODERATOR'
 * — admins cannot create other admins from this surface in v1
 * (privileged-user-creation still goes through the same backend
 * endpoint, just not this UI).
 *
 * The new moderator completes areaId, location, and any other
 * profile fields from the existing `/profile` page on first login.
 * The profile page already accepts those PATCH fields via
 * `PATCH /api/users/me` — see `server/controllers/user.controller.js`.
 *
 * Privacy / role gating:
 *   - This page is reachable only by ADMIN. The route gate lives in
 *     App.jsx (`<ProtectedRoute roles={['ADMIN']}>`).
 *   - The submit fires `useCreateAdminModerator`, which calls
 *     `POST /api/admin/create-privileged-user` with role=MODERATOR.
 *     The server enforces 403 for non-admin callers.
 */

import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

import { useCreateAdminModerator } from '../../hooks/useAdminModerators';
import { extractFormError } from '../../utils/formErrors';

const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminCreateModeratorPage() {
  const navigate = useNavigate();
  const create = useCreateAdminModerator();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm({
    mode: 'onTouched',
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
    },
  });

  async function onSubmit(values) {
    const payload = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: values.phone.trim(),
      password: values.password,
    };
    try {
      await create.mutateAsync(payload);
      toast.success('Moderator created');
      navigate('/admin/moderators', { replace: true });
    } catch (err) {
      const { topMessage, fieldErrors } = extractFormError(err);
      // Surface server message as a top-level banner via the mutation
      // error state. Field errors get red-bordered + message below.
      for (const [field, msg] of Object.entries(fieldErrors)) {
        if (['name', 'email', 'phone', 'password'].includes(field)) {
          setError(field, { type: 'server', message: msg });
        }
      }
      // If the server returned a 409 conflict with a `field` hint, the
      // mapping above already covers it; otherwise the top message
      // bubbles up via create.error in the banner below.
      // eslint-disable-next-line no-console
      console.warn('[admin-create-moderator] failed:', topMessage);
    }
  }

  return (
    <div className="space-y-4">
      <Header />

      {create.isError && (
        <div
          role="alert"
          className="rounded-md border border-alert-200 bg-alert-50 p-3 text-sm text-alert-800"
        >
          {(() => {
            const { topMessage } = extractFormError(create.error);
            return topMessage;
          })()}
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <Field
          label="Full name"
          htmlFor="admin-mod-name"
          error={errors.name?.message}
          hint="2–80 characters."
        >
          <input
            id="admin-mod-name"
            type="text"
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            className={inputClass(Boolean(errors.name))}
            {...register('name', {
              required: 'Name is required',
              minLength: { value: 2, message: 'Name must be at least 2 characters' },
              maxLength: { value: 80, message: 'Name must be at most 80 characters' },
            })}
          />
        </Field>

        <Field
          label="Email"
          htmlFor="admin-mod-email"
          error={errors.email?.message}
        >
          <input
            id="admin-mod-email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            className={inputClass(Boolean(errors.email))}
            {...register('email', {
              required: 'Email is required',
              pattern: { value: EMAIL_REGEX, message: 'Enter a valid email address' },
            })}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="admin-mod-phone"
          error={errors.phone?.message}
          hint="Digits, spaces, hyphens, or parentheses. Optional leading +. 7–20 chars."
        >
          <input
            id="admin-mod-phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            className={inputClass(Boolean(errors.phone))}
            {...register('phone', {
              required: 'Phone is required',
              pattern: { value: PHONE_REGEX, message: 'Enter a valid phone number' },
            })}
          />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="admin-mod-password"
          error={errors.password?.message}
          hint="At least 8 characters. The moderator can change it from their profile after login."
        >
          <input
            id="admin-mod-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            className={inputClass(Boolean(errors.password))}
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 8, message: 'Password must be at least 8 characters' },
            })}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <p className="text-xs text-slate-500">
            After creation, the moderator logs in with these credentials and
            completes their area, location, and contact info from the profile
            page.
          </p>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/moderators"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {create.isPending ? 'Creating…' : 'Create moderator'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-xl font-semibold text-slate-900">
        Create moderator
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Mint a new moderator account. Only the mandatory fields are
        collected here — the moderator finishes their profile (area,
        location, etc.) from the profile page after first login.
      </p>
    </header>
  );
}

function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-alert-700">
          {error}
        </p>
      )}
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