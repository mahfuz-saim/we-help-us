/**
 * AnalyticsPage — Module 8.2.
 *
 * The MODERATOR + ADMIN analytics dashboard. Five cards:
 *
 *   1. Total-by-category   — donut chart + legend (counts per
 *      category, with zero buckets still rendered for stability).
 *   2. Distribution-by-area — horizontal bar chart of per-area
 *      resource counts, with an optional level filter so the moderator
 *      can drill from DISTRICT down to VILLAGE.
 *   3. Most-used-resources — top-N table sorted by completed request
 *      count.
 *   4. Active-emergency-assets — emergency mode status + count of
 *      resources deployed in those areas + a small sample.
 *   5. Coverage-by-village — horizontal bar chart of resources per
 *      area at the chosen level (default VILLAGE).
 *
 * Every card consumes its own TanStack Query slice. The hooks are
 * read-only — there are no mutations. A "Refresh" CTA re-fetches
 * every slice via `qc.invalidateQueries({ queryKey: [ANALYTICS_QUERY_KEY] })`.
 *
 * Privacy (KEY DESIGN REMINDER):
 *   The 8.1 controller never surfaces email / phone / password. This
 *   page consumes the public roll-up payloads as-is — no /users/:id,
 *   no /auth/me, no contact-detail fetch.
 *
 * Role restriction: the route is gated by `ProtectedRoute
 * roles={['MODERATOR','ADMIN']}` in App.jsx. OWNER + VOLUNTEER can't
 * reach this page even via direct URL — the server returns 403 if
 * they try, but the layout prevents them from navigating here at all.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../context/AuthContext';
import {
  ANALYTICS_QUERY_KEY,
  useActiveEmergencyAssets,
  useCoverageByVillage,
  useDistributionByArea,
  useMostUsedResources,
  useTotalByCategory,
} from '../hooks/useAnalytics';

import CategoryDonut from '../components/analytics/CategoryDonut';
import AreaBreakdownChart from '../components/analytics/AreaBreakdownChart';
import MostUsedTable from '../components/analytics/MostUsedTable';
import EmergencyAssetsCard from '../components/analytics/EmergencyAssetsCard';
import EmergencyMapCard from '../components/emergency/EmergencyMapCard';

const DISTRIBUTION_LEVELS = [
  { value: '',          label: 'No roll-up' },
  { value: 'DISTRICT',  label: 'District' },
  { value: 'UPAZILA',   label: 'Upazila' },
  { value: 'UNION',     label: 'Union' },
  { value: 'WARD',      label: 'Ward' },
  { value: 'VILLAGE',   label: 'Village' },
];

const COVERAGE_LEVELS = [
  { value: 'VILLAGE',   label: 'Village' },
  { value: 'WARD',      label: 'Ward' },
  { value: 'UNION',     label: 'Union' },
  { value: 'UPAZILA',   label: 'Upazila' },
  { value: 'DISTRICT',  label: 'District' },
];

const MOST_USED_LIMITS = [5, 10, 25, 50];

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [distributionLevel, setDistributionLevel] = useState('');
  const [coverageLevel, setCoverageLevel] = useState('VILLAGE');
  const [mostUsedLimit, setMostUsedLimit] = useState(10);

  const enabled = Boolean(user);
  const totalByCategory = useTotalByCategory({ enabled });
  const distribution = useDistributionByArea({
    level: distributionLevel || undefined,
    enabled,
  });
  const mostUsed = useMostUsedResources({ limit: mostUsedLimit, enabled });
  const emergency = useActiveEmergencyAssets({ enabled });
  const coverage = useCoverageByVillage({ level: coverageLevel, enabled });

  const qc = useQueryClient();
  const isAnyLoading =
    totalByCategory.isLoading ||
    distribution.isLoading ||
    mostUsed.isLoading ||
    emergency.isLoading ||
    coverage.isLoading;
  const firstError =
    totalByCategory.error ||
    distribution.error ||
    mostUsed.error ||
    emergency.error ||
    coverage.error;

  function onRefresh() {
    qc.invalidateQueries({ queryKey: [ANALYTICS_QUERY_KEY] });
  }

  function exportCsv() {
    const lines = [];
    lines.push('# Analytics snapshot');
    lines.push(`# generated: ${new Date().toISOString()}`);
    lines.push(`# user: ${user?.email || user?.id || 'unknown'} (${user?.role || 'n/a'})`);
    lines.push('');
    lines.push('## Total by category');
    lines.push('category,count');
    for (const b of totalByCategory.data?.byCategory || []) {
      lines.push(`${b.category},${b.count}`);
    }
    lines.push('');
    lines.push(`## Distribution by area${distributionLevel ? ' (' + distributionLevel + ')' : ''}`);
    lines.push('areaId,name,level,count');
    for (const a of distribution.data?.byArea || []) {
      lines.push(`${a.areaId},${csvEscape(a.name)},${a.level},${a.count}`);
    }
    lines.push('');
    lines.push(`## Coverage by area (${coverage.data?.level || coverageLevel})`);
    lines.push('areaId,name,level,count');
    for (const a of coverage.data?.byArea || []) {
      lines.push(`${a.areaId},${csvEscape(a.name)},${a.level},${a.count}`);
    }
    lines.push('');
    lines.push('## Most-used resources');
    lines.push('resourceId,title,category,status,requestCount,completedCount');
    for (const r of mostUsed.data?.items || []) {
      lines.push(
        [
          r.resourceId,
          csvEscape(r.resource?.title || ''),
          r.resource?.category || '',
          r.resource?.status || '',
          r.requestCount,
          r.completedCount,
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n') + '\n'], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Header
        user={user}
        loading={isAnyLoading}
        onRefresh={onRefresh}
        onExport={exportCsv}
        emergencyActive={Boolean(
          emergency.data && emergency.data.emergencyModeAreas?.length > 0
        )}
      />

      {firstError && (
        <div
          role="alert"
          className="rounded-md border border-alert-200 bg-alert-50 p-3 text-sm text-alert-800"
        >
          Could not load analytics: {firstError.message || 'Unknown error'}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card
          title="Resources by category"
          subtitle="Counts of resources grouped by category."
        >
          <CategoryDonut
            data={totalByCategory.data?.byCategory || []}
            total={totalByCategory.data?.total || 0}
          />
        </Card>

        <Card
          title="Emergency mode"
          subtitle="Active emergency areas + resources deployed in them."
        >
          <EmergencyAssetsCard data={emergency.data || null} />
        </Card>

        <Card
          title="Coverage by area"
          subtitle={
            coverage.data?.level
              ? `Per-area count at the ${coverage.data.level} level.`
              : 'Per-area count of resources.'
          }
          right={
            <select
              value={coverageLevel}
              onChange={(e) => setCoverageLevel(e.target.value)}
              aria-label="Coverage level"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {COVERAGE_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          }
        >
          <AreaBreakdownChart
            data={coverage.data?.byArea || []}
            total={coverage.data?.total || 0}
            emptyLabel="No resources are attached to any area yet."
            testId="whu-coverage-chart"
          />
        </Card>

        <Card
          title="Distribution by area"
          subtitle="Where resources are registered across the area scope."
          right={
            <select
              value={distributionLevel}
              onChange={(e) => setDistributionLevel(e.target.value)}
              aria-label="Distribution level"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {DISTRIBUTION_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          }
        >
          <AreaBreakdownChart
            data={distribution.data?.byArea || []}
            total={distribution.data?.total || 0}
            emptyLabel="No areas have resources yet."
            testId="whu-distribution-chart"
          />
        </Card>

        <Card
          title="Most-used resources"
          subtitle="Top resources by completed request count."
          right={
            <select
              value={mostUsedLimit}
              onChange={(e) => setMostUsedLimit(Number(e.target.value))}
              aria-label="Most-used limit"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {MOST_USED_LIMITS.map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          }
        >
          <MostUsedTable
            items={mostUsed.data?.items || []}
            total={mostUsed.data?.total || 0}
          />
        </Card>

        </div>

      <EmergencyMapCard />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function Header({ user, loading, onRefresh, onExport, emergencyActive }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Analytics &amp; reporting
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {user ? (
            <>
              Read-only roll-up of platform activity, scoped to your area.{' '}
              <span className="font-medium">
                {user.role === 'ADMIN' ? 'Admin view (global).' : 'Moderator view.'}
              </span>
            </>
          ) : (
            'Loading…'
          )}
        </p>
        {emergencyActive && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-alert-300 bg-alert-50 px-2 py-1 text-xs font-semibold text-alert-800">
            <span aria-hidden>🚨</span>
            Emergency mode active — counts below reflect deployed resources.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={onExport}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Export CSV
        </button>
      </div>
    </header>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

function Card({ title, subtitle, right, children }) {
  return (
    <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-600">{subtitle}</p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}