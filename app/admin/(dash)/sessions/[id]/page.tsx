'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useApi, invalidate } from '@/lib/use-api';
import { useSettings } from '@/components/admin/admin-context';
import { useNow } from '@/hooks/use-now';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { calculateSessionBreakdown, type BillingBreakdown } from '@/lib/billing/engine';
import { formatMoney, formatDuration, formatClock, formatDateTime } from '@/lib/billing/format';
import { AddItemModal } from '@/components/admin/add-item-modal';
import { AddServiceModal } from '@/components/admin/add-service-modal';
import { EndSessionModal } from '@/components/admin/end-session-modal';
import { CustomerCard, PriceCard } from '@/components/admin/session-edit-cards';
import { CustomPriceBadge, billingModeText, customerLine, rateLabel } from '@/components/admin/pricing-display';
import type { CafeSettings, Invoice, PricingRule, Session, SessionItem } from '@/types';
import {
  CupSoda, Sparkles, Pause, Play, Square, Percent, Receipt, ArrowLeft,
  Gamepad2, Clock, NotebookPen,
} from 'lucide-react';

interface SessionDetail {
  session: Session;
  items: SessionItem[];
  settings: CafeSettings;
  rules: PricingRule[];
  breakdown: BillingBreakdown | null;
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const settings = useSettings();
  const now = useNow(1000);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const key = id ? `/api/admin/sessions/${id}` : null;
  const { data, error, reload, mutate } = useApi<SessionDetail>(key);

  const refetch = useDebouncedCallback(reload, 400);
  useRealtime('sessions', refetch, { filter: id ? `id=eq.${id}` : undefined });
  useRealtime('session_items', refetch, { filter: id ? `session_id=eq.${id}` : undefined });

  const session = data?.session;
  const items = data?.items;
  const rules = data?.rules;
  const live = session?.status === 'ACTIVE' || session?.status === 'PAUSED';

  // Completed sessions: the API returns the invoice generated for this session.
  const invoiceSearch = session ? session.customer_mobile || session.customer_name || '' : '';
  const invoice = (data as { invoice?: Pick<Invoice, 'id' | 'invoice_number'> | null } | undefined)?.invoice ?? null;

  // live bill (single source of truth: billing engine from DB timestamps)
  // NOTE: every hook must run before the early returns below.
  const breakdown = useMemo(() => {
    if (!session || !items || !rules || !live || !session.actual_start_time) return null;
    const itemAmount = items
      .filter((i) => ['FOOD', 'DRINK', 'OTHER'].includes(i.item_type))
      .reduce((s, i) => s + i.total_price, 0);
    const serviceAmount = items
      .filter((i) => ['SERVICE', 'GAME'].includes(i.item_type))
      .reduce((s, i) => s + i.total_price, 0);
    return calculateSessionBreakdown({
      plan: session.pricing_plan_snapshot,
      rules,
      billingMode: settings.billing_mode,
      minBillingMinutes: settings.min_billing_minutes,
      timeZone: settings.timezone,
      resourceId: session.resource_id,
      resourceType: session.resource_type ?? '',
      timing: {
        actual_start_time: session.actual_start_time,
        paused_at: session.paused_at,
        total_paused_seconds: session.total_paused_seconds,
      },
      endAt: now ?? new Date(),
      itemAmount,
      serviceAmount,
      discount:
        session.discount_type && session.discount_value
          ? { type: session.discount_type, value: session.discount_value }
          : null,
      tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
    });
  }, [live, session, items, settings, rules, now]);

  const load = useCallback(() => {
    reload();
    invalidate('/api/admin/sessions');
    invalidate('/api/admin/dashboard');
  }, [reload]);

  if (error && !data) {
    return (
      <EmptyState
        title="Couldn’t load session"
        message={error.message}
        className="mt-10"
        action={
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => reload()} className="text-sm font-bold text-primary hover:underline">
              Retry
            </button>
            <Link href="/admin/sessions" className="text-sm font-bold text-secondary hover:underline">
              ← Back to sessions
            </Link>
          </div>
        }
      />
    );
  }
  if (!data || !session || !items || !rules) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
      </div>
    );
  }

  const sym = settings.currency_symbol || '₹';
  const bill = breakdown ?? data.breakdown;

  /** optimistic local edit of the session; returns a rollback */
  function optimistic(fn: (s: Session) => Session): () => void {
    const prev = data;
    mutate((d) => (d ? { ...d, session: fn(d.session) } : d));
    return () => mutate(() => prev);
  }

  async function togglePause() {
    if (!session || pauseBusy) return;
    const resuming = session.status === 'PAUSED';
    const prev = data;
    setPauseBusy(true);
    // optimistic: flip status immediately; the refetch brings exact timestamps
    mutate((d) =>
      d
        ? {
            ...d,
            session: {
              ...d.session,
              status: resuming ? 'ACTIVE' : 'PAUSED',
              paused_at: resuming ? null : new Date().toISOString(),
            },
          }
        : d
    );
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, { action: resuming ? 'resume' : 'pause' });
      toast.success(resuming ? 'Session resumed' : 'Session paused — timer stopped');
      load();
    } catch (e: any) {
      mutate(() => prev);
      toast.error(e.message);
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <Link href="/admin/sessions" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-content">
          <ArrowLeft className="h-4 w-4" /> Sessions
        </Link>
      </div>

      <PageHeader
        title={session.resource_name ?? 'Session'}
        subtitle={customerLine(session)}
        actions={<StatusBadge status={session.status} pulse={live && session.status === 'ACTIVE'} />}
      />

      {/* live timer panel */}
      {live && bill ? (
        <div className="glass mb-4 rounded-2xl p-6 shadow-card">
          <div className="flex flex-col items-center gap-1 pb-5 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Elapsed time</p>
            <p className="font-mono text-5xl font-black tabular-nums text-secondary sm:text-6xl" aria-live="off">
              {formatDuration(bill.elapsedSeconds)}
            </p>
            <p className="text-xs text-muted">
              Started {formatClock(session.actual_start_time, settings.timezone)}
              {session.status === 'PAUSED' && ' · PAUSED — not billing'}
            </p>
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
              <span className="font-bold text-content">
                {bill.ruleApplied
                  ? `${formatMoney(bill.ruleApplied.price, sym)}/hr (peak)`
                  : rateLabel(session.pricing_plan_snapshot, sym)}
              </span>
              {session.pricing_plan_snapshot.custom && <CustomPriceBadge />}
              <span className="text-muted">
                · {bill.billableMinutes} billable min · {billingModeText(settings.billing_mode, settings.min_billing_minutes)}
              </span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
            <Stat label="Gaming" value={formatMoney(bill.gamingAmount, sym)} />
            <Stat label="Items" value={formatMoney(bill.itemAmount, sym)} />
            <Stat label="Services" value={formatMoney(bill.serviceAmount, sym)} />
            <Stat label="Current total" value={formatMoney(bill.total, sym)} tone="text-success" />
          </div>
          {bill.ruleApplied && (
            <p className="mt-3 text-center text-xs font-semibold text-warning">
              Peak pricing: {bill.ruleApplied.name} ({formatMoney(bill.ruleApplied.price, sym)}/hr)
            </p>
          )}
        </div>
      ) : (
        <div className="glass mb-4 rounded-2xl p-6 shadow-card">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Start" value={formatDateTime(session.actual_start_time ?? session.scheduled_start_time, settings.timezone)} />
            <Stat label="End" value={formatDateTime(session.end_time, settings.timezone)} />
            <Stat label="Duration" value={session.duration_seconds ? formatDuration(session.duration_seconds) : '—'} />
            <Stat label="Total" value={session.total_amount != null ? formatMoney(session.total_amount, sym) : '—'} tone="text-success" />
          </div>
          {session.status === 'COMPLETED' && (
            <div className="mt-4 rounded-xl border border-success/30 bg-success/10 p-4 text-center">
              <p className="text-sm font-bold text-success">Session completed</p>
              {session.payment_status === 'PAID' ? (
                <p className="mt-1 text-xs text-muted">Paid in full ✓</p>
              ) : (
                <p className="mt-1 text-xs text-warning">Payment pending</p>
              )}
              <Link
                href={
                  invoice
                    ? `/admin/invoices/${invoice.id}`
                    : `/admin/invoices?q=${encodeURIComponent(invoiceSearch)}`
                }
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 text-sm font-bold hover:bg-surface-3"
              >
                <Receipt className="h-4 w-4" /> {invoice ? `View invoice ${invoice.invoice_number}` : 'Find invoice'}
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* customer + price + details */}
        <div className="space-y-4 lg:col-span-1">
          <CustomerCard session={session} onOptimistic={optimistic} onSaved={load} />
          <PriceCard
            session={session}
            sym={sym}
            editable={live || session.status === 'SCHEDULED'}
            onOptimistic={optimistic}
            onSaved={load}
          />
          <div className="glass rounded-2xl p-5 shadow-card">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Details</h2>
            <dl className="space-y-3 text-sm">
              <Detail icon={<Gamepad2 className="h-4 w-4" />} label="Resource" value={session.resource_name ?? '—'} />
              <Detail icon={<Clock className="h-4 w-4" />} label="Plan" value={session.pricing_plan_snapshot?.name ?? '—'} />
              <Detail
                icon={<Percent className="h-4 w-4" />}
                label="Discount"
                value={
                  session.discount_type
                    ? `${session.discount_type === 'PERCENT' ? session.discount_value + '%' : formatMoney(session.discount_value ?? 0, sym)} off`
                    : 'None'
                }
              />
            </dl>
            {session.notes && (
              <p className="mt-4 rounded-xl border border-border bg-surface-2 p-3 text-xs text-muted">{session.notes}</p>
            )}
            <button
              className="mt-4 inline-flex min-h-[32px] items-center gap-1.5 text-xs font-bold text-secondary hover:underline"
              onClick={() => setNotesOpen(true)}
            >
              <NotebookPen className="h-3.5 w-3.5" /> {session.notes ? 'Edit notes' : 'Add notes'}
            </button>
          </div>
        </div>

        {/* line items */}
        <div className="glass rounded-2xl p-5 shadow-card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Line items</h2>
            {live && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAddItemOpen(true)}>
                  <CupSoda className="h-4 w-4" /> Add item
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAddServiceOpen(true)}>
                  <Sparkles className="h-4 w-4" /> Add game
                </Button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No items added yet</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="font-semibold">{i.name_snapshot}</span>{' '}
                    <span className="text-muted">× {i.quantity}</span>
                    <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">
                      {i.item_type}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums">{formatMoney(i.total_price, sym)}</span>
                </li>
              ))}
            </ul>
          )}

          {bill && (
            <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
              <Row label="Subtotal" value={formatMoney(bill.subtotal, sym)} />
              {bill.discountAmount > 0 && (
                <Row label="Discount" value={`− ${formatMoney(bill.discountAmount, sym)}`} tone="text-success" />
              )}
              {bill.taxAmount > 0 && (
                <Row label={`${bill.taxName ?? 'Tax'} (${bill.taxRate}%)`} value={formatMoney(bill.taxAmount, sym)} />
              )}
              <div className="flex items-center justify-between pt-2">
                <span className="font-bold">TOTAL</span>
                <span className="text-lg font-extrabold tabular-nums text-success">{formatMoney(bill.total, sym)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* actions */}
      {live && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {settings.pause_enabled && (
            <Button variant={session.status === 'PAUSED' ? 'success' : 'outline'} onClick={togglePause} disabled={pauseBusy}>
              {session.status === 'PAUSED' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {session.status === 'PAUSED' ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="outline" onClick={() => setDiscountOpen(true)}>
            <Percent className="h-4 w-4" /> Discount
          </Button>
          <Button variant="danger" size="lg" onClick={() => setEndOpen(true)}>
            <Square className="h-4 w-4" /> End Session
          </Button>
        </div>
      )}
      {session.status === 'SCHEDULED' && (
        <div className="mt-5 rounded-2xl border border-secondary/30 bg-secondary/10 p-4 text-center text-sm font-semibold text-secondary">
          Scheduled for {formatDateTime(session.scheduled_start_time, settings.timezone)} — activates automatically.
        </div>
      )}

      {/* modals */}
      <AddItemModal sessionId={session.id} open={addItemOpen} onClose={() => setAddItemOpen(false)} onAdded={load} />
      <AddServiceModal sessionId={session.id} open={addServiceOpen} onClose={() => setAddServiceOpen(false)} onAdded={load} />
      <EndSessionModal
        session={session}
        items={items}
        settings={settings}
        rules={rules}
        open={endOpen}
        onClose={() => setEndOpen(false)}
        onEnded={(res) => {
          setEndOpen(false);
          invalidate('/api/admin');
          toast.success(`Invoice ${res.invoiceNumber} created`);
          router.push(`/admin/invoices/${res.invoiceId}`);
        }}
      />
      <DiscountModal
        session={session}
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        onSaved={load}
      />
      <NotesModal session={session} open={notesOpen} onClose={() => setNotesOpen(false)} onSaved={load} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</dt>
        <dd className="truncate font-semibold">{value}</dd>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-bold tabular-nums ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

function DiscountModal({
  session, open, onClose, onSaved,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<'PERCENT' | 'FIXED' | null>(session.discount_type ?? null);
  const [value, setValue] = useState<number>(session.discount_value ?? 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(session.discount_type ?? null);
    setValue(session.discount_value ?? 0);
  }, [open, session.discount_type, session.discount_value]);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, {
        action: 'discount',
        discountType: type,
        discountValue: type ? Number(value) || 0 : 0,
      });
      toast.success('Discount saved — it applies when the session ends');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply discount"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save discount</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {(['PERCENT', 'FIXED'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(type === t ? null : t)}
              className={`flex-1 rounded-xl border px-4 py-3 text-sm font-bold ${
                type === t ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-surface-2 text-muted'
              }`}
              aria-pressed={type === t}
            >
              {t === 'PERCENT' ? 'Percentage %' : 'Fixed amount'}
            </button>
          ))}
        </div>
        {type && (
          <Field label={type === 'PERCENT' ? 'Percent off (0–100)' : 'Amount off'}>
            <Input
              type="number"
              min={0}
              max={type === 'PERCENT' ? 100 : undefined}
              value={value || ''}
              onChange={(e) => setValue(Number(e.target.value))}
              autoFocus
            />
          </Field>
        )}
        <p className="text-xs text-muted">The discount is recorded with your name and applied to the final invoice.</p>
      </div>
    </Modal>
  );
}

function NotesModal({
  session, open, onClose, onSaved,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState(session.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => setNotes(session.notes ?? ''), [session.notes, open]);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, { action: 'notes', notes });
      toast.success('Notes saved');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Session notes"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save</Button>
        </div>
      }
    >
      <Field label="Notes (internal)">
        <textarea
          className="input-base min-h-[100px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Birthday party, extra controller requested…"
        />
      </Field>
    </Modal>
  );
}
