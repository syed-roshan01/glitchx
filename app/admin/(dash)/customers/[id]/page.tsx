'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { PageHeader, StatCard, EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMoney, formatDateTime, formatDuration, formatDate } from '@/lib/billing/format';
import type { CafeSettings, Customer, CustomerStats, Invoice, Session } from '@/types';
import { ArrowLeft, Gamepad2, IndianRupee, CalendarDays, Star, Receipt } from 'lucide-react';

interface CustomerDetail {
  customer: Customer;
  stats: CustomerStats;
  sessions: Session[];
  invoices: Invoice[];
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<(CustomerDetail & { settings: CafeSettings }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<CustomerDetail>(`/api/admin/customers/${id}`),
      api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
    ])
      .then(([d, s]) => setData({ ...d, settings: s.settings }))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return <EmptyState title="Customer not found" message={error} className="mt-10" />;
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
      </div>
    );
  }

  const { customer, stats, sessions, invoices, settings } = data;
  const sym = settings.currency_symbol || '₹';

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-content">
          <ArrowLeft className="h-4 w-4" /> Customers
        </Link>
      </div>

      <PageHeader title={customer.name} subtitle={`${customer.mobile}${customer.email ? ` · ${customer.email}` : ''}`} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total sessions" value={stats.total_sessions} icon={<Gamepad2 className="h-4 w-4" />} />
        <StatCard label="Total spent" value={formatMoney(stats.total_spent, sym)} tone="success" icon={<IndianRupee className="h-4 w-4" />} />
        <StatCard label="Last visit" value={stats.last_visit ? formatDate(stats.last_visit, settings.timezone) : '—'} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Favorite station" value={stats.favorite_resource ?? '—'} icon={<Star className="h-4 w-4" />} />
      </div>

      {customer.notes && (
        <p className="glass mb-6 rounded-2xl p-4 text-sm text-muted shadow-card">📝 {customer.notes}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Session history">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Sessions</h2>
          {sessions.length === 0 ? (
            <EmptyState title="No sessions yet" className="py-8" />
          ) : (
            <ul className="glass divide-y divide-border rounded-2xl shadow-card">
              {sessions.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{s.resource_name}</p>
                    <p className="text-xs text-muted">
                      {formatDateTime(s.actual_start_time ?? s.created_at, settings.timezone)}
                      {s.duration_seconds ? ` · ${formatDuration(s.duration_seconds)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    {s.total_amount != null && (
                      <p className="text-sm font-bold tabular-nums">{formatMoney(s.total_amount, sym)}</p>
                    )}
                    <StatusBadge status={s.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Invoices">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Invoices</h2>
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" className="py-8" />
          ) : (
            <ul className="glass divide-y divide-border rounded-2xl shadow-card">
              {invoices.slice(0, 12).map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <Receipt className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-bold">{inv.invoice_number}</p>
                    <p className="text-xs text-muted">{formatDate(inv.issued_at, settings.timezone)}</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums">{formatMoney(inv.total_amount, sym)}</p>
                  <Link href={`/admin/invoices/${inv.id}`} className="text-xs font-bold text-secondary hover:underline">
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 text-center">
        <Link href={`/admin/sessions/new?customerId=${customer.id}&name=${encodeURIComponent(customer.name)}&mobile=${encodeURIComponent(customer.mobile)}`}>
          <Button>
            <Gamepad2 className="h-4 w-4" /> Start session for {customer.name.split(' ')[0]}
          </Button>
        </Link>
      </div>
    </div>
  );
}
