'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState, StatCard } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { Input, Field, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { formatMoney, formatClock, formatDate, toLocalInputValue } from '@/lib/billing/format';
import type { Booking, CafeSettings, Customer, Resource, WaitlistEntry } from '@/types';
import {
  CalendarPlus, Check, X, LogIn, CalendarClock, UserPlus, Hourglass,
  ChevronLeft, ChevronRight, Search,
} from 'lucide-react';

type Tab = 'upcoming' | 'pending' | 'today' | 'all';

export default function BookingsPage() {
  const params = useSearchParams();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const search = new URLSearchParams({ limit: '20', offset: String(page * 20) });
      if (tab === 'upcoming') search.set('upcoming', '1');
      else if (tab === 'pending') search.set('status', 'PENDING');
      else if (tab === 'today') search.set('upcoming', '1');

      const [b, w, dash] = await Promise.all([
        api.get<{ bookings: Booking[]; total: number }>(`/api/admin/bookings?${search}`),
        api.get<{ waitlist: WaitlistEntry[] }>('/api/admin/waitlist'),
        api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
      ]);
      setBookings(b.bookings);
      setTotal(b.total);
      setWaitlist(w.waitlist);
      setSettings(dash.settings);
    } catch {
      setBookings([]);
    }
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useDebouncedCallback(load, 400);
  useRealtime('bookings', refetch);
  useRealtime('waitlist', refetch);

  async function action(id: string, act: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api.patch<{ sessionId?: string }>(`/api/admin/bookings/${id}`, { action: act, ...extra });
      if (act === 'check-in' && res.sessionId) {
        toast.success('Checked in — session started');
        window.location.href = `/admin/sessions/${res.sessionId}`;
        return;
      }
      toast.success('Booking updated');
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
      setCancelId(null);
    }
  }

  async function assignWaitlist(id: string) {
    setBusy(true);
    try {
      const res = await api.patch<{ customerId: string; name: string; mobile: string; resourceId: string | null; resourceType: string | null; requestedDurationMinutes: number | null }>(
        '/api/admin/waitlist',
        { id, action: 'assign' }
      );
      const q = new URLSearchParams({
        customerId: res.customerId,
        name: res.name,
        mobile: res.mobile,
      });
      if (res.resourceId) q.set('resourceId', res.resourceId);
      if (res.requestedDurationMinutes) q.set('durationMinutes', String(res.requestedDurationMinutes));
      toast.success(`${res.name} is up — start their session`);
      window.location.href = `/admin/sessions/new?${q}`;
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  }

  const sym = settings?.currency_symbol || '₹';
  const pendingCount = bookings?.filter((b) => b.status === 'PENDING').length ?? 0;

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle={`${total} booking${total === 1 ? '' : 's'}`}
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> New Booking
          </Button>
        }
      />

      {/* waitlist */}
      <section className="mb-6" aria-label="Queue">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Queue / waitlist</h2>
        {waitlist.length === 0 ? (
          <p className="glass rounded-2xl p-4 text-center text-sm text-muted shadow-card">The queue is empty</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {waitlist.map((w) => (
              <li key={w.id} className="glass flex items-center gap-3 rounded-2xl p-4 shadow-card">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-sm font-extrabold text-warning">
                  {w.position}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{w.customer_name}</p>
                  <p className="truncate text-xs text-muted">
                    {w.resource_name ?? w.resource_type?.replace(/_/g, ' ') ?? 'Any resource'}
                    {w.requested_duration_minutes ? ` · ${w.requested_duration_minutes} min` : ''}
                  </p>
                </div>
                <Button size="sm" loading={busy} onClick={() => assignWaitlist(w.id)}>
                  <UserPlus className="h-4 w-4" /> Assign
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1" role="tablist" aria-label="Booking filters">
        {(['upcoming', 'pending', 'today', 'all'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => { setTab(t); setPage(0); }}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold capitalize transition-colors ${
              tab === t ? 'bg-primary text-white shadow-glow-sm' : 'text-muted hover:text-content'
            }`}
          >
            {t === 'today' ? 'Upcoming' : t}
            {t === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-warning/20 px-1.5 text-xs text-warning">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {!bookings || !settings ? (
        <ListSkeleton rows={5} />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-10 w-10" />}
          title="No bookings found"
          message="Online bookings from the QR page and bookings you create appear here."
          action={<Button onClick={() => setNewOpen(true)}><CalendarPlus className="h-4 w-4" /> New Booking</Button>}
        />
      ) : (
        <div className="glass overflow-x-auto rounded-2xl shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-bold">Code</th>
                <th className="px-4 py-3 font-bold">Customer</th>
                <th className="px-4 py-3 font-bold">Resource</th>
                <th className="px-4 py-3 font-bold">When</th>
                <th className="px-4 py-3 font-bold">Duration</th>
                <th className="px-4 py-3 font-bold">Est.</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bookings.map((b) => (
                <tr key={b.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-secondary">{b.booking_code}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{b.customer_name}</p>
                    <p className="text-xs text-muted">{b.customer_mobile}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{b.resource_name}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{formatDate(b.start_time, settings.timezone)}</p>
                    <p className="text-xs text-muted">
                      {formatClock(b.start_time, settings.timezone)} – {formatClock(b.end_time, settings.timezone)}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted">{b.duration_minutes} min</td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {b.estimated_amount ? formatMoney(b.estimated_amount, sym) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                    {b.source === 'PUBLIC' && (
                      <span className="ml-1 text-[10px] font-bold uppercase text-secondary">QR</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {b.status === 'PENDING' && (
                        <IconAction title="Confirm" icon={<Check className="h-3.5 w-3.5" />} tone="success" onClick={() => action(b.id, 'confirm')} disabled={busy} />
                      )}
                      {(b.status === 'PENDING' || b.status === 'CONFIRMED') && (
                        <>
                          <IconAction title="Check in (start session)" icon={<LogIn className="h-3.5 w-3.5" />} tone="primary" onClick={() => action(b.id, 'check-in')} disabled={busy} />
                          <IconAction title="Cancel" icon={<X className="h-3.5 w-3.5" />} tone="danger" onClick={() => setCancelId(b.id)} disabled={busy} />
                        </>
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

      <NewBookingModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={refetch} />
      <ConfirmDialog
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        onConfirm={() => cancelId && action(cancelId, 'cancel')}
        title="Cancel booking?"
        message="The customer will lose this slot. This cannot be undone."
        confirmLabel="Cancel booking"
        danger
        loading={busy}
      />
    </div>
  );
}

function IconAction({
  title, icon, tone, onClick, disabled,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'success' | 'danger' | 'primary';
  onClick: () => void;
  disabled?: boolean;
}) {
  const tones = {
    success: 'border-success/40 text-success hover:bg-success/10',
    danger: 'border-danger/40 text-danger hover:bg-danger/10',
    primary: 'border-primary/40 text-primary hover:bg-primary/10',
  };
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-1.5 transition-colors disabled:opacity-40 ${tones[tone]}`}
    >
      {icon}
    </button>
  );
}

function NewBookingModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState('');
  const [startTime, setStartTime] = useState(toLocalInputValue(new Date(Date.now() + 30 * 60000)));
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<{ resources: Resource[] }>('/api/admin/resources').then((r) => {
      setResources(r.resources.filter((x) => x.active));
      if (r.resources[0]) setResourceId(r.resources[0].id);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) { setCustomers([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ customers: Customer[] }>(`/api/admin/customers?q=${encodeURIComponent(query)}&limit=6`);
        setCustomers(res.customers);
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !resourceId || !startTime) return;
    setBusy(true);
    try {
      await api.post('/api/admin/bookings', {
        customerId,
        resourceId,
        startTime: new Date(startTime).toISOString(),
        durationMinutes: duration,
        status: 'CONFIRMED',
        notes: notes || null,
      });
      toast.success('Booking created');
      onCreated();
      onClose();
      setCustomerId(null);
      setQuery('');
      setNotes('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New booking" size="md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer" required>
          {customerId ? (
            <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5">
              <span className="text-sm font-bold">{customers.find((c) => c.id === customerId)?.name ?? 'Customer'}</span>
              <button type="button" className="text-xs font-bold text-secondary" onClick={() => setCustomerId(null)}>
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or mobile…" className="pl-10" />
              {customers.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-border bg-surface">
                  {customers.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-2" onClick={() => setCustomerId(c.id)}>
                        <span className="font-bold">{c.name}</span> <span className="text-muted">{c.mobile}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resource" required>
            <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Duration" required>
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 60, 90, 120, 180, 240].map((d) => (
                <option key={d} value={d}>{d >= 60 ? `${d / 60}h` : `${d}m`}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Start time" required>
          <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </Field>

        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. prefers FIFA" />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!customerId || !resourceId}>Create booking</Button>
        </div>
      </form>
    </Modal>
  );
}
