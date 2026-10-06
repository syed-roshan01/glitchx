'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { useNow } from '@/hooks/use-now';
import { calculateSessionBreakdown } from '@/lib/billing/engine';
import { formatMoney, formatDuration, formatClock } from '@/lib/billing/format';
import { AddItemModal } from '@/components/admin/add-item-modal';
import { AddServiceModal } from '@/components/admin/add-service-modal';
import { EndSessionModal } from '@/components/admin/end-session-modal';
import type { CafeSettings, PricingRule, Session, SessionItem } from '@/types';
import { Gamepad2, CupSoda, Sparkles, Pause, Play, Square, Eye, Clock } from 'lucide-react';

/** Live session card — timer and current amount are computed from DB
 *  timestamps via the shared billing engine (never a client-only
 *  counter), so they survive refreshes and stay accurate. */
export function SessionCard({
  session,
  items,
  settings,
  rules,
  onChanged,
}: {
  session: Session;
  items: SessionItem[];
  settings: CafeSettings;
  rules: PricingRule[];
  onChanged: () => void;
}) {
  const now = useNow(1000);
  const [showItems, setShowItems] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const toast = useToast();
  const [pauseBusy, setPauseBusy] = useState(false);
  // Items returned by an add-item/service call are shown immediately, but
  // only until the parent delivers a fresh `items` prop.
  const [localItems, setLocalItems] = useState<SessionItem[] | null>(null);
  useEffect(() => setLocalItems(null), [items]);

  const propItems = useMemo(() => items.filter((i) => i.session_id === session.id), [items, session.id]);
  const activeItems = localItems ?? propItems;

  const breakdown = useMemo(() => {
    if (!session.actual_start_time) return null;
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
      itemAmount: activeItems
        .filter((i) => ['FOOD', 'DRINK', 'OTHER'].includes(i.item_type))
        .reduce((s, i) => s + i.total_price, 0),
      serviceAmount: activeItems
        .filter((i) => ['SERVICE', 'GAME'].includes(i.item_type))
        .reduce((s, i) => s + i.total_price, 0),
      discount:
        session.discount_type && session.discount_value
          ? { type: session.discount_type, value: session.discount_value }
          : null,
      tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
    });
  }, [now, session, activeItems, settings, rules]);

  const sym = settings.currency_symbol || '₹';
  const paused = session.status === 'PAUSED';

  async function togglePause() {
    if (pauseBusy) return;
    setPauseBusy(true);
    try {
      await api.patch(`/api/admin/sessions/${session.id}`, { action: paused ? 'resume' : 'pause' });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || `Could not ${paused ? 'resume' : 'pause'} the session`);
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-5 shadow-card transition-shadow hover:shadow-glow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <h3 className="truncate font-extrabold">{session.resource_name}</h3>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted">
            {session.customer_name} · {session.customer_mobile}
          </p>
        </div>
        <StatusBadge status={session.status} pulse={!paused} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Started</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">
            {formatClock(session.actual_start_time, settings.timezone)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Elapsed</p>
          <p className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-secondary">
            {breakdown ? formatDuration(breakdown.elapsedSeconds) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Current bill</p>
          <p className="mt-0.5 text-sm font-extrabold tabular-nums text-success">
            {breakdown ? formatMoney(breakdown.total, sym) : '—'}
          </p>
        </div>
      </div>

      {breakdown && breakdown.itemAmount + breakdown.serviceAmount > 0 && (
        <button
          className="mt-2 flex w-full items-center justify-between rounded-lg px-1 text-xs text-muted hover:text-content"
          onClick={() => setShowItems((s) => !s)}
        >
          <span>
            Items {formatMoney(breakdown.itemAmount, sym)} · Services {formatMoney(breakdown.serviceAmount, sym)}
          </span>
          <span>{showItems ? 'hide' : 'show'}</span>
        </button>
      )}
      {showItems && (
        <ul className="mt-1.5 space-y-1 rounded-xl border border-border bg-surface-2/60 p-2.5 text-xs">
          {activeItems.map((i) => (
            <li key={i.id} className="flex justify-between">
              <span className="text-muted">
                {i.name_snapshot} × {i.quantity}
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(i.total_price, sym)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
        <Link
          href={`/admin/sessions/${session.id}`}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-2 text-xs font-bold text-muted transition-colors hover:text-content"
        >
          <Eye className="h-3.5 w-3.5" /> View
        </Link>
        <button
          onClick={() => setAddItemOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-2 text-xs font-bold text-muted transition-colors hover:text-content"
        >
          <CupSoda className="h-3.5 w-3.5" /> Item
        </button>
        <button
          onClick={() => setAddServiceOpen(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 px-2 py-2 text-xs font-bold text-muted transition-colors hover:text-content"
        >
          <Sparkles className="h-3.5 w-3.5" /> Game
        </button>
        {settings.pause_enabled ? (
          <button
            onClick={togglePause}
            disabled={pauseBusy}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
              paused
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-surface-2 text-muted hover:text-content'
            }`}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => setEndOpen(true)}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-danger px-3 py-2 text-xs font-bold text-white transition-transform hover:scale-[1.02] active:scale-95 sm:col-span-2"
        >
          <Square className="h-3.5 w-3.5" /> End Session
        </button>
      </div>

      {paused && session.paused_at && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-warning">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Paused since {formatClock(session.paused_at, settings.timezone)} — not billed
        </p>
      )}

      <AddItemModal
        sessionId={session.id}
        open={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onAdded={(items) => {
          setLocalItems(items);
          onChanged();
        }}
      />
      <AddServiceModal
        sessionId={session.id}
        open={addServiceOpen}
        onClose={() => setAddServiceOpen(false)}
        onAdded={(items) => {
          setLocalItems(items);
          onChanged();
        }}
      />
      <EndSessionModal
        session={session}
        items={activeItems}
        settings={settings}
        rules={rules}
        open={endOpen}
        onClose={() => setEndOpen(false)}
        onEnded={() => {
          setEndOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}
