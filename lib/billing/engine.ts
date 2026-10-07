// ============================================================
// BILLING ENGINE — the single source of truth for billing math.
//
// Pure functions, usable on both the server (authoritative, inside
// route handlers with the service-role client) and the client
// (live timer previews). Database timestamps are always the input;
// the frontend clock is used only for display.
//
// The final, authoritative arithmetic when ENDING a session is
// performed transactionally by the admin_end_session_and_invoice
// SQL function using these same formulas.
// ============================================================

import type { BillingMode, BillingType, DiscountType } from '@/types';

export interface PlanSnapshot {
  name: string;
  billing_type: BillingType;
  price: number;
  duration_minutes: number | null;
  /** staff-entered price for this session — peak-hour rules never override it */
  custom?: boolean;
  base_price?: number;
}

export interface RateRule {
  id: string;
  name: string;
  resource_id: string | null;
  resource_type: string | null;
  days_of_week: number[];
  start_time: string; // "HH:MM:SS"
  end_time: string;
  price: number; // hourly override
  priority: number;
}

export interface RateContext {
  resourceId: string;
  resourceType: string;
  startTimestamp: string | number | Date;
  timeZone?: string;
}

export interface SessionTiming {
  actual_start_time: string;
  paused_at: string | null;
  total_paused_seconds: number;
}

export interface BillingBreakdown {
  elapsedSeconds: number;
  billableMinutes: number;
  perMinute: number;
  ruleApplied: RateRule | null;
  gamingAmount: number;
  itemAmount: number;
  serviceAmount: number;
  subtotal: number;
  discountAmount: number;
  taxName: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const ROUND_UNITS: Record<BillingMode, number> = {
  EXACT_MINUTES: 1,
  ROUND_UP_15: 15,
  ROUND_UP_30: 30,
  ROUND_UP_60: 60,
};

/** Apply the cafe's rounding policy to raw elapsed seconds. */
export function roundBillableMinutes(
  elapsedSeconds: number,
  mode: BillingMode,
  minBillingMinutes = 0
): number {
  if (elapsedSeconds <= 0) return 0;
  const unit = ROUND_UNITS[mode] ?? 1;
  const minutes = Math.ceil(elapsedSeconds / 60 / unit) * unit;
  return Math.max(minutes, minBillingMinutes, 1);
}

/** Local day-of-week and minutes-of-day for a timestamp in the cafe's timezone. */
export function zonedParts(
  date: Date,
  timeZone = 'Asia/Kolkata'
): { day: number; minutes: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0; // some environments emit 24 with h23
    return {
      day: Math.max(0, days.indexOf(parts.weekday ?? 'Sun')),
      minutes: hour * 60 + Number(parts.minute ?? 0),
    };
  } catch {
    // invalid timezone → fall back to local time
    return {
      day: date.getDay(),
      minutes: date.getHours() * 60 + date.getMinutes(),
    };
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Most specific active rule wins: resource > resource type > global; then priority. */
export function matchPricingRule(rules: RateRule[], ctx: RateContext): RateRule | null {
  const start = new Date(ctx.startTimestamp);
  const { day, minutes } = zonedParts(start, ctx.timeZone);

  const eligible = rules.filter(
    (r) =>
      (!r.resource_id || r.resource_id === ctx.resourceId) &&
      (!r.resource_type || r.resource_type === ctx.resourceType) &&
      (r.days_of_week?.length ? r.days_of_week : [0, 1, 2, 3, 4, 5, 6]).includes(day) &&
      timeToMinutes(r.start_time) <= minutes &&
      minutes < timeToMinutes(r.end_time)
  );
  if (eligible.length === 0) return null;

  const score = (r: RateRule) => {
    let specificity = 0;
    if (r.resource_id) specificity = 3;
    else if (r.resource_type) specificity = 2;
    else specificity = 1;
    return specificity * 1000 + (r.priority ?? 0);
  };

  return eligible.reduce((best, r) => (score(r) > score(best) ? r : best));
}

/** Base per-minute rate implied by the plan. */
export function basePerMinuteRate(plan: PlanSnapshot): number {
  switch (plan.billing_type) {
    case 'HOURLY':
      return plan.price / 60;
    case 'PER_MINUTE':
      return plan.price;
    case 'PACKAGE':
    case 'FIXED':
    default:
      return plan.duration_minutes ? plan.price / plan.duration_minutes : plan.price / 60;
  }
}

export interface ResolvedRate {
  perMinute: number;
  ruleApplied: RateRule | null;
}

/** Effective per-minute rate: peak rule override if one matches at session start. */
export function resolveRate(
  plan: PlanSnapshot,
  rules: RateRule[] | undefined,
  ctx: RateContext
): ResolvedRate {
  const rule = !plan.custom && rules && rules.length > 0 ? matchPricingRule(rules, ctx) : null;
  if (rule) return { perMinute: rule.price / 60, ruleApplied: rule };
  return { perMinute: basePerMinuteRate(plan), ruleApplied: null };
}

export interface GamingCharge {
  amount: number;
  perMinute: number;
  ruleApplied: RateRule | null;
}

/** Gaming charge for a given number of billable minutes. */
export function computeGamingCharge(
  plan: PlanSnapshot,
  rules: RateRule[] | undefined,
  ctx: RateContext,
  billableMinutes: number
): GamingCharge {
  if (billableMinutes <= 0) {
    return { amount: 0, perMinute: 0, ruleApplied: null };
  }
  const { perMinute, ruleApplied } = resolveRate(plan, rules, ctx);

  if (plan.billing_type === 'FIXED') {
    return { amount: round2(plan.price), perMinute, ruleApplied };
  }

  if (plan.billing_type === 'PACKAGE' && plan.duration_minutes) {
    const pkgMinutes = plan.duration_minutes;
    const extraMinutes = Math.max(billableMinutes - pkgMinutes, 0);
    const extra = ruleApplied ? extraMinutes * (ruleApplied.price / 60) : extraMinutes * (plan.price / pkgMinutes);
    return { amount: round2(plan.price + extra), perMinute, ruleApplied };
  }

  return { amount: round2(perMinute * billableMinutes), perMinute, ruleApplied };
}

/** Raw elapsed billable seconds, excluding paused time (handles live pause). */
export function liveElapsedSeconds(timing: SessionTiming, now: Date = new Date()): number {
  const start = new Date(timing.actual_start_time).getTime();
  let paused = timing.total_paused_seconds || 0;
  if (timing.paused_at) {
    paused += Math.max(0, (now.getTime() - new Date(timing.paused_at).getTime()) / 1000);
  }
  return Math.max(0, (now.getTime() - start) / 1000 - paused);
}

/**
 * Price estimate for a planned duration (no peak rules). Applies the SAME
 * rounding policy as the final bill, so an estimate never differs from what
 * the timer will charge for that duration (e.g. 56 min at ROUND_UP_15 is
 * billed as 60 min). Without a billing mode it charges exact minutes.
 */
export function estimateBookingAmount(
  plan: PlanSnapshot | null,
  durationMinutes: number,
  billingMode: BillingMode = 'EXACT_MINUTES',
  minBillingMinutes = 0
): number {
  if (!plan || durationMinutes <= 0) return 0;
  const billable = roundBillableMinutes(durationMinutes * 60, billingMode, minBillingMinutes);
  return computeGamingCharge(
    plan,
    undefined,
    { resourceId: '', resourceType: '', startTimestamp: 0 },
    billable
  ).amount;
}

export interface BreakdownArgs {
  plan: PlanSnapshot;
  rules?: RateRule[];
  billingMode: BillingMode;
  minBillingMinutes?: number;
  timeZone?: string;
  resourceId: string;
  resourceType: string;
  timing: SessionTiming;
  endAt?: Date;
  itemAmount?: number;
  serviceAmount?: number;
  discount?: { type: DiscountType; value: number } | null;
  tax?: { enabled: boolean; name?: string | null; rate?: number | null } | null;
}

/** Full session bill — used for the live "current amount", the
 *  end-session confirmation screen, and (server-side) the final
 *  amounts handed to the invoice transaction. */
export function calculateSessionBreakdown(args: BreakdownArgs): BillingBreakdown {
  const end = args.endAt ?? new Date();
  const elapsedSeconds = liveElapsedSeconds(args.timing, end);
  const billableMinutes = roundBillableMinutes(
    elapsedSeconds,
    args.billingMode,
    args.minBillingMinutes ?? 0
  );

  const gaming = computeGamingCharge(args.plan, args.rules, {
    resourceId: args.resourceId,
    resourceType: args.resourceType,
    startTimestamp: args.timing.actual_start_time,
    timeZone: args.timeZone,
  }, billableMinutes);

  const itemAmount = round2(args.itemAmount ?? 0);
  const serviceAmount = round2(args.serviceAmount ?? 0);
  const subtotal = round2(gaming.amount + itemAmount + serviceAmount);

  let discountAmount = 0;
  if (args.discount && args.discount.value > 0) {
    discountAmount =
      args.discount.type === 'PERCENT'
        ? round2((subtotal * Math.min(args.discount.value, 100)) / 100)
        : Math.min(round2(args.discount.value), subtotal);
  }

  const taxEnabled = args.tax?.enabled ?? false;
  const taxRate = taxEnabled ? args.tax?.rate ?? 0 : 0;
  const taxAmount = round2(((subtotal - discountAmount) * taxRate) / 100);
  const total = round2(Math.max(subtotal - discountAmount + taxAmount, 0));

  return {
    elapsedSeconds,
    billableMinutes,
    perMinute: gaming.perMinute,
    ruleApplied: gaming.ruleApplied,
    gamingAmount: gaming.amount,
    itemAmount,
    serviceAmount,
    subtotal,
    discountAmount,
    taxName: taxEnabled ? args.tax?.name ?? null : null,
    taxRate,
    taxAmount,
    total,
  };
}
