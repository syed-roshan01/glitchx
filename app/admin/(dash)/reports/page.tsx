'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api-client';
import { PageHeader, StatCard, EmptyState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/billing/format';
import type { CafeSettings } from '@/types';
import { BarChart3, IndianRupee, Users, Timer, Receipt } from 'lucide-react';

interface ReportData {
  range: string;
  days: number;
  settings: CafeSettings;
  revenueSeries: { label: string; revenue: number; sessions: number }[];
  categoryTotals: { gaming: number; food: number; services: number; total: number };
  byResource: { name: string; revenue: number; sessions: number; minutes: number }[];
  byItem: { name: string; quantity: number; revenue: number }[];
  byPaymentMethod: { method: string; amount: number; count: number }[];
  sessionStats: { count: number; avgMinutes: number; avgBillValue: number; totalCustomers: number };
}

const RANGES = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Last 30 days' },
];

export default function ReportsPage() {
  const [range, setRange] = useState<'day' | 'week' | 'month'>('day');
  const [data, setData] = useState<ReportData | null>(null);

  useEffect(() => {
    setData(null);
    api.get<ReportData>(`/api/admin/reports?range=${range}`)
      .then(setData)
      .catch(() => setData(null));
  }, [range]);

  const sym = data?.settings.currency_symbol ?? '₹';

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Revenue, sessions and item performance"
        actions={
          <div className="flex rounded-xl border border-border bg-surface-2 p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id as any)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  range === r.id ? 'bg-primary text-white' : 'text-muted hover:text-content'
                }`}
                aria-pressed={range === r.id}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {!data ? (
        <ListSkeleton rows={8} />
      ) : (
        <div className="space-y-6">
          {/* headline stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Revenue" value={formatMoney(data.categoryTotals.total, sym)} tone="success" icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard label="Sessions" value={data.sessionStats.count} icon={<BarChart3 className="h-4 w-4" />} />
            <StatCard label="Customers" value={data.sessionStats.totalCustomers} icon={<Users className="h-4 w-4" />} />
            <StatCard label="Avg session" value={`${data.sessionStats.avgMinutes} min`} icon={<Timer className="h-4 w-4" />} />
          </div>

          {/* revenue chart */}
          <section className="glass rounded-2xl p-5 shadow-card" aria-label="Revenue chart">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">
              Revenue {data.days === 1 ? 'by hour (today)' : 'by day'}
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenueSeries} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                  <XAxis dataKey="label" stroke="#A1A1AA" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#A1A1AA" fontSize={11} tickLine={false} width={48} />
                  <Tooltip
                    contentStyle={{ background: '#18181B', border: '1px solid #3F3F46', borderRadius: 12, color: '#FAFAFA' }}
                    formatter={(value: any) => [formatMoney(Number(value), sym), 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#7C3AED" strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* sessions chart */}
          <section className="glass rounded-2xl p-5 shadow-card" aria-label="Sessions chart">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Sessions</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenueSeries} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                  <XAxis dataKey="label" stroke="#A1A1AA" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                  <YAxis stroke="#A1A1AA" fontSize={11} tickLine={false} width={32} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#18181B', border: '1px solid #3F3F46', borderRadius: 12, color: '#FAFAFA' }}
                    formatter={(value: any) => [value, 'Sessions']}
                  />
                  <Bar dataKey="sessions" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* categories */}
          <section aria-label="Revenue categories">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Revenue by category</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Gaming" value={formatMoney(data.categoryTotals.gaming, sym)} />
              <StatCard label="Food & drinks" value={formatMoney(data.categoryTotals.food, sym)} />
              <StatCard label="Services" value={formatMoney(data.categoryTotals.services, sym)} />
              <StatCard label="Avg bill" value={formatMoney(data.sessionStats.avgBillValue, sym)} icon={<Receipt className="h-4 w-4" />} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* by resource */}
            <section className="glass rounded-2xl p-5 shadow-card" aria-label="Revenue by resource">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Revenue by resource</h2>
              {data.byResource.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No sessions in this period</p>
              ) : (
                <ul className="space-y-2">
                  {data.byResource.sort((a, b) => b.revenue - a.revenue).map((r) => (
                    <li key={r.name} className="flex items-center justify-between text-sm">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-muted">
                        {r.sessions} sessions · {Math.floor(r.minutes / 60)}h {r.minutes % 60}m ·{' '}
                        <strong className="text-content">{formatMoney(r.revenue, sym)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* by item */}
            <section className="glass rounded-2xl p-5 shadow-card" aria-label="Revenue by item">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Top items</h2>
              {data.byItem.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No items sold in this period</p>
              ) : (
                <ul className="space-y-2">
                  {data.byItem.slice(0, 8).map((i) => (
                    <li key={i.name} className="flex items-center justify-between text-sm">
                      <span className="font-semibold">{i.name}</span>
                      <span className="text-muted">
                        × {i.quantity} · <strong className="text-content">{formatMoney(i.revenue, sym)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* payment methods */}
            <section className="glass rounded-2xl p-5 shadow-card lg:col-span-2" aria-label="Payment methods">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Payment methods</h2>
              {data.byPaymentMethod.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No payments in this period</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {data.byPaymentMethod.map((m) => (
                    <StatCard key={m.method} label={m.method} value={formatMoney(m.amount, sym)} sub={`${m.count} payments`} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {data.categoryTotals.total === 0 && (
            <EmptyState title="No revenue in this period" message="Try a wider range, or this is a fresh start!" />
          )}
        </div>
      )}
    </div>
  );
}
