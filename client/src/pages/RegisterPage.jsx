/**
 * RegisterPage — real form (Module 1.3).
 *
 * Public registration only. The role selector is data-driven from
 * `PUBLIC_REGISTRATION_ROLES` (client/src/utils/constants.js) so that the
 * list of allowed public roles lives in exactly one place. As of Module
 * 1.3 that list is OWNER and VOLUNTEER — Moderator and Admin can never
 * be self-registered; they must be minted by an authenticated admin via
 * /api/admin/create-privileged-user (Module 1.2).
 *
 * Defense in depth: even if the dropdown were tampered with, the server's
 * zod validator rejects any role outside PUBLIC_REGISTRATION_ROLES,
 * and AuthContext.register() strips any non-public role before posting.
 * The page surfaces no hint that privileged roles exist — users only see
 * the two public sign-up options.
 *
 * KEY DESIGN REMINDERS honored:
 *   - Role escalation: OWNER/VOLUNTEER only, always.
 *   - Role-based access: anyone can reach this page; the role you pick
 *     dictates what you can do elsewhere.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

import { useAuth } from '../context/AuthContext';
import { extractFormError } from '../utils/formErrors';
import {
  PUBLIC_REGISTRATION_ROLES,
  ROLES,
} from '../utils/constants';

const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_COPY = {
  [ROLES.OWNER]: {
    title: 'Resource owner',
    body: 'List resources you can share — vehicles, equipment, space, skills.',
  },
  [ROLES.VOLUNTEER]: {
    title: 'Volunteer',
    body: 'Request resources on behalf of people who need help.',
  },
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser } = useAuth();
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Role-aware landing for new sign-ups. Public registration only
  // accepts OWNER/VOLUNTEER, but the helper still guards other roles
  // so we don't surprise an admin created via the admin create form.
  function defaultPathForRole(role) {
    if (role === 'OWNER') return '/owner/resources';
    if (role === 'VOLUNTEER') return '/volunteer/requests';
    if (role === 'MODERATOR' || role === 'ADMIN') return '/moderator';
    return '/';
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    watch,
  } = useForm({
    mode: 'onTouched',
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      role: PUBLIC_REGISTRATION_ROLES[0], // OWNER
    },
  });

  const selectedRole = watch('role');

  async function onSubmit(values) {
    setServerError(null);
    const payload = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: values.phone.trim(),
      password: values.password,
      role: values.role,
    };

    setSubmitting(true);
    try {
      const created = await registerUser(payload);
      toast.success('Account created — welcome!');
      navigate(defaultPathForRole(created?.role), { replace: true });
    } catch (err) {
      const { topMessage, fieldErrors, status } = extractFormError(err);
      setServerError({ message: topMessage, status });
      for (const [field, msg] of Object.entries(fieldErrors)) {
        // Only map known fields onto the form.
        if (['name', 'email', 'phone', 'password', 'role'].includes(field)) {
          setError(field, { type: 'server', message: msg });
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Create an account</h1>
        <p className="mt-1 text-sm text-slate-600">
          Join We Help Us to share or request community resources.
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

          <Field
            label="Password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 8 characters."
          >
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              aria-invalid={Boolean(errors.password)}
              className={inputClass(Boolean(errors.password))}
              {...register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'Password must be at least 8 characters' },
              })}
            />
          </Field>

          {/* Role selector — RADIO CARDS so each option can carry a one-line
              explanation. Only PUBLIC_REGISTRATION_ROLES are rendered, so
              Moderator/Admin literally cannot appear here. */}
          <fieldset>
            <legend className="block text-sm font-medium text-slate-700">
              I want to join as
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {PUBLIC_REGISTRATION_ROLES.map((role) => {
                const copy = ROLE_COPY[role];
                const checked = selectedRole === role;
                return (
                  <label
                    key={role}
                    className={
                      'flex cursor-pointer flex-col rounded-md border p-3 transition ' +
                      (checked
                        ? 'border-alert-700 bg-alert-50 ring-1 ring-alert-700'
                        : 'border-slate-300 hover:border-slate-400')
                    }
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        value={role}
                        className="h-4 w-4 text-alert-700 focus:ring-alert-500"
                        {...register('role', {
                          required: 'Pick a role',
                          validate: (val) =>
                            PUBLIC_REGISTRATION_ROLES.includes(val) ||
                            'Pick a public role',
                        })}
                      />
                      <span className="text-sm font-semibold text-slate-900">
                        {copy.title}
                      </span>
                    </div>
                    <span className="mt-1 pl-6 text-xs text-slate-600">
                      {copy.body}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.role && (
              <p className="mt-1 text-xs text-alert-700">{errors.role.message}</p>
            )}
          </fieldset>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-alert-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-alert-700 hover:text-alert-800"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────────────────

function inputClass(hasError) {
  return [
    'block w-full rounded-md border bg-white px-3 py-2.5 text-sm shadow-sm min-h-[44px]',
    'placeholder:text-slate-400 focus:outline-none focus:ring-2',
    hasError
      ? 'border-alert-300 focus:border-alert-500 focus:ring-alert-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  ].join(' ');
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
      {error && <p className="mt-1 text-xs text-alert-700">{error}</p>}
    </div>
  );
}