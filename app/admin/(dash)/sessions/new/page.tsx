'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useApi, invalidate, seed } from '@/lib/use-api';
import { useSettings } from '@/components/admin/admin-context';
import { PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { formatMoney, formatMinutes, toLocalInputValue } from '@/lib/billing/format';
import { estimateBookingAmount } from '@/lib/billing/engine';
import {
  billingModeExplainer, billingModeText, CustomPriceBadge, customerLabel, defaultPlanFor,
  looksLikeMobile, priceUnitLabel, rateLabel,
} from '@/components/admin/pricing-display';
import type { Customer, PlanSnapshot, PricingPlan, Resource, Session } from '@/types';
import {
  Timer, ChevronDown, Gamepad2, User, Phone, X, Check, Zap, Clock, CalendarClock, Info, RotateCcw,
} from 'lucide-react';

type StartMode = 'now' | '+5' | '+10' | 'custom';

const clampMinutes = (m: number) => Math.min(480, Math.max(15, Math.round(m)));

/**
 * Quick start: tap a free station → "Start timer". The station's default
 * plan price is pre-filled and editable; customer details are optional and
 * can be added later from the session screen.
 */
export default function NewSessionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const settings = useSettings();
  const sym = settings.currency_symbol || '₹';

  // ---- data
  const { data: resData, reload: reloadResources } = useApi<{ resources: Resource[] }>('/api/admin/resources');
  const { data: planData } = useApi<{ plans: PricingPlan[] }>('/api/admin/pricing/plans');
  const { data: liveData, reload: reloadLive } = useApi<{ sessions: Session[] }>(
    '/api/admin/sessions?status=live&limit=50'
  );
  const resources = useMemo(() => (resData?.resources ?? []).filter((r) => r.active), [resData]);
  const plans = useMemo(() => planData?.plans ?? [], [planData]);
  const liveByResource = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of liveData?.sessions ?? []) m.set(s.resource_id, s);
    return m;
  }, [liveData]);

  const refetch = useDebouncedCallback(() => {
    reloadResources();
    reloadLive();
  }, 400);
  useRealtime('resources', refetch);
  useRealtime('sessions', refetch);

  // ---- selection
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');

  // ---- optional customer
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);

  // ---- more options
  const [moreOpen, setMoreOpen] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>('now');
  const [customTime, setCustomTime] = useState('');
  const [expectedMinutes, setExpectedMinutes] = useState<number | null>(null);

  const [starting, setStarting] = useState(false);

  // ---- hand-off params (?resourceId= / waitlist: customerId, durationMinutes)
  useEffect(() => {
    const rid = params.get('resourceId');
    if (rid) setResourceId(rid);
    const dur = Number(params.get('durationMinutes'));
    if (dur > 0) setExpectedMinutes(clampMinutes(dur));
    const cid = params.get('customerId');
    if (!cid) return;
    let cancelled = false;
    setCustomerOpen(true);
    api
      .get<{ customer: Customer }>(`/api/admin/customers/${encodeURIComponent(cid)}`)
      .then((r) => {
        if (!cancelled) setCustomer(r.customer);
      })
      .catch((e: any) => {
        if (!cancelled) toast.error(`Could not load customer: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const resource = resources.find((r) => r.id === resourceId) ?? null;
  const resourceFree =
    !!resource &&
    resource.status === 'ACTIVE' &&
    resource.current_status !== 'MAINTENANCE' &&
    resource.current_status !== 'BUSY' &&
    !liveByResource.has(resource.id);
  const resourcePlans = useMemo(() => {
    if (!resource) return [];
    const own = plans.filter((p) => p.active && p.resource_type === resource.type);
    const def = defaultPlanFor(resource, plans);
    return def && !own.some((p) => p.id === def.id) ? [def, ...own] : own;
  }, [plans, resource]);
  const plan = resourcePlans.find((p) => p.id === planId) ?? null;

  function applyPlan(p: PricingPlan | null) {
    setPlanId(p?.id ?? null);
    setPriceText(p ? String(p.price) : '');
  }

  function selectResource(r: Resource) {
    setResourceId(r.id);
    applyPlan(defaultPlanFor(r, plans));
  }

  // preselected station (query param) or plans arriving after a tap → fill default plan
  useEffect(() => {
    if (resource && !planId && plans.length) applyPlan(defaultPlanFor(resource, plans));
  }, [resource, plans, planId]);

  // ---- price
  const parsedPrice = priceText.trim() === '' ? NaN : Number(priceText);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0 && parsedPrice <= 100000;
  const isCustom = !!plan && priceValid && Math.abs(parsedPrice - plan.price) > 0.0001;
  const pricedPlan: PlanSnapshot | null =
    plan && priceValid
      ? { name: plan.name, billing_type: plan.billing_type, price: parsedPrice, duration_minutes: plan.duration_minutes }
      : null;
  const est = (min: number) =>
    pricedPlan ? estimateBookingAmount(pricedPlan, min, settings.billing_mode, settings.min_billing_minutes) : 0;

  // ---- start time
  const offsetMinutes = startMode === '+5' ? 5 : startMode === '+10' ? 10 : 0;
  const customDate = startMode === 'custom' && customTime ? new Date(customTime) : null;
  const isScheduled =
    offsetMinutes > 0 ||
    (!!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now() + 60_000);
  const scheduledMinutes = expectedMinutes ?? plan?.duration_minutes ?? 60;

  function resolveStartTime(): Date {
    const now = new Date();
    if (offsetMinutes > 0) return new Date(now.getTime() + offsetMinutes * 60000);
    if (customDate && !Number.isNaN(customDate.getTime())) return customDate;
    return now;
  }

  // ---- existing-customer suggestions (optional, never required)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    const digits = mobile.replace(/\D/g, '');
    const q = digits.length >= 4 ? digits : name.trim().length >= 2 ? name.trim() : '';
    if (!q || customer) {
      setSuggestions([]);
      return;
    }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await api.get<{ customers: Customer[] }>(
          `/api/admin/customers?q=${encodeURIComponent(q)}&limit=4`
        );
        setSuggestions(res.customers);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }, [name, mobile, customer]);

  const mobileHint = mobile.trim() && !looksLikeMobile(mobile) ? 'Looks short — check the number (you can fix it later)' : '';
  const canStart = resourceFree && !!plan && priceValid && !starting;
  // set when the station is held by a live session (usually PAUSED) —
  // shown inline with a one-click escape instead of a bare toast
  const [blockedBy, setBlockedBy] = useState<{ id: string; status: string } | null>(null);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    if (!resource || !resourceFree || !plan || !priceValid || starting) return;
    setStarting(true);
    setBlockedBy(null);
    try {
      const body: Record<string, unknown> = {
        resourceId: resource.id,
        pricingPlanId: plan.id,
      };
      if (isCustom) body.customPrice = parsedPrice;
      if (customer) body.customerId = customer.id;
      else {
        if (name.trim()) body.guestName = name.trim();
        if (mobile.trim()) body.guestMobile = mobile.trim();
      }
      if (isScheduled) {
        body.startTime = resolveStartTime().toISOString();
        body.expectedMinutes = clampMinutes(scheduledMinutes);
      } else if (expectedMinutes) {
        body.expectedMinutes = clampMinutes(expectedMinutes);
      }

      const res = await api.post<{ id: string; session?: Session }>('/api/admin/sessions', body);
      // Seed the detail page so the timer renders the instant we land
      // (the full detail still loads in the background).
      if (res.session) {
        seed(`/api/admin/sessions/${res.id}`, { session: res.session, items: [], rules: [] });
      }
      invalidate('/api/admin/sessions');
      invalidate('/api/admin/dashboard');
      invalidate('/api/admin/resources');
      toast.success(isScheduled ? 'Session scheduled' : 'Timer started');
      router.push(`/admin/sessions/${res.id}`);
      // keep the button busy until the route changes (no double starts)
    } catch (err: any) {
      if (err?.blockedBy?.id) {
        setBlockedBy(err.blockedBy);
        toast.error(err.message);
      } else {
        toast.error(err.message);
      }
      setStarting(false);
    }
  }

  const loadingStations = !resData;

  return (
    <form className="mx-auto max-w-3xl pb-4" onSubmit={start}>
      <PageHeader title="New session" subtitle="Tap a station, then Start timer. Customer details are optional." />

      {/* 1 — stations */}
      <section aria-label="Stations" className="mb-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {loadingStations &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-border bg-surface-2/60" />
            ))}
          {resources.map((r) => {
            const live = liveByResource.get(r.id);
            const maintenance = r.status !== 'ACTIVE' || r.current_status === 'MAINTENANCE';
            const busy = !maintenance && (r.current_status === 'BUSY' || !!live);
            const selected = resourceId === r.id;
            const def = defaultPlanFor(r, plans);
            const statusText = maintenance ? 'Maintenance' : busy ? 'Busy' : r.current_status === 'RESERVED' ? 'Reserved soon' : 'Free';
            const statusTone = maintenance ? 'text-muted' : busy ? 'text-danger' : r.current_status === 'RESERVED' ? 'text-warning' : 'text-success';

            const inner = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-base font-extrabold">{r.name}</p>
                  {selected && <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden />}
                </div>
                <p className="truncate text-[11px] text-muted">{r.type.replace(/_/g, ' ')}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-extrabold uppercase tracking-wide ${statusTone}`}>
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" aria-hidden />
                    {statusText}
                  </span>
                  {def && !busy && !maintenance && (
                    <span className="truncate text-xs font-bold text-secondary">{rateLabel(def, sym)}</span>
                  )}
                </div>
                {busy && (
                  <p className="mt-1 truncate text-[11px] font-bold text-secondary">
                    {live ? `${customerLabel(live)} · open timer →` : 'In use'}
                  </p>
                )}
              </>
            );

            const base = 'block min-h-[104px] rounded-2xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
            if (busy && live) {
              return (
                <Link
                  key={r.id}
                  href={`/admin/sessions/${live.id}`}
                  className={`${base} border-danger/30 bg-danger/5 hover:border-danger/50`}
                  aria-label={`${r.name} is busy — open its live session`}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={r.id}
                type="button"
                disabled={busy || maintenance}
                onClick={() => selectResource(r)}
                aria-pressed={selected}
                className={`${base} ${
                  selected
                    ? 'border-primary bg-primary/15 shadow-glow-sm'
                    : busy || maintenance
                      ? 'cursor-not-allowed border-border bg-surface-2/50 opacity-50'
                      : 'border-border bg-surface-2 hover:border-primary/40 active:scale-[0.98]'
                }`}
              >
                {inner}
              </button>
            );
          })}
        </div>
        {!loadingStations && resources.length === 0 && (
          <p className="glass rounded-2xl p-4 text-center text-sm text-muted">
            No stations yet — add one under Resources.
          </p>
        )}
      </section>

      {/* 2 — price */}
      {resource && (
        <section className="glass mb-4 rounded-2xl p-4 shadow-card sm:p-5" aria-label="Price">
          <div className="mb-3 flex items-center gap-2">
            <Gamepad2 className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-bold">{resource.name} · price</h2>
          </div>

          {resourcePlans.length === 0 ? (
            <p className="text-sm text-muted">
              No active pricing plan for {resource.type.replace(/_/g, ' ')}. Add one under Pricing first.
            </p>
          ) : (
            <>
              {resourcePlans.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Pricing plan">
                  {resourcePlans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={planId === p.id}
                      onClick={() => applyPlan(p)}
                      className={`min-h-[40px] rounded-full border px-3.5 text-xs font-bold transition-colors ${
                        planId === p.id
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-surface-2 text-muted hover:text-content'
                      }`}
                    >
                      {p.name} · {rateLabel(p, sym)}
                    </button>
                  ))}
                </div>
              )}

              {plan && (
                <>
                  <label htmlFor="session-price" className="label-base">
                    Price for this session
                  </label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="relative w-40">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted">
                        {sym}
                      </span>
                      <Input
                        id="session-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={priceText}
                        onChange={(e) => setPriceText(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        invalid={!priceValid}
                        className="h-12 pl-8 text-lg font-extrabold tabular-nums"
                      />
                    </div>
                    <span className="text-sm font-semibold text-muted">
                      {priceUnitLabel(plan.billing_type, plan.duration_minutes)}
                    </span>
                    {isCustom && (
                      <span className="flex items-center gap-2">
                        <CustomPriceBadge />
                        <button
                          type="button"
                          onClick={() => setPriceText(String(plan.price))}
                          className="inline-flex min-h-[32px] items-center gap-1 text-xs font-bold text-secondary hover:underline"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden /> reset to {formatMoney(plan.price, sym)}
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 min-h-[16px] text-xs text-danger">{!priceValid ? 'Enter a price (0 or more)' : ''}</p>

                  {pricedPlan && (
                    <div className="mt-1 rounded-xl border border-border bg-surface-2/60 p-3">
                      <p className="text-sm font-bold">
                        <EstimateHeadline plan={pricedPlan} est={est} sym={sym} />
                        <span className="font-normal text-muted">
                          {' '}· {billingModeText(settings.billing_mode, settings.min_billing_minutes)}
                        </span>
                      </p>
                      {(pricedPlan.billing_type === 'HOURLY' || pricedPlan.billing_type === 'PER_MINUTE') && (
                        <p className="mt-1 text-xs tabular-nums text-muted">
                          {[30, 90, 120].map((m, i) => (
                            <span key={m}>
                              {i > 0 && ' · '}
                              {formatMinutes(m)} {formatMoney(est(m), sym)}
                            </span>
                          ))}
                          {expectedMinutes && ![30, 60, 90, 120].includes(expectedMinutes) && (
                            <> · {formatMinutes(expectedMinutes)} {formatMoney(est(expectedMinutes), sym)}</>
                          )}
                        </p>
                      )}
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span>
                          {billingModeExplainer(settings.billing_mode)}
                          {settings.min_billing_minutes > 0 && ` Minimum charge: ${settings.min_billing_minutes} min.`}
                        </span>
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* 3 — customer (optional) */}
      <section className="glass mb-4 rounded-2xl shadow-card" aria-label="Customer (optional)">
        <button
          type="button"
          onClick={() => setCustomerOpen((o) => !o)}
          aria-expanded={customerOpen}
          className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 text-left sm:px-5"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <User className="h-4 w-4 text-muted" aria-hidden />
            Customer <span className="font-normal text-muted">(optional — add later)</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {!customerOpen && (customer || name) && (
              <span className="truncate text-xs font-semibold text-secondary">{customer?.name ?? name}</span>
            )}
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${customerOpen ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>
        {customerOpen && (
          <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">
            {customer ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{customer.name}</p>
                  <p className="truncate text-sm text-muted">{customer.mobile}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCustomer(null)} aria-label="Remove customer">
                  <X className="h-4 w-4" /> Remove
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="guest-name" className="label-base">Name</label>
                    <Input
                      id="guest-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Walk-in"
                      autoComplete="off"
                      maxLength={120}
                    />
                  </div>
                  <div>
                    <label htmlFor="guest-mobile" className="label-base">Mobile</label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                      <Input
                        id="guest-mobile"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="98765 43210"
                        inputMode="tel"
                        autoComplete="off"
                        className="pl-10"
                        maxLength={20}
                        aria-describedby="guest-mobile-hint"
                      />
                    </div>
                    <p id="guest-mobile-hint" className="mt-1 min-h-[16px] text-xs text-warning">{mobileHint}</p>
                  </div>
                </div>
                {suggestions.length > 0 && (
                  <div className="mt-1">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Existing customers</p>
                    <ul className="flex flex-wrap gap-2">
                      {suggestions.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomer(c);
                              setSuggestions([]);
                            }}
                            className="min-h-[40px] rounded-xl border border-border bg-surface-2 px-3 text-left text-xs hover:border-primary/40"
                          >
                            <span className="font-bold">{c.name}</span> <span className="text-muted">{c.mobile}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* 4 — more options (schedule) */}
      <section className="glass mb-4 rounded-2xl shadow-card" aria-label="More options">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 text-left sm:px-5"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
            More options <span className="font-normal text-muted">(start later · expected time)</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {moreOpen && (
          <div className="space-y-3 border-t border-border px-4 pb-4 pt-3 sm:px-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Start time">
              <TimeButton active={startMode === 'now'} onClick={() => setStartMode('now')} icon={<Zap className="h-4 w-4" />} label="Now" />
              <TimeButton active={startMode === '+5'} onClick={() => setStartMode('+5')} icon={<Clock className="h-4 w-4" />} label="In 5 min" />
              <TimeButton active={startMode === '+10'} onClick={() => setStartMode('+10')} icon={<Clock className="h-4 w-4" />} label="In 10 min" />
              <TimeButton
                active={startMode === 'custom'}
                onClick={() => {
                  setStartMode('custom');
                  if (!customTime) setCustomTime(toLocalInputValue(new Date(Date.now() + 30 * 60000)));
                }}
                icon={<CalendarClock className="h-4 w-4" />}
                label="Pick time"
              />
            </div>
            {startMode === 'custom' && (
              <Input
                type="datetime-local"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                aria-label="Start time"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold text-muted" htmlFor="expected-min">
                Expected duration (min){isScheduled ? '' : ' — optional'}
              </label>
              <input
                id="expected-min"
                type="number"
                inputMode="numeric"
                min={15}
                max={480}
                step={15}
                value={isScheduled ? scheduledMinutes : expectedMinutes ?? ''}
                onChange={(e) => setExpectedMinutes(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="—"
                className="input-base w-24"
              />
              {pricedPlan && (isScheduled || expectedMinutes) ? (
                <span className="text-xs text-muted">
                  ≈ {formatMoney(est(isScheduled ? scheduledMinutes : expectedMinutes ?? 0), sym)}
                </span>
              ) : null}
            </div>
            {isScheduled && (
              <p className="rounded-xl border border-secondary/30 bg-secondary/10 p-3 text-xs font-semibold text-secondary">
                The session is SCHEDULED and starts billing automatically at the chosen time.
              </p>
            )}
          </div>
        )}
      </section>

      {/* sticky start bar */}
      <div className="glass sticky bottom-20 z-30 rounded-2xl border-primary/30 p-3 shadow-glow sm:bottom-4 sm:p-4">
        {blockedBy && (
          <div className="mb-2.5 flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-danger">
              {blockedBy.status === 'PAUSED'
                ? 'This station is held by a PAUSED session. Resume it to continue its timer, or end it — then start again.'
                : 'This station already has a running session. End it first.'}
            </p>
            <Link
              href={`/admin/sessions/${blockedBy.id}`}
              className="shrink-0 rounded-xl border border-danger/40 bg-surface px-3 py-2 text-center text-xs font-bold text-danger hover:bg-surface-2"
            >
              Open {blockedBy.status === 'PAUSED' ? 'paused ' : ''}session →
            </Link>
          </div>
        )}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-h-[20px] truncate text-sm">
            {resource && plan && pricedPlan ? (
              <>
                <strong>{resource.name}</strong>
                <span className="text-muted"> · {rateLabel(pricedPlan, sym)}</span>
                {isCustom && <span className="text-warning"> · custom</span>}
                <span className="text-muted"> · {customer?.name || name.trim() || 'Walk-in'}</span>
              </>
            ) : (
              <span className="text-muted">
                {resource && !resourceFree ? `${resource.name} is not free — pick another station` : resource ? 'Set a price to continue' : 'Pick a free station'}
              </span>
            )}
          </p>
          <Button type="submit" size="xl" loading={starting} disabled={!canStart} className="w-full shrink-0 sm:w-auto">
            <Timer className="h-5 w-5" />
            {isScheduled ? 'Schedule session' : 'Start timer'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function EstimateHeadline({ plan, est, sym }: { plan: PlanSnapshot; est: (m: number) => number; sym: string }) {
  switch (plan.billing_type) {
    case 'HOURLY':
    case 'PER_MINUTE':
      return <>1 hr = {formatMoney(est(60), sym)}</>;
    case 'PACKAGE':
      return plan.duration_minutes ? (
        <>
          {formatMinutes(plan.duration_minutes)} = {formatMoney(est(plan.duration_minutes), sym)}
          <span className="font-normal text-muted"> · extra time pro-rata</span>
        </>
      ) : (
        <>Package {formatMoney(plan.price, sym)}</>
      );
    case 'FIXED':
    default:
      return <>Flat {formatMoney(plan.price, sym)} for the session</>;
  }
}

function TimeButton({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
        active ? 'border-primary bg-primary/15 text-primary shadow-glow-sm' : 'border-border bg-surface-2 text-muted hover:text-content'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
