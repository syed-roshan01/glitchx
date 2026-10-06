'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useApi, invalidate } from '@/lib/use-api';
import { PageHeader, EmptyState, ErrorState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/billing/format';
import type { Customer } from '@/types';
import { UserPlus, Search, ChevronLeft, ChevronRight, Users } from 'lucide-react';

export default function CustomersPage() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const params = new URLSearchParams({ limit: '20', offset: String(page * 20) });
  if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
  const { data, error, reload } = useApi<{ customers: Customer[]; total: number }>(`/api/admin/customers?${params}`);
  const customers = data?.customers ?? null;
  const total = data?.total ?? 0;
  const load = () => invalidate('/api/admin/customers');

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${total} customer${total === 1 ? '' : 's'}`}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add Customer
          </Button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search by name or mobile number…"
          className="pl-10"
          aria-label="Search customers"
        />
      </div>

      {error && !data ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : !customers ? (
        <ListSkeleton rows={6} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={query ? 'No customers found' : 'No customers yet'}
          message={query ? `Nothing matches “${query}”.` : 'Customers are created automatically with their first session or booking.'}
          action={<Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" /> Add Customer</Button>}
        />
      ) : (
        <div className="glass overflow-x-auto rounded-2xl shadow-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Mobile</th>
                <th className="px-4 py-3 font-bold">Email</th>
                <th className="px-4 py-3 font-bold">Since</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-muted">{c.mobile}</td>
                  <td className="px-4 py-3 text-muted">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/customers/${c.id}`} className="text-xs font-bold text-secondary hover:underline">
                      View history →
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

      <AddCustomerModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { load(); toast.success('Customer added'); }} />
    </div>
  );
}

function AddCustomerModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', mobile: '', email: '', notes: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/admin/customers', form);
      onCreated();
      onClose();
      setForm({ name: '', mobile: '', email: '', notes: '' });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add customer" size="sm">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoFocus />
        </Field>
        <Field label="Mobile number" required>
          <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required inputMode="tel" placeholder="9876543210" />
        </Field>
        <Field label="Email (optional)">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Notes (optional)">
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. competitive FIFA player" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Add customer</Button>
        </div>
      </form>
    </Modal>
  );
}
