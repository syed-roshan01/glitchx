'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState, StatCard } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { formatMoney, formatDateTime } from '@/lib/billing/format';
import type { CafeSettings, Payment } from '@/types';
import { CreditCard, IndianRupee, Banknote, Smartphone, Wallet } from 'lucide-react';

const METHOD_ICONS: Record<string, React.ReactNode> = {
  CASH: <Banknote className="h-4 w-4" />,
  UPI: <Smartphone className="h-4 w-4" />,
  CARD: <CreditCard className="h-4 w-4" />,
  OTHER: <Wallet className="h-4 w-4" />,
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const load = () =>
    Promise.all([
      api.get<{ payments: Payment[]; total: number }>(`/api/admin/payments?limit=30&offset=${page * 30}`),
      api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
    ])
      .then(([p, s]) => {
        setPayments(p.payments);
        setTotal(p.total);
        setSettings(s.settings);
      })
      .catch(() => setPayments([]));

  useEffect(() => {
    load();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useDebouncedCallback(load, 400);
  useRealtime('invoices', refetch);

  if (!payments || !settings) return <ListSkeleton rows={8} />;

  const sym = settings.currency_symbol || '₹';
  const today = payments.filter((p) => new Date(p.paid_at ?? p.created_at).toDateString() === new Date().toDateString());
  const todayTotal = today.reduce((s, p) => s + p.amount, 0);
  const byMethod = today.reduce<Record<string, number>>((acc, p) => {
    acc[p.payment_method] = (acc[p.payment_method] ?? 0) + p.amount;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader title="Payments" subtitle={`${total} recorded payment${total === 1 ? '' : 's'}`} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Collected today" value={formatMoney(todayTotal, sym)} tone="success" icon={<IndianRupee className="h-4 w-4" />} />
        {['CASH', 'UPI', 'CARD', 'OTHER'].map((m) => (
          <StatCard key={m} label={m} value={formatMoney(byMethod[m] ?? 0, sym)} sub={`${today.filter((p) => p.payment_method === m).length} payments`} />
        ))}
      </div>

      {payments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-10 w-10" />}
          title="No payments recorded yet"
          message="Payments are recorded when you end a session or from an unpaid invoice."
        />
      ) : (
        <div className="glass overflow-x-auto rounded-2xl shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-bold">Invoice</th>
                <th className="px-4 py-3 font-bold">Method</th>
                <th className="px-4 py-3 font-bold">Reference</th>
                <th className="px-4 py-3 font-bold">Received by</th>
                <th className="px-4 py-3 font-bold">When</th>
                <th className="px-4 py-3 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    {p.invoice_id ? (
                      <Link href={`/admin/invoices/${p.invoice_id}`} className="font-mono text-xs font-bold text-secondary hover:underline">
                        {p.invoice_number ?? 'View'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {METHOD_ICONS[p.payment_method]} {p.payment_method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{p.transaction_reference ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{p.received_by_name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(p.paid_at ?? p.created_at, settings.timezone)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-success">{formatMoney(p.amount, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 30 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="rounded-xl border border-border px-3 py-2 text-muted disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">←</button>
          <span className="text-sm text-muted">Page {page + 1}</span>
          <button className="rounded-xl border border-border px-3 py-2 text-muted disabled:opacity-40" disabled={(page + 1) * 30 >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">→</button>
        </div>
      )}
    </div>
  );
}
