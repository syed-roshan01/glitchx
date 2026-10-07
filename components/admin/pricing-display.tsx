// ============================================================
// Shared display helpers for session pricing + walk-in names.
// Pure presentation — all math stays in lib/billing/engine.ts.
// ============================================================

import { formatMoney } from '@/lib/billing/format';
import type { BillingMode, BillingType, PlanSnapshot, PricingPlan, Resource, Session } from '@/types';

/** "Walk-in" when no customer details have been added yet. */
export function customerLabel(s: { customer_name?: string | null; guest_name?: string | null } | null | undefined): string {
  const name = (s?.customer_name ?? s?.guest_name ?? '').trim();
  return name || 'Walk-in';
}

export function customerMobile(s: { customer_mobile?: string | null; guest_mobile?: string | null } | null | undefined): string | null {
  const m = (s?.customer_mobile ?? s?.guest_mobile ?? '').trim();
  return m || null;
}

/** "Rahul · 98765 43210" / "Walk-in" */
export function customerLine(s: Session): string {
  const m = customerMobile(s);
  return m ? `${customerLabel(s)} · ${m}` : customerLabel(s);
}

/** Unit label next to the editable price input. */
export function priceUnitLabel(billingType: BillingType, durationMinutes: number | null): string {
  switch (billingType) {
    case 'HOURLY':
      return '/ hour';
    case 'PER_MINUTE':
      return '/ min';
    case 'PACKAGE':
      return durationMinutes ? `package price (${durationMinutes} min)` : 'package price';
    case 'FIXED':
    default:
      return 'flat';
  }
}

/** "₹150/hr", "₹2/min", "₹180 for 120 min", "₹100 flat" */
export function rateLabel(
  plan: Pick<PlanSnapshot, 'billing_type' | 'price' | 'duration_minutes'>,
  sym = '₹'
): string {
  const p = formatMoney(plan.price, sym);
  switch (plan.billing_type) {
    case 'HOURLY':
      return `${p}/hr`;
    case 'PER_MINUTE':
      return `${p}/min`;
    case 'PACKAGE':
      return plan.duration_minutes ? `${p} for ${plan.duration_minutes} min` : `${p} package`;
    case 'FIXED':
    default:
      return `${p} flat`;
  }
}

/** Short explanation of the cafe's rounding policy. */
export function billingModeText(mode: BillingMode, minBillingMinutes = 0): string {
  const base =
    mode === 'ROUND_UP_15'
      ? 'billed in 15-min steps'
      : mode === 'ROUND_UP_30'
        ? 'billed in 30-min steps'
        : mode === 'ROUND_UP_60'
          ? 'billed per started hour'
          : 'billed by the exact minute';
  return minBillingMinutes > 0 ? `${base} · min ${minBillingMinutes} min` : base;
}

/** Longer explanation for the quick-start screen. */
export function billingModeExplainer(mode: BillingMode): string {
  switch (mode) {
    case 'ROUND_UP_15':
      return 'Time is rounded up to the next 15 minutes (e.g. 52 min → 60 min).';
    case 'ROUND_UP_30':
      return 'Time is rounded up to the next 30 minutes (e.g. 40 min → 60 min).';
    case 'ROUND_UP_60':
      return 'Every started hour is charged in full (e.g. 61 min → 2 hr).';
    case 'EXACT_MINUTES':
    default:
      return 'Charged for the exact minutes played (e.g. 56 min → 56 min).';
  }
}

/** Default plan for a station: its default plan, else the cheapest active plan of its type. */
export function defaultPlanFor(resource: Resource, plans: PricingPlan[]): PricingPlan | null {
  const own = plans.filter((p) => p.active && p.resource_type === resource.type);
  const def = resource.default_pricing_plan_id
    ? own.find((p) => p.id === resource.default_pricing_plan_id) ??
      plans.find((p) => p.id === resource.default_pricing_plan_id && p.active)
    : undefined;
  if (def) return def;
  return own.slice().sort((a, b) => a.price - b.price)[0] ?? null;
}

/** Light, non-blocking mobile check (7–15 digits). */
export function looksLikeMobile(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function CustomPriceBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-warning ${className}`}
    >
      custom price
    </span>
  );
}
