/**
 * ModeratorVolunteersListPage — moderator-side volunteer directory
 * (Module: Volunteers Tab).
 *
 * The mirror of the admin volunteers page on the MODERATOR role.
 * Differences from the admin side:
 *   - The list is auto-scoped to the moderator's `areaId` server-side.
 *     The UI shows the area label as a static header instead of a
 *     picker — moderators cannot broaden their view.
 *   - The only filter chip is the verification status (All / Verified
 *     / Unverified). No area picker.
 *   - Mark-verified action: same `useVerifyVolunteer` mutation the
 *     admin side uses; the endpoint accepts both MODERATOR and ADMIN
 *     tokens so the wiring is identical.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   - The list response uses the server's `publicUserDirectory()`
 *     helper — NEVER includes email / phone / password. This page
 *     does NOT augment that; the only fields rendered are
 *     `{ name, isVerified, isActive, areaId, createdAt }`.
 *   - The page source NEVER reads `volunteer.email` / `volunteer.phone`
 *     — those don't exist on the response shape to begin with, and
 *     the smoke test asserts that statically.
 *
 * Empty-area behaviour:
 *   A moderator without an `areaId` (no admin has assigned them one)
 *   is a real state — the server returns an empty list. The UI shows
 *   an "ask an admin" empty state so the moderator has a path forward
 *   rather than a confusing blank page.
 */

import { useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useAreaChain } from '../../hooks/useAreas';
import { useModeratorVolunteers } from '../../hooks/useModeratorVolunteers';
import { useVerifyVolunteer } from '../../hooks/useVerifyVolunteer';

const VERIFICATION_FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
]);

export default function ModeratorVolunteersListPage() {
  const { user } = useAuth();
  const [verification, setVerification] = useState('all');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // The moderator's assigned area — server enforces this scope on
  // the response so we never pass areaId on the wire.
  const moderatorAreaId = user?.areaId || null;
  const areaChain = useAreaChain({
    areaId: moderatorAreaId,
    enabled: Boolean(moderatorAreaId),
  });
  const areaLabel = formatAreaChain(areaChain.data?.chain);

  const list = useModeratorVolunteers({
    isVerified: verification,
    page,
    limit: LIMIT,
  });
  const volunteers = list.data?.volunteers || [];
  const total = list.data?.pagination?.total || 0;
  const totalPages = list.data?.pagination?.pages || 1;

  return (
    <div className="space-y-4">
      <Header
        moderatorAreaId={moderatorAreaId}
        areaLabel={areaLabel}
        areaIsLoading={areaChain.isLoading && Boolean(moderatorAreaId)}
      />

      {!moderatorAreaId && !list.isLoading && <NoAreaEmptyState />}

      {moderatorAreaId && (
        <>
          <FilterBar
            verification={verification}
            onChange={(next) => {
              setVerification(next);
              setPage(1);
            }}
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
            <EmptyState verification={verification} />
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
        </>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({ moderatorAreaId, areaLabel, areaIsLoading }) {
  let areaNode;
  if (!moderatorAreaId) {
    areaNode = (
      <span className="italic text-slate-500">No area assigned</span>
    );
  } else if (areaIsLoading || !areaLabel) {
    areaNode = <span className="text-slate-500">Loading area…</span>;
  } else {
    areaNode = <span className="font-medium">{areaLabel}</span>;
  }

  return (
    <header className="space-y-1">
      <h1 className="text-xl font-semibold text-slate-900">Volunteers</h1>
      <p className="text-sm text-slate-600">
        Volunteers in your area: {areaNode}. Verify a volunteer to
        unlock their ability to request resources.
      </p>
    </header>
  );
}

// ── Filter chips ──────────────────────────────────────────────────────────

function FilterBar({ verification, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter volunteers by verification"
      className="flex flex-wrap gap-2"
    >
      {VERIFICATION_FILTERS.map((f) => {
        const isActive = verification === f.value;
        return (
          <button
            key={f.value || 'all'}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(f.value)}
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

function EmptyState({ verification }) {
  const filtered = verification !== 'all';
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-base font-medium text-slate-700">
        No volunteers in this area yet
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {filtered
          ? 'No volunteers match the current verification filter.'
          : 'When a volunteer in your area registers, they will appear here.'}
      </p>
    </div>
  );
}

function NoAreaEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-base font-medium text-slate-700">
        You have not been assigned to an area
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Ask an admin to assign you to a district so the volunteer
        directory can show the right list.
      </p>
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

function formatAreaChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  // The chain is root → leaf. We display the path with separators.
  return chain.map((node) => node.name).join(' › ');
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