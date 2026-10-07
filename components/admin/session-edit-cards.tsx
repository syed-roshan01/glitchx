'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/billing/format';
import {
  CustomPriceBadge, customerLabel, customerMobile, looksLikeMobile, priceUnitLabel, rateLabel,
} from '@/components/admin/pricing-display';
import type { Session } from '@/types';
import { User, Phone, Pencil, RotateCcw } from 'lucide-react';

type SessionUpdater = (s: Session) => Session;

/** Inline name + mobile editor. Works for live AND completed sessions. */
export function CustomerCard({
  session,
  onOptimistic,
  onSaved,
}: {
  session: Session;
  onOptimistic: (fn: SessionUpdater) => () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const savedName = (session.customer_name ?? session.guest_name ?? '').trim();
  const savedMobile = customerMobile(session) ?? '';
  const [name, setName] = useState(savedName);
  const [mobile, setMobile] = useState(savedMobile);
  const [busy, setBusy] = useState(false);

  // re-sync when the server copy changes (realtime / reload)
  useEffect(() => setName(savedName), [savedName]);
  useEffect(() => setMobile(savedMobile), [savedMobile]);

  const dirty = name.trim() !== savedName || mobile.trim() !== savedMobile;
  const mobileHint = mobile.trim() && !looksLikeMobile(mobile) ? 'Looks like an incomplete number' : '';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    const n = name.trim() || null;
    const m = mobile.trim() || null;
    setBusy(true);
    const rollback = onOptimistic((s) => ({
      ...s,
      customer_name: n,
      customer_mobile: m,
      guest_name: n,
      guest_mobile: m,
    }));
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, { action: 'customer', name: n, mobile: m });
      toast.success(session.status === 'COMPLETED' ? 'Customer saved — invoice updated' : 'Customer saved');
      onSaved();
    } catch (err: any) {
      rollback();
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="glass rounded-2xl p-5 shadow-card" aria-label="Customer">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Customer</h2>
        {session.customer_id ? (
          <Link href={`/admin/customers/${session.customer_id}`} className="text-xs font-bold text-secondary hover:underline">
            Profile →
          </Link>
        ) : (
          <span className="text-[11px] font-bold uppercase text-muted">{customerLabel(session) === 'Walk-in' ? 'Walk-in' : 'Guest'}</span>
        )}
      </div>
      <div className="space-y-3">
        <div>
          <label htmlFor="cust-name" className="label-base">Name</label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              id="cust-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Walk-in"
              className="h-11 pl-10"
              maxLength={120}
              autoComplete="off"
            />
          </div>
        </div>
        <div>
          <label htmlFor="cust-mobile" className="label-base">Mobile</label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              id="cust-mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="Not added"
              inputMode="tel"
              className="h-11 pl-10"
              maxLength={20}
              autoComplete="off"
            />
          </div>
          <p className="mt-1 min-h-[16px] text-xs text-warning">{mobileHint}</p>
        </div>
        <Button type="submit" variant={dirty ? 'primary' : 'outline'} disabled={!dirty} loading={busy} className="w-full">
          Save customer
        </Button>
      </div>
    </form>
  );
}

/** Rate shown + editable while the session is live or scheduled. */
export function PriceCard({
  session,
  sym,
  editable,
  onOptimistic,
  onSaved,
}: {
  session: Session;
  sym: string;
  editable: boolean;
  onOptimistic: (fn: SessionUpdater) => () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const snap = session.pricing_plan_snapshot;
  const basePrice = snap.custom && snap.base_price != null ? snap.base_price : snap.price;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(snap.price));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(snap.price));
  }, [snap.price, editing]);

  const value = text.trim() === '' ? NaN : Number(text);
  const valid = Number.isFinite(value) && value >= 0 && value <= 100000;
  const changed = valid && Math.abs(value - snap.price) > 0.0001;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    const rollback = onOptimistic((s) => ({
      ...s,
      pricing_plan_snapshot: {
        ...s.pricing_plan_snapshot,
        price: value,
        custom: Math.abs(value - basePrice) > 0.0001,
        base_price: basePrice,
      },
    }));
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, { action: 'rate', price: value });
      toast.success('Price updated for the whole session');
      setEditing(false);
      onSaved();
    } catch (err: any) {
      rollback();
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-5 shadow-card" aria-label="Price">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Price</h2>
        {snap.custom && <CustomPriceBadge />}
      </div>
      <p className="text-xl font-extrabold tabular-nums">{rateLabel(snap, sym)}</p>
      <p className="text-xs text-muted">
        {snap.name}
        {snap.custom && basePrice !== snap.price ? ` · plan price ${formatMoney(basePrice, sym)}` : ''}
      </p>

      {editable &&
        (editing ? (
          <form onSubmit={save} className="mt-3 space-y-2">
            <label htmlFor="rate-input" className="label-base">New price</label>
            <div className="flex items-center gap-2">
              <div className="relative w-36">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted" aria-hidden>
                  {sym}
                </span>
                <Input
                  id="rate-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  invalid={!valid}
                  className="h-11 pl-9 font-bold tabular-nums"
                  autoFocus
                />
              </div>
              <span className="text-xs font-semibold text-muted">{priceUnitLabel(snap.billing_type, snap.duration_minutes)}</span>
            </div>
            <p className="text-xs font-semibold text-warning">Applies to the whole session — the bill is recalculated from the start.</p>
            {Math.abs(basePrice - (valid ? value : basePrice)) > 0.0001 && (
              <button
                type="button"
                onClick={() => setText(String(basePrice))}
                className="inline-flex min-h-[32px] items-center gap-1 text-xs font-bold text-secondary hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> use plan price {formatMoney(basePrice, sym)}
              </button>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setText(String(snap.price)); }}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!changed} className="flex-1">
                Update price
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className="mt-3 w-full" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit price
          </Button>
        ))}
    </div>
  );
}
