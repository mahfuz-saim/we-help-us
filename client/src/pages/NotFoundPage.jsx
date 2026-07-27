/**
 * 404 page.
 */

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-alert-700">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">
        The page you&apos;re looking for doesn&apos;t exist or hasn&apos;t been
        implemented yet.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Go home
      </Link>
    </div>
  );
}
