'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useApi, invalidate } from '@/lib/use-api';
import { api } from '@/lib/api-client';
import { useAdmin } from '@/components/admin/admin-context';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState, ErrorState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatMoney, formatDateTime } from '@/lib/billing/format';
import type { Invoice } from '@/types';
import { Receipt, Search, ChevronLeft, ChevronRight, IndianRupee, Trash2 } from 'lucide-react';

export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const { settings, profile } = useAdmin();
  const isAdmin = profile.role === 'ADMIN';
  const toast = useToast();
  const [toDelete, setToDelete] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams({ limit: '20', offset: String(page * 20) });
  if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
  if (status) params.set('status', status);
  const { data, error, reload, mutate } = useApi<{ invoices: Invoice[]; total: number }>(`/api/admin/invoices?${params}`);
  const invoices = data?.invoices ?? null;
  const total = data?.total ?? 0;

  const refetch = useDebouncedCallback(() => invalidate('/api/admin/invoices'), 400);
  useRealtime('invoices', refetch);

  const sym = settings.currency_symbol || '₹';

  async function confirmDelete() {
    if (!toDelete) return;
    const inv = toDelete;
    setDeleting(true);
    try {
      await api.delete(`/api/admin/invoices/${inv.id}`);
      mutate((prev) =>
        prev ? { invoices: prev.invoices.filter((i) => i.id !== inv.id), total: Math.max(prev.total - 1, 0) } : prev
      );
      invalidate('/api/admin/invoices');
      invalidate('/api/admin/payments');
      invalidate('/api/admin/dashboard');
      toast.success(`Invoice ${inv.invoice_number} deleted`);
      setToDelete(null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete invoice');
    } finally {
      setDeleting(false);
    }
  }

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

      {error && !data ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : !invoices ? (
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
                    <p className="font-semibold">{inv.customer_name?.trim() || 'Walk-in'}</p>
                    {inv.customer_mobile && <p className="text-xs text-muted">{inv.customer_mobile}</p>}
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
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/invoices/${inv.id}`} className="text-xs font-bold text-secondary hover:underline">
                        View / Share →
                      </Link>
                      {isAdmin && (
                        <button
                          onClick={() => setToDelete(inv)}
                          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                          aria-label={`Delete invoice ${inv.invoice_number}`}
                          title="Delete invoice"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
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

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete invoice"
        message={
          toDelete
            ? `Delete ${toDelete.invoice_number}? This permanently removes the invoice and its payments. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </div>
  );
}
