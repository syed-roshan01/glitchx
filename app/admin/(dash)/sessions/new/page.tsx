'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useRealtime } from '@/hooks/use-realtime';
import { formatMoney, toLocalInputValue } from '@/lib/billing/format';
import { estimateBookingAmount } from '@/lib/billing/engine';
import type { CafeSettings, Customer, PricingPlan, Resource } from '@/types';
import { Search, UserPlus, Check, Zap, Clock, CalendarClock, Rocket, Users } from 'lucide-react';

type StartMode = 'now' | '+5' | '+10' | 'custom';

/** Fast walk-in flow: customer → resource → start time → plan → start.
 *  Designed for <15 seconds with a returning customer. */
export default function NewSessionPage() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  // step 1: customer
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [showResults, setShowResults] = useState(false);

  // step 2: resource
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState<string | null>(null);

  // step 3: start time
  const [startMode, setStartMode] = useState<StartMode>('now');
  const [customTime, setCustomTime] = useState('');

  // step 4: plan
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [expectedMinutes, setExpectedMinutes] = useState<number | null>(null);

  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [starting, setStarting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      const [res, planRes, dash] = await Promise.all([
        api.get<{ resources: Resource[] }>('/api/admin/resources'),
        api.get<{ plans: PricingPlan[] }>('/api/admin/pricing/plans'),
        api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
      ]);
      setResources(res.resources);
      setPlans(planRes.plans);
      setSettings(dash.settings);
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const refetchResources = useCallback(() => {
    api.get<{ resources: Resource[] }>('/api/admin/resources').then((r) => setResources(r.resources)).catch(() => {});
  }, []);
  useRealtime('resources', refetchResources);
  useRealtime('sessions', refetchResources);

  // waitlist / prefill via query params
  useEffect(() => {
    const cid = params.get('customerId');
    if (cid) {
      setSelectedCustomer({
        id: cid,
        name: params.get('name') ?? 'Customer',
        mobile: params.get('mobile') ?? '',
        email: null, notes: null, created_by: null, created_at: '', updated_at: '',
      });
    }
    const rid = params.get('resourceId');
    if (rid) setResourceId(rid);
    const dur = params.get('durationMinutes');
    if (dur) setExpectedMinutes(Number(dur));
  }, [params]);

  // debounced customer search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2 || selectedCustomer) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ customers: Customer[] }>(
          `/api/admin/customers?q=${encodeURIComponent(query.trim())}&limit=8`
        );
        setResults(res.customers);
        setShowResults(true);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [query, selectedCustomer]);

  const resource = resources.find((r) => r.id === resourceId);
  const resourcePlans = useMemo(
    () => plans.filter((p) => p.active && p.resource_type === resource?.type),
    [plans, resource]
  );
  const plan = resourcePlans.find((p) => p.id === planId) ?? null;

  const startTime = useMemo(() => {
    const now = new Date();
    if (startMode === 'now') return now;
    if (startMode === '+5') return new Date(now.getTime() + 5 * 60000);
    if (startMode === '+10') return new Date(now.getTime() + 10 * 60000);
    if (customTime) return new Date(customTime);
    return now;
  }, [startMode, customTime]);

  const isScheduled = startTime.getTime() > Date.now() + 60_000;
  const estimate = plan ? estimateBookingAmount(plan, expectedMinutes ?? 60) : null;
  const sym = settings?.currency_symbol || '₹';

  const canStart =
    (selectedCustomer || (newMode && newName.trim().length >= 2 && newMobile.trim().length >= 7)) &&
    resourceId &&
    planId &&
    (!isScheduled || expectedMinutes !== null || plan?.duration_minutes !== null);

  async function start() {
    if (!resourceId || !planId) return;
    setStarting(true);
    try {
      const body: Record<string, unknown> = {
        resourceId,
        pricingPlanId: planId,
        startTime: isScheduled ? startTime.toISOString() : new Date().toISOString(),
        expectedMinutes: isScheduled ? expectedMinutes ?? plan?.duration_minutes ?? 60 : expectedMinutes,
      };
      if (selectedCustomer) body.customerId = selectedCustomer.id;
      else body.newCustomer = { name: newName.trim(), mobile: newMobile.trim() };

      const res = await api.post<{ id: string }>('/api/admin/sessions', body);
      toast.success(isScheduled ? 'Session scheduled' : 'Session started');
      router.push(`/admin/sessions/${res.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Session"
        subtitle="Search the customer, pick a station and start — billing runs automatically."
      />

      {/* STEP 1 — customer */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card" aria-label="Customer">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <StepNumber n={1} /> Customer
        </h2>

        {selectedCustomer ? (
          <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
            <div>
              <p className="font-bold">{selectedCustomer.name}</p>
              <p className="text-sm text-muted">{selectedCustomer.mobile}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedCustomer(null); setQuery(''); }}>
              Change
            </Button>
          </div>
        ) : newMode ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Customer name" autoFocus />
              </Field>
              <Field label="Mobile number" required>
                <Input value={newMobile} onChange={(e) => setNewMobile(e.target.value)} placeholder="9876543210" inputMode="tel" />
              </Field>
            </div>
            <button className="text-xs font-bold text-secondary hover:underline" onClick={() => setNewMode(false)}>
              ← Search existing customer instead
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setShowResults(true)}
              placeholder="Search by name or mobile number…"
              className="pl-10"
              autoFocus
              aria-label="Search customer"
            />
            {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">…</span>}
            {showResults && results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface shadow-glow-sm">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-2"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setShowResults(false);
                      }}
                    >
                      <span>
                        <span className="block text-sm font-bold">{c.name}</span>
                        <span className="block text-xs text-muted">{c.mobile}</span>
                      </span>
                      <Check className="h-4 w-4 text-primary" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showResults && !searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-sm text-muted">No customer found.</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setNewMode(true); setShowResults(false); }}>
                  <UserPlus className="h-4 w-4" /> Create “{query.trim()}”
                </Button>
              </div>
            )}
            <button
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-secondary hover:underline"
              onClick={() => setNewMode(true)}
            >
              <UserPlus className="h-3.5 w-3.5" /> New customer
            </button>
          </div>
        )}
      </section>

      {/* STEP 2 — resource */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card" aria-label="Resource">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <StepNumber n={2} /> Resource
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {resources.filter((r) => r.active).map((r) => {
            const available = r.status === 'ACTIVE' && r.current_status !== 'BUSY' && r.current_status !== 'MAINTENANCE';
            const selected = resourceId === r.id;
            return (
              <button
                key={r.id}
                disabled={!available}
                onClick={() => {
                  setResourceId(r.id);
                  setPlanId(null);
                }}
                className={`rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/15 shadow-glow-sm'
                    : available
                      ? 'border-border bg-surface-2 hover:border-primary/40'
                      : 'cursor-not-allowed border-border bg-surface-2/50 opacity-50'
                }`}
                aria-pressed={selected}
              >
                <p className="truncate text-sm font-bold">{r.name}</p>
                <p className="truncate text-[11px] text-muted">{r.type.replace(/_/g, ' ')}</p>
                <p
                  className={`mt-1 text-[10px] font-extrabold uppercase tracking-wide ${
                    r.current_status === 'AVAILABLE'
                      ? 'text-success'
                      : r.current_status === 'BUSY'
                        ? 'text-danger'
                        : r.current_status === 'RESERVED'
                          ? 'text-warning'
                          : 'text-muted'
                  }`}
                >
                  {r.current_status === 'BUSY' ? 'Busy' : r.current_status}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* STEP 3 — start time */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card" aria-label="Start time">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <StepNumber n={3} /> Start time
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TimeButton active={startMode === 'now'} onClick={() => setStartMode('now')} icon={<Zap className="h-4 w-4" />} label="Start now" />
          <TimeButton active={startMode === '+5'} onClick={() => setStartMode('+5')} icon={<Clock className="h-4 w-4" />} label="In 5 min" />
          <TimeButton active={startMode === '+10'} onClick={() => setStartMode('+10')} icon={<Clock className="h-4 w-4" />} label="In 10 min" />
          <TimeButton active={startMode === 'custom'} onClick={() => { setStartMode('custom'); setCustomTime(toLocalInputValue(new Date())); }} icon={<CalendarClock className="h-4 w-4" />} label="Custom" />
        </div>
        {startMode === 'custom' && (
          <div className="mt-3">
            <Input
              type="datetime-local"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              aria-label="Custom start time"
            />
          </div>
        )}
        {isScheduled && (
          <div className="mt-3 rounded-xl border border-secondary/30 bg-secondary/10 p-3">
            <p className="text-xs font-semibold text-secondary">
              Future start — the session will be SCHEDULED and starts billing automatically at the
              scheduled time.
            </p>
            <div className="mt-2 flex items-center gap-2">
                <label className="text-xs font-bold text-muted" htmlFor="expected-min">Expected duration (min):</label>
                <input
                  id="expected-min"
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={expectedMinutes ?? plan?.duration_minutes ?? 60}
                  onChange={(e) => setExpectedMinutes(Number(e.target.value))}
                  className="input-base w-24"
                />
            </div>
          </div>
        )}
      </section>

      {/* STEP 4 — pricing plan */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card" aria-label="Pricing">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <StepNumber n={4} /> Pricing plan
        </h2>
        {resourcePlans.length === 0 ? (
          <p className="text-sm text-muted">
            No pricing plan for {resource?.type.replace(/_/g, ' ')}. Add one under Pricing first.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {resourcePlans.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPlanId(p.id);
                  setExpectedMinutes(p.duration_minutes);
                }}
                className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
                  planId === p.id
                    ? 'border-primary bg-primary/15 shadow-glow-sm'
                    : 'border-border bg-surface-2 hover:border-primary/40'
                }`}
                aria-pressed={planId === p.id}
              >
                <div>
                  <p className="text-sm font-bold">{p.name}</p>
                  <p className="text-[11px] text-muted">
                    {p.billing_type.replace(/_/g, ' ')}
                    {p.duration_minutes ? ` · ${p.duration_minutes} min` : ''}
                  </p>
                </div>
                <span className="font-extrabold text-secondary">{formatMoney(p.price, sym)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* summary + start */}
      <div className="glass sticky bottom-20 z-30 rounded-2xl border-primary/30 p-4 shadow-glow sm:bottom-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {selectedCustomer || newName ? (
              <p className="truncate">
                <Users className="mr-1 inline h-3.5 w-3.5 text-muted" aria-hidden />
                <strong>{selectedCustomer?.name ?? newName}</strong>
                {resource ? <> · {resource.name}</> : null}
                {estimate ? <> · est. <strong>{formatMoney(estimate, sym)}</strong></> : null}
              </p>
            ) : (
              <p className="text-muted">Select a customer, resource and plan to continue</p>
            )}
          </div>
          <Button size="lg" loading={starting} disabled={!canStart} onClick={start} className="shrink-0">
            <Rocket className="h-4 w-4" />
            {isScheduled ? 'Schedule Session' : 'Start Session'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-extrabold text-primary">
      {n}
    </span>
  );
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
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-xs font-bold transition-all ${
        active ? 'border-primary bg-primary/15 text-primary shadow-glow-sm' : 'border-border bg-surface-2 text-muted hover:text-content'
      }`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}
