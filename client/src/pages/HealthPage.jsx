/**
 * HealthPage — calls GET /api/health on the backend and renders the
 * response. Helpful as a smoke test for the dev proxy and the wiring
 * between client and server. The full backend health route is implemented
 * in Module 0.2.
 */

import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

async function fetchHealth() {
  const { data } = await api.get('/health');
  return data?.data ?? null;
}

export default function HealthPage() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Backend health</h1>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-alert-200 bg-alert-50 p-4 text-sm text-alert-800"
        >
          <strong>Could not reach the backend:</strong>{' '}
          {error.message || 'unknown error'}
        </div>
      )}

      {data && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Field label="Status" value={data.status} />
            <Field label="Service" value={data.service} />
            <Field label="Version" value={data.version} />
            <Field label="Uptime (s)" value={data.uptimeSeconds} />
            <Field label="DB connected" value={String(data?.db?.connected)} />
            <Field
              label="Timestamp"
              value={data.timestamp}
              wide
            />
          </dl>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, wide = false }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-slate-900">{value}</dd>
    </div>
  );
}
