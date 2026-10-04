'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState, StatCard } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { SessionCard } from '@/components/admin/session-card';
import { formatMoney, formatDateTime, formatDuration } from '@/lib/billing/format';
import type { CafeSettings, PricingRule, Session, SessionItem } from '@/types';
import { Plus, Gamepad2, Clock3, CheckCircle2 } from 'lucide-react';

type Tab = 'live' | 'scheduled' | 'completed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'completed', label: 'History' },
];

export default function SessionsPage() {
  const [tab, setTab] = useState<Tab>('live');
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: tab, limit: '24', offset: String(page * 24) });
      const res = await api.get<{ sessions: Session[]; items: SessionItem[]; total: number }>(
        `/api/admin/sessions?${params}`
      );
      setSessions(res.sessions);
      setItems(res.items);
      setTotal(res.total);
      const dash = await api.get<{ settings: CafeSettings; rules: PricingRule[] }>('/api/admin/dashboard');
      setSettings(dash.settings);
      setRules(dash.rules);
    } catch {
      setSessions([]);
    }
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useDebouncedCallback(load, 500);
  useRealtime('sessions', refetch);
  useRealtime('session_items', refetch);

  const liveCount = tab === 'live' ? sessions?.length ?? 0 : 0;

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle={`${total} ${tab === 'completed' ? 'completed' : tab} session${total === 1 ? '' : 's'}`}
        actions={
          <Link
            href="/admin/sessions/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-glow-sm"
          >
            <Plus className="h-4 w-4" /> New Session
          </Link>
        }
      />

      <div className="mb-5 flex gap-1 rounded-xl border border-border bg-surface-2 p-1" role="tablist" aria-label="Session filters">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setPage(0);
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
              tab === t.id ? 'bg-primary text-white shadow-glow-sm' : 'text-muted hover:text-content'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!sessions || !settings ? (
        <ListSkeleton rows={4} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Gamepad2 className="h-10 w-10" />}
          title={tab === 'live' ? 'No active sessions' : tab === 'scheduled' ? 'No scheduled sessions' : 'No completed sessions yet'}
          message={
            tab === 'live'
              ? 'Start a walk-in session or check in a booking to see it here.'
              : tab === 'scheduled'
                ? 'Sessions with a future start time will appear here.'
                : 'Completed sessions will appear here.'
          }
          action={
            <Link href="/admin/sessions/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> New Session
            </Link>
          }
        />
      ) : tab === 'live' ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Live now" value={liveCount} tone="primary" icon={<Gamepad2 className="h-4 w-4" />} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} items={items} settings={settings} rules={rules} onChanged={refetch} />
            ))}
          </div>
        </>
      ) : (
        <SessionsTable sessions={sessions} settings={settings} />
      )}

      {total > 24 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-muted disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>
          <span className="text-sm text-muted">Page {page + 1}</span>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-muted disabled:opacity-40"
            disabled={(page + 1) * 24 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function SessionsTable({ sessions, settings }: { sessions: Session[]; settings: CafeSettings }) {
  const sym = settings.currency_symbol || '₹';
  return (
    <div className="glass overflow-x-auto rounded-2xl shadow-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-bold">Customer</th>
            <th className="px-4 py-3 font-bold">Resource</th>
            <th className="px-4 py-3 font-bold">{settings.timezone === 'UTC' ? 'Start (UTC)' : 'Start'}</th>
            <th className="px-4 py-3 font-bold">Duration</th>
            <th className="px-4 py-3 font-bold">Total</th>
            <th className="px-4 py-3 font-bold">Status</th>
            <th className="px-4 py-3 font-bold">Payment</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sessions.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-surface-2/50">
              <td className="px-4 py-3 font-semibold">{s.customer_name}</td>
              <td className="px-4 py-3 text-muted">{s.resource_name}</td>
              <td className="px-4 py-3 text-muted">
                {formatDateTime(s.actual_start_time ?? s.scheduled_start_time, settings.timezone)}
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-muted">
                {s.duration_seconds ? formatDuration(s.duration_seconds) : '—'}
              </td>
              <td className="px-4 py-3 font-bold tabular-nums">{s.total_amount ? formatMoney(s.total_amount, sym) : '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={s.payment_status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/admin/sessions/${s.id}`} className="text-xs font-bold text-secondary hover:underline">
                  {s.status === 'COMPLETED' ? <><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Invoice</> : <><Clock3 className="mr-1 inline h-3.5 w-3.5" />Open</>}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
