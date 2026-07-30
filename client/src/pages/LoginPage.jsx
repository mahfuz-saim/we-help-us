/**
 * LoginPage — real form (Module 1.3).
 *
 * Accepts either an email or a phone number as the identifier. The server's
 * login validator (server/validators/auth.validators.js) accepts both, and
 * AuthContext's `login()` passes whichever we set.
 *
 * UX:
 *   - Single identifier field with a small toggle (Email / Phone).
 *     Switching the toggle re-labels the placeholder and the validator.
 *   - Password field with show/hide toggle (eye icon is a unicode glyph —
 *     keeps the bundle dependency-free).
 *   - On success: redirect to the path the user originally tried to reach
 *     (passed via `state.from` by ProtectedRoute) or `/`.
 *   - Errors are surfaced inline above the form. We deliberately do NOT
 *     toast on auth errors — a toast is easy to miss on a form page.
 *
 * KEY DESIGN REMINDERS honored:
 *   - Role-based access: this page is reachable by anyone (public).
 *   - "Invalid credentials" message is generic so we don't leak whether
 *     the email/phone exists.
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';

import { useAuth } from '../context/AuthContext';
import { extractFormError } from '../utils/formErrors';

const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // Role-aware default landing page. Preserved across the gated-redirect
  // behavior below: if the user came here from a protected route
  // (`state.from`), we honor that — role default only applies when
  // they opened the login page directly.
  function defaultPathForRole(role) {
    if (role === 'OWNER') return '/owner/resources';
    if (role === 'VOLUNTEER') return '/volunteer/requests';
    if (role === 'MODERATOR' || role === 'ADMIN') return '/moderator';
    return '/';
  }

  const [identifierKind, setIdentifierKind] = useState('email'); // 'email' | 'phone'
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    reset,
    watch,
  } = useForm({ mode: 'onTouched', defaultValues: { identifier: '', password: '' } });

  const fromState = (location.state && location.state.from) || null;

  function switchKind(next) {
    if (next === identifierKind) return;
    setIdentifierKind(next);
    setServerError(null);
    // Clear any client-side error on the field when switching kinds.
    reset({ identifier: '', password: watch('password') || '' }, { keepValues: false });
    setError('identifier', { type: 'manual', message: '' });
  }

  async function onSubmit(values) {
    setServerError(null);
    const identifier = values.identifier.trim();
    const payload =
      identifierKind === 'email'
        ? { email: identifier.toLowerCase(), password: values.password }
        : { phone: identifier, password: values.password };

    setSubmitting(true);
    try {
      const loggedInUser = await login(payload);
      // Resolve landing path: if the user was bounced here from a
      // protected route (`state.from`), honor that. Otherwise route to
      // a role-aware default so each persona lands on its dashboard.
      const redirectTo = fromState || defaultPathForRole(loggedInUser?.role);
      toast.success('Welcome back');
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const { topMessage, fieldErrors, status } = extractFormError(err);
      setServerError({ message: topMessage, status });
      // Map any field-level server errors onto the form so the matching
      // input can highlight. We only have one identifier field here, but
      // the helper handles 'email'/'phone' generically.
      for (const [field, msg] of Object.entries(fieldErrors)) {
        // Server may report either "email" or "phone" — the user-visible
        // field is named "identifier", so map both onto it.
        if (field === 'email' || field === 'phone' || field === 'identifier') {
          setError('identifier', { type: 'server', message: msg });
        } else if (field === 'password') {
          setError('password', { type: 'server', message: msg });
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const identifierLabel = identifierKind === 'email' ? 'Email' : 'Phone';
  const identifierPlaceholder =
    identifierKind === 'email' ? 'you@example.com' : '+880 1XXXXXXXXX';

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Log in</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in to manage your resources and requests.
        </p>

        {/* Identifier kind toggle */}
        <div className="mt-4 inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-sm">
          {['email', 'phone'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className={
                'rounded-md px-3 py-2.5 font-medium transition min-h-[44px] ' +
                (identifierKind === k
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700')
              }
              aria-pressed={identifierKind === k}
            >
              {k === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>

        {serverError && (
          <div
            role="alert"
            className={
              'mt-4 rounded-md border p-3 text-sm ' +
              (serverError.status === 403
                ? 'border-caution-300 bg-caution-50 text-caution-800'
                : 'border-alert-200 bg-alert-50 text-alert-800')
            }
          >
            {serverError.message}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 space-y-4">
          <Field
            label={identifierLabel}
            htmlFor="identifier"
            error={errors.identifier?.message}
          >
            <input
              id="identifier"
              type={identifierKind === 'email' ? 'email' : 'tel'}
              inputMode={identifierKind === 'email' ? 'email' : 'tel'}
              autoComplete={identifierKind === 'email' ? 'email' : 'tel'}
              placeholder={identifierPlaceholder}
              aria-invalid={Boolean(errors.identifier)}
              className={inputClass(Boolean(errors.identifier))}
              {...register('identifier', {
                required: `${identifierLabel} is required`,
                validate: (val) => {
                  const v = (val || '').trim();
                  if (!v) return `${identifierLabel} is required`;
                  if (identifierKind === 'email') {
                    return (
                      EMAIL_REGEX.test(v) || 'Enter a valid email address'
                    );
                  }
                  return (
                    PHONE_REGEX.test(v) ||
                    'Enter a valid phone (digits, +, spaces, hyphens; 7–20 chars)'
                  );
                },
              })}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            error={errors.password?.message}
          >
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={Boolean(errors.password)}
                className={inputClass(Boolean(errors.password)) + ' pr-16'}
                {...register('password', {
                  required: 'Password is required',
                  minLength: { value: 1, message: 'Password is required' },
                })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-0 flex min-h-[44px] items-center px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-alert-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-600">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="font-medium text-alert-700 hover:text-alert-800"
          >
            Sign up
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

function Field({ label, htmlFor, error, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-alert-700">{error}</p>}
    </div>
  );
}