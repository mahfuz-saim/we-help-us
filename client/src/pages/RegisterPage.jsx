/**
 * RegisterPage — placeholder.
 *
 * NOTE: per the project's KEY DESIGN REMINDERS, public registration
 * is OWNER/VOLUNTEER only. Moderator and admin accounts must be created
 * via the protected admin route (Module 1.2) or a seed script. The
 * final form in Module 1.3 will limit the role select accordingly.
 *
 * We surface this rule on the skeleton page so future contributors
 * don't accidentally widen the form.
 */

import { Link } from 'react-router-dom';
import { PUBLIC_REGISTRATION_ROLES } from '../utils/constants';

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Create an account</h1>
        <p className="mt-1 text-sm text-slate-600">
          The registration form will land in <strong>Module 1.3</strong>. The
          role selector will be limited to:
        </p>

        <ul className="mt-3 list-inside list-disc text-sm text-slate-700">
          {PUBLIC_REGISTRATION_ROLES.map((r) => (
            <li key={r}>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {r}
              </code>{' '}
              — {r === 'OWNER' ? 'lists resources you can share' : 'requests resources on behalf of the community'}
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-md border border-caution-300 bg-caution-50 p-3 text-sm text-caution-800">
          <strong>Why no Moderator/Admin sign-up?</strong> Privileged
          accounts are created only via an authenticated admin endpoint
          or a seed script — they can never be self-registered.
        </div>

        <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Form coming soon
        </div>

        <p className="mt-4 text-sm text-slate-600">
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
