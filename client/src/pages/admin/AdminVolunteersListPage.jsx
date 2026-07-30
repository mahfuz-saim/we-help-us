/**
 * AdminVolunteersListPage — admin-side volunteer directory
 * (Module: Volunteers Tab).
 *
 * The admin panel's view of the volunteer directory. Compared to
 * the moderator page:
 *   - Admin is global (no area scoping server-side), so the page
 *     exposes the same AreaCascadeFilter SearchPage uses so an admin
 *     can narrow by area (any level: district / upazila / union /
 *     ward / village). The selected id is forwarded to the API as
 *     `?areaId=`.
 *   - Verification chip filter is the same All / Verified / Unverified
 *     set.
 *   - "Mark verified" action reuses `useVerifyVolunteer` — the route
 *     permits ADMIN tokens.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The list response is the server's `publicUserDirectory()`
 *     helper — NEVER includes email, phone, or password. The page
 *     renders only `{ name, isVerified, isActive, areaId, createdAt }`.
 *   - The page source NEVER reads `volunteer.email` / `volunteer.phone`
 *     (those fields are absent from the response shape; the smoke
 *     test asserts the source doesn't try to access them).
 *
 * Default behaviour:
 *   - areaId === null → "all areas" (default).
 *   - isVerified === 'all' (default).
 *   - The "Clear filters" button resets both.
 */

import { useState } from 'react';

import AreaCascadeFilter from '../../components/AreaCascadeFilter';
import { useAdminVolunteers } from '../../hooks/useAdminVolunteers';
import { useAreaChain } from '../../hooks/useAreas';
import { useVerifyVolunteer } from '../../hooks/useVerifyVolunteer';

const VERIFICATION_FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
]);

export default function AdminVolunteersListPage() {
  const [areaId, setAreaId] = useState(null);
  const [verification, setVerification] = useState('all');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const list = useAdminVolunteers({
    areaId,
    isVerified: verification,
    page,
    limit: LIMIT,
  });
  const volunteers = list.data?.volunteers || [];
  const total = list.data?.pagination?.total || 0;
  const totalPages = list.data?.pagination?.pages || 1;

  function clearFilters() {
    setAreaId(null);
    setVerification('all');
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <Header />

      <Filters
        areaId={areaId}
        onAreaChange={(next) => {
          setAreaId(next);
          setPage(1);
        }}
        verification={verification}
        onVerificationChange={(next) => {
          setVerification(next);
          setPage(1);
        }}
        onClear={clearFilters}
        hasActiveFilter={Boolean(areaId) || verification !== 'all'}
      />

      {list.isLoading && <LoadingState />}
      {list.isError && (
        <ErrorBanner
          message={
            list.error?.response?.data?.message ||
            list.error?.message ||
            'Failed to load volunteers.'
          }
        />
      )}
      {!list.isLoading && !list.isError && volunteers.length === 0 && (
        <EmptyState
          areaId={areaId}
          verification={verification}
          onClear={clearFilters}
        />
      )}
      {!list.isLoading && !list.isError && volunteers.length > 0 && (
        <VolunteerTable
          volunteers={volunteers}
          total={total}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          limit={LIMIT}
        />
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="space-y-1">
      <h1 className="text-xl font-semibold text-slate-900">Volunteers</h1>
      <p className="text-sm text-slate-600">
        Every volunteer account on the platform. Filter by area and
        verification status. Mark a volunteer as verified to unlock
        their ability to request resources.
      </p>
    </header>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────

function Filters({
  areaId,
  onAreaChange,
  verification,
  onVerificationChange,
  onClear,
  hasActiveFilter,
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div
        role="radiogroup"
        aria-label="Filter volunteers by verification"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Verification
        </span>
        {VERIFICATION_FILTERS.map((f) => {
          const isActive = verification === f.value;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onVerificationChange(f.value)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium ' +
                (isActive
                  ? 'border-alert-700 bg-alert-700 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400')
              }
            >
              {f.label}
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasActiveFilter}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear filters
          </button>
        </div>
      </div>

      <details
        className="rounded-md border border-slate-200 bg-slate-50 p-3"
        open={Boolean(areaId)}
      >
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <span>Area</span>
          {areaId && (
            <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
              Selected
            </span>
          )}
        </summary>
        <div className="mt-3">
          <AreaCascadeFilter value={areaId} onChange={onAreaChange} />
        </div>
      </details>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────

function VolunteerTable({
  volunteers,
  total,
  page,
  totalPages,
  onPageChange,
  limit,
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-medium text-slate-700">
          {total} {total === 1 ? 'volunteer' : 'volunteers'}
        </p>
        <p className="text-xs text-slate-500">
          Page {page} of {totalPages}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Area
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Verified
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Active
              </th>
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Joined
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {volunteers.map((v) => (
              <VolunteerRow key={v.id} volunteer={v} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        limit={limit}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function VolunteerRow({ volunteer }) {
  const verify = useVerifyVolunteer();
  const isVerified = volunteer.isVerified === true;
  const isPending =
    verify.isPending && verify.variables?.userId === volunteer.id;

  function handleVerify() {
    verify.mutate({ userId: volunteer.id });
  }

  return (
    <tr className="text-slate-700">
      <td className="px-4 py-3 font-medium text-slate-900">
        {volunteer.name || '—'}
      </td>
      <td className="px-4 py-3">
        <AreaCell areaId={volunteer.areaId} />
      </td>
      <td className="px-4 py-3">
        <Pill ok={isVerified} label={isVerified ? 'Verified' : 'Unverified'} />
      </td>
      <td className="px-4 py-3">
        <Pill
          ok={volunteer.isActive !== false}
          label={volunteer.isActive !== false ? 'Active' : 'Disabled'}
        />
      </td>
      <td className="px-4 py-3 text-slate-500">
        {formatDate(volunteer.createdAt)}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={handleVerify}
          disabled={isVerified || isPending}
          className="rounded-md bg-alert-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-alert-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Marking…' : isVerified ? 'Verified' : 'Mark verified'}
        </button>
        {verify.isError &&
          verify.variables?.userId === volunteer.id && (
            <p className="mt-1 text-[11px] text-alert-700">
              {verify.error?.response?.data?.message ||
                verify.error?.message ||
                'Could not verify this volunteer.'}
            </p>
          )}
      </td>
    </tr>
  );
}

function AreaCell({ areaId }) {
  // The admin directory rows can come from any area — resolve the
  // chain so the cell shows a meaningful label instead of a hex id.
  const chain = useAreaChain({
    areaId,
    enabled: Boolean(areaId),
  });
  if (!areaId) {
    return <span className="italic text-slate-400">Not assigned</span>;
  }
  if (chain.isLoading || !chain.data?.chain) {
    return <span className="text-slate-400">…</span>;
  }
  const names = chain.data.chain
    .map((n) => n.name)
    .filter(Boolean)
    .join(' › ');
  return (
    <span className="text-slate-700">
      {names || <span className="font-mono text-xs">{areaId.slice(0, 8)}…</span>}
    </span>
  );
}

function Pagination({ page, totalPages, limit, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      <span>{limit} per page</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md bg-slate-100"
          aria-hidden
        />
      ))}
      <span className="sr-only">Loading volunteers…</span>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-alert-200 bg-alert-50 p-3 text-sm text-alert-800"
    >
      {message}
    </div>
  );
}

function EmptyState({ areaId, verification, onClear }) {
  const filtered = Boolean(areaId) || verification !== 'all';
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-base font-medium text-slate-700">
        No volunteers match your filters
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {filtered
          ? 'Try a different area or verification status.'
          : 'When a volunteer registers, they will appear here.'}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 inline-block rounded-md bg-alert-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-alert-800"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function Pill({ ok, label }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
        (ok
          ? 'bg-safe-100 text-safe-700'
          : 'bg-slate-100 text-slate-600')
      }
    >
      {label}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}