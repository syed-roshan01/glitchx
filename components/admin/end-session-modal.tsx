'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useNow } from '@/hooks/use-now';
import { calculateSessionBreakdown } from '@/lib/billing/engine';
import { formatMoney, formatDuration, formatClock } from '@/lib/billing/format';
import type { CafeSettings, PricingRule, Session, SessionItem } from '@/types';
import { Banknote, Smartphone, CreditCard, Wallet, Percent, IndianRupee } from 'lucide-react';

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

  // Re-sync with the session's saved discount every time the modal opens
  // (or the saved discount changes) so the shown total matches the invoice.
  useEffect(() => {
    if (!open) return;
    setDiscountType(session.discount_type ?? null);
    setDiscountValue(session.discount_value ?? 0);
  }, [open, session.discount_type, session.discount_value]);

  const breakdown = useMemo(() => {
    if (!now || !session.actual_start_time) return null;
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
      discount: discountType && discountValue > 0 ? { type: discountType, value: Number(discountValue) } : null,
      tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
    });
  }, [now, session, items, settings, rules, discountType, discountValue]);

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
                <p className="text-sm font-bold">{session.customer_name}</p>
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
            <Row label={`Gaming (${breakdown.billableMinutes} min${settings.billing_mode !== 'EXACT_MINUTES' ? ', rounded' : ''})`} value={formatMoney(breakdown.gamingAmount, sym)} />
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
            <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-primary/20 to-secondary/20 px-4 py-3">
              <span className="font-bold">TOTAL</span>
              <span className="text-xl font-extrabold tabular-nums">{formatMoney(breakdown.total, sym)}</span>
            </div>
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
