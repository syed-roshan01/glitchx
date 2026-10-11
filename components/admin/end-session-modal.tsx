'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useNow } from '@/hooks/use-now';
import { calculateSessionBreakdown, gamingForTargetTotal, computeBillTotals } from '@/lib/billing/engine';
import { formatMoney, formatDuration, formatClock } from '@/lib/billing/format';
import { customerLabel, customerMobile, looksLikeMobile, rateLabel, billingModeText, CustomPriceBadge } from '@/components/admin/pricing-display';
import type { CafeSettings, PricingRule, Session, SessionItem } from '@/types';
import { Banknote, Smartphone, CreditCard, Wallet, Percent, IndianRupee, User, Phone, Pencil, RotateCcw } from 'lucide-react';

/** End-session confirmation with the live final bill, discount and
 *  payment method. Amounts come from the billing engine; the server
 *  recomputes and validates them authoritatively. */
export function EndSessionModal({
  session,
  items,
  settings,
  rules,
  open,
  onClose,
  onEnded,
}: {
  session: Session;
  items: SessionItem[];
  settings: CafeSettings;
  rules: PricingRule[];
  open: boolean;
  onClose: () => void;
  onEnded: (result: { invoiceId: string; invoiceNumber: string }) => void;
}) {
  const toast = useToast();
  const now = useNow(1000);
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED' | null>(session.discount_type ?? null);
  const [discountValue, setDiscountValue] = useState<number>(session.discount_value ?? 0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'OTHER' | null>('CASH');
  const [busy, setBusy] = useState(false);
  const savedName = (session.customer_name ?? session.guest_name ?? '').trim();
  const savedMobile = customerMobile(session) ?? '';
  const [name, setName] = useState(savedName);
  const [mobile, setMobile] = useState(savedMobile);
  // staff-edited final amount (null = use the timer's bill)
  const [finalTotal, setFinalTotal] = useState<number | null>(null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setFinalTotal(null);
    setEditingTotal(false);
  }, [open]);

  // prefill customer details from the session every time the modal opens
  useEffect(() => {
    if (!open) return;
    setName(savedName);
    setMobile(savedMobile);
  }, [open, savedName, savedMobile]);

  // Re-sync with the session's saved discount every time the modal opens
  // (or the saved discount changes) so the shown total matches the invoice.
  useEffect(() => {
    if (!open) return;
    setDiscountType(session.discount_type ?? null);
    setDiscountValue(session.discount_value ?? 0);
  }, [open, session.discount_type, session.discount_value]);

  const breakdown = useMemo(() => {
    if (!now || !session.actual_start_time) return null;
    const discount = discountType && discountValue > 0 ? { type: discountType, value: Number(discountValue) } : null;
    const taxRate = settings.tax_enabled ? settings.tax_rate ?? 0 : 0;
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
      endAt: now,
      itemAmount,
      serviceAmount,
      discount,
      tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
      // an edited total freezes the time charge at the amount that produces it
      gamingOverride:
        finalTotal != null
          ? gamingForTargetTotal({ targetTotal: finalTotal, itemAmount, serviceAmount, discount, taxRate })
          : null,
    });
  }, [now, session, items, settings, rules, discountType, discountValue, finalTotal]);

  // smallest total allowed (food + services after discount/tax, zero time charge)
  const minTotal = useMemo(() => {
    if (!breakdown) return 0;
    const discount = discountType && discountValue > 0 ? { type: discountType, value: Number(discountValue) } : null;
    const taxRate = settings.tax_enabled ? settings.tax_rate ?? 0 : 0;
    const base = breakdown.itemAmount + breakdown.serviceAmount;
    const afterDiscount =
      discount?.type === 'PERCENT'
        ? base * (1 - Math.min(discount.value, 100) / 100)
        : discount?.type === 'FIXED'
          ? Math.max(base - discount.value, 0)
          : base;
    return Math.round(afterDiscount * (1 + taxRate / 100) * 100) / 100;
  }, [breakdown, discountType, discountValue, settings.tax_enabled, settings.tax_rate]);

  // what the bill would be without the edit
  const timerTotal = breakdown
    ? computeBillTotals(
        breakdown.computedGamingAmount,
        breakdown.itemAmount,
        breakdown.serviceAmount,
        discountType && discountValue > 0 ? { type: discountType, value: Number(discountValue) } : null,
        breakdown.taxRate
      ).total
    : 0;

  const draftValue = Number(totalDraft);
  const draftError =
    totalDraft.trim() === '' || !Number.isFinite(draftValue)
      ? 'Enter an amount'
      : draftValue < minTotal
        ? `Can't be less than ${formatMoney(minTotal, settings.currency_symbol || '₹')} (food & services)`
        : null;

  function startEditTotal() {
    if (!breakdown) return;
    setTotalDraft(String(finalTotal ?? breakdown.total));
    setEditingTotal(true);
  }
  function applyTotal() {
    if (draftError) return;
    setFinalTotal(Math.round(draftValue * 100) / 100);
    setEditingTotal(false);
  }

  const sym = settings.currency_symbol || '₹';

  async function confirm() {
    setBusy(true);
    try {
      const res = await api.post<{ invoiceId: string; invoiceNumber: string }>(
        `/api/admin/sessions/${session.id}/end`,
        {
          // A null type means "keep the saved discount" server-side, so an
          // explicit "no discount" is sent as FIXED 0 to clear it.
          ...(discountType && Number(discountValue) > 0
            ? { discountType, discountValue: Number(discountValue) }
            : { discountType: 'FIXED' as const, discountValue: 0 }),
          paymentMethod,
          ...(finalTotal != null ? { finalTotal } : {}),
          // optional — only sent when staff changed them here
          ...(name.trim() !== savedName || mobile.trim() !== savedMobile
            ? { customerName: name.trim() || null, customerMobile: mobile.trim() || null }
            : {}),
        }
      );
      toast.success(`Invoice ${res.invoiceNumber} generated`);
      onEnded(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const methodButton = (id: 'CASH' | 'UPI' | 'CARD' | 'OTHER', icon: React.ReactNode, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setPaymentMethod(id)}
      className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
        paymentMethod === id
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border bg-surface-2 text-muted hover:text-content'
      }`}
      aria-pressed={paymentMethod === id}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="End session & generate invoice"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button className="h-10 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-surface-2" onClick={onClose}>
            Cancel
          </button>
          <Button variant="success" loading={busy} onClick={confirm}>
            End &amp; Generate Invoice
          </Button>
        </div>
      }
    >
      {!breakdown ? (
        <p className="py-6 text-center text-sm text-muted">Calculating…</p>
      ) : (
        <div className="space-y-5">
          {/* summary */}
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">{name.trim() || customerLabel(session)}</p>
                <p className="text-xs text-muted">{session.resource_name}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-extrabold tabular-nums text-secondary">
                  {formatDuration(breakdown.elapsedSeconds)}
                </p>
                <p className="text-[11px] text-muted">
                  {session.actual_start_time ? `from ${formatClock(session.actual_start_time, settings.timezone)}` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* bill lines */}
          <div className="space-y-1.5 text-sm">
            <Row
              label={`Gaming (${breakdown.billableMinutes} min${settings.billing_mode !== 'EXACT_MINUTES' ? ', rounded' : ''})`}
              value={formatMoney(breakdown.gamingAmount, sym)}
            />
            {breakdown.gamingAdjusted && (
              <p className="text-[11px] text-warning">
                Adjusted from {formatMoney(breakdown.computedGamingAmount, sym)} (timer) to match the edited total
              </p>
            )}
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              {breakdown.ruleApplied
                ? `${formatMoney(breakdown.ruleApplied.price, sym)}/hr (${breakdown.ruleApplied.name})`
                : rateLabel(session.pricing_plan_snapshot, sym)}
              {session.pricing_plan_snapshot.custom && <CustomPriceBadge />}
              <span>· {billingModeText(settings.billing_mode, settings.min_billing_minutes)}</span>
            </p>
            {breakdown.itemAmount > 0 && <Row label="Food & drinks" value={formatMoney(breakdown.itemAmount, sym)} />}
            {breakdown.serviceAmount > 0 && <Row label="Games & services" value={formatMoney(breakdown.serviceAmount, sym)} />}
            <div className="my-2 border-t border-border" />
            <Row label="Subtotal" value={formatMoney(breakdown.subtotal, sym)} bold />
            {breakdown.discountAmount > 0 && (
              <Row label="Discount" value={`− ${formatMoney(breakdown.discountAmount, sym)}`} tone="text-success" />
            )}
            {breakdown.taxAmount > 0 && (
              <Row label={`${breakdown.taxName ?? 'Tax'} (${breakdown.taxRate}%)`} value={formatMoney(breakdown.taxAmount, sym)} />
            )}
            {editingTotal ? (
              <div className="mt-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
                <label htmlFor="final-total" className="text-xs font-bold uppercase tracking-wide text-muted">
                  Final amount to charge
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-lg font-bold text-muted">{sym}</span>
                  <Input
                    id="final-total"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    autoFocus
                    value={totalDraft}
                    onChange={(e) => setTotalDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyTotal();
                      }
                      if (e.key === 'Escape') setEditingTotal(false);
                    }}
                    className="h-11 flex-1 text-lg font-bold tabular-nums"
                    aria-invalid={!!draftError}
                    aria-describedby="final-total-hint"
                  />
                  <Button size="sm" onClick={applyTotal} disabled={!!draftError}>
                    Apply
                  </Button>
                  <button
                    type="button"
                    className="h-9 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-surface-2"
                    onClick={() => setEditingTotal(false)}
                  >
                    Cancel
                  </button>
                </div>
                <p id="final-total-hint" className={`mt-1.5 text-[11px] ${draftError && totalDraft ? 'text-danger' : 'text-muted'}`}>
                  {draftError && totalDraft
                    ? draftError
                    : `Timer bill: ${formatMoney(timerTotal, sym)}. The gaming charge is adjusted so the invoice equals this amount.`}
                </p>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-primary/20 to-secondary/20 px-4 py-3">
                <span className="font-bold">TOTAL</span>
                <div className="flex items-center gap-2">
                  {finalTotal != null && (
                    <button
                      type="button"
                      onClick={() => setFinalTotal(null)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-muted hover:bg-surface-2"
                      title="Use the timer amount"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden /> Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={startEditTotal}
                    className="group flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2"
                    aria-label={`Edit total, currently ${formatMoney(breakdown.total, sym)}`}
                  >
                    <span className="text-xl font-extrabold tabular-nums">{formatMoney(breakdown.total, sym)}</span>
                    <Pencil className="h-4 w-4 text-muted group-hover:text-content" aria-hidden />
                  </button>
                </div>
              </div>
            )}
            {finalTotal != null && !editingTotal && (
              <p className="text-right text-[11px] font-semibold text-warning">
                Edited · timer bill was {formatMoney(timerTotal, sym)}
              </p>
            )}
          </div>

          {/* customer (optional) */}
          <div>
            <p className="label-base">Customer <span className="font-normal normal-case text-muted">(optional)</span></p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Walk-in"
                  aria-label="Customer name"
                  className="pl-10"
                  maxLength={120}
                  autoComplete="off"
                />
              </div>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="Mobile"
                  inputMode="tel"
                  aria-label="Customer mobile"
                  className="pl-10"
                  maxLength={20}
                  autoComplete="off"
                />
              </div>
            </div>
            {mobile.trim() && !looksLikeMobile(mobile) && (
              <p className="mt-1 text-xs text-warning">Looks like an incomplete number</p>
            )}
          </div>

          {/* discount */}
          <div>
            <p className="label-base">Discount</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-xl border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType(discountType === 'PERCENT' ? null : 'PERCENT');
                    setDiscountValue(0);
                  }}
                  className={`flex items-center gap-1 px-3 py-2.5 text-xs font-bold ${discountType === 'PERCENT' ? 'bg-primary text-white' : 'bg-surface-2 text-muted'}`}
                  aria-pressed={discountType === 'PERCENT'}
                >
                  <Percent className="h-3.5 w-3.5" /> %
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType(discountType === 'FIXED' ? null : 'FIXED');
                    setDiscountValue(0);
                  }}
                  className={`flex items-center gap-1 px-3 py-2.5 text-xs font-bold ${discountType === 'FIXED' ? 'bg-primary text-white' : 'bg-surface-2 text-muted'}`}
                  aria-pressed={discountType === 'FIXED'}
                >
                  <IndianRupee className="h-3.5 w-3.5" /> {sym}
                </button>
              </div>
              {discountType && (
                <Input
                  type="number"
                  min={0}
                  max={discountType === 'PERCENT' ? 100 : undefined}
                  value={discountValue || ''}
                  onChange={(e) => setDiscountValue(Number(e.target.value))}
                  placeholder={discountType === 'PERCENT' ? 'e.g. 10' : `e.g. 50`}
                  className="w-28"
                  aria-label="Discount value"
                />
              )}
              {!discountType && <span className="text-xs text-muted">No discount</span>}
            </div>
          </div>

          {/* payment */}
          <div>
            <p className="label-base">Payment</p>
            <div className="grid grid-cols-5 gap-2">
              {methodButton('CASH', <Banknote className="h-5 w-5" />, 'Cash')}
              {methodButton('UPI', <Smartphone className="h-5 w-5" />, 'UPI')}
              {methodButton('CARD', <CreditCard className="h-5 w-5" />, 'Card')}
              {methodButton('OTHER', <Wallet className="h-5 w-5" />, 'Other')}
              <button
                type="button"
                onClick={() => setPaymentMethod(null)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[11px] font-bold transition-colors ${
                  paymentMethod === null
                    ? 'border-warning bg-warning/15 text-warning'
                    : 'border-border bg-surface-2 text-muted hover:text-content'
                }`}
                aria-pressed={paymentMethod === null}
              >
                <Wallet className="h-5 w-5" />
                Pay later
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? 'font-bold' : 'text-muted'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${tone ?? ''}`}>{value}</span>
    </div>
  );
}
