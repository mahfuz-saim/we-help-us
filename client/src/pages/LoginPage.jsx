/**
 * LoginPage — placeholder. The real form is wired in Module 1.3.
 */

import { Link } from 'react-router-dom';

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Log in</h1>
        <p className="mt-1 text-sm text-slate-600">
          The login form will land in <strong>Module 1.3</strong> (Auth
          Frontend Pages). This route is reserved so the layout, route
          guard, and auth context can be exercised.
        </p>

        <div className="mt-6 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
          Form coming soon
        </div>

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
