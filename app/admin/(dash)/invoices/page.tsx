'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatMoney, formatDateTime } from '@/lib/billing/format';
import type { CafeSettings, Invoice } from '@/types';
import { Receipt, Search, ChevronLeft, ChevronRight, IndianRupee } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '20', offset: String(page * 20) });
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      const [res, dash] = await Promise.all([
        api.get<{ invoices: Invoice[]; total: number }>(`/api/admin/invoices?${params}`),
        api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
      ]);
      setInvoices(res.invoices);
      setTotal(res.total);
      setSettings(dash.settings);
    } catch {
      setInvoices([]);
    }
  }, [query, status, page]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [load]);

  const refetch = useDebouncedCallback(load, 400);
  useRealtime('invoices', refetch);

  const sym = settings?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader title="Invoices" subtitle={`${total} invoice${total === 1 ? '' : 's'}`} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search invoice number, customer…"
            className="pl-10"
            aria-label="Search invoices"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {['', 'ISSUED', 'PAID', 'PARTIAL', 'VOID'].map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(0); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                status === s ? 'bg-primary text-white' : 'text-muted hover:text-content'
              }`}
              aria-pressed={status === s}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {!invoices || !settings ? (
        <ListSkeleton rows={6} />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          title="No invoices found"
          message="Invoices are generated automatically when you end a session."
        />
      ) : (
        <div className="glass overflow-x-auto rounded-2xl shadow-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-bold">Invoice</th>
                <th className="px-4 py-3 font-bold">Customer</th>
                <th className="px-4 py-3 font-bold">Resource</th>
                <th className="px-4 py-3 font-bold">Issued</th>
                <th className="px-4 py-3 font-bold">Total</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map((inv) => (
                <tr key={inv.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-secondary">{inv.invoice_number}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{inv.customer_name}</p>
                    <p className="text-xs text-muted">{inv.customer_mobile}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{inv.resource_name}</td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(inv.issued_at, settings.timezone)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center font-bold tabular-nums">
                      <IndianRupee className="mr-0.5 h-3 w-3 text-muted" aria-hidden />
                      {formatMoney(inv.total_amount, '')}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/invoices/${inv.id}`} className="text-xs font-bold text-secondary hover:underline">
                      View / Print →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 20 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="rounded-xl border border-border px-3 py-2 text-muted disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted">Page {page + 1}</span>
          <button className="rounded-xl border border-border px-3 py-2 text-muted disabled:opacity-40" disabled={(page + 1) * 20 >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
