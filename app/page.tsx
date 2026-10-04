'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { Logo } from '@/components/ui/logo';
import { formatMoney, formatClock } from '@/lib/billing/format';
import type { AvailabilityRow, CafeSettings, PricingPlan } from '@/types';
import {
  Gamepad2, Target, CupSoda, Timer, QrCode, ArrowRight, LogIn,
  CircleDollarSign, Zap, CheckCircle2, Clock,
} from 'lucide-react';

/* ---------------------------------------------------------- data */

interface HomeData {
  settings: Pick<CafeSettings, 'cafe_name' | 'address' | 'phone' | 'currency_symbol' | 'timezone'> | null;
  rows: AvailabilityRow[] | null;
  plans: PricingPlan[] | null;
}

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  AVAILABLE: { label: 'Free now', chip: 'border-success/30 bg-success/10 text-success', dot: 'bg-success' },
  BUSY: { label: 'Busy', chip: 'border-danger/30 bg-danger/10 text-danger', dot: 'bg-danger' },
  RESERVED: { label: 'Reserved', chip: 'border-warning/30 bg-warning/10 text-warning', dot: 'bg-warning' },
  MAINTENANCE: { label: 'Maintenance', chip: 'border-muted/30 bg-muted/10 text-muted', dot: 'bg-muted' },
};

const TYPE_LABEL: Record<string, string> = {
  PLAYSTATION: 'PS5 Console',
  XBOX: 'Xbox Console',
  PC: 'Gaming PC',
  POOL: 'Pool Table',
  VR: 'VR Station',
  SNOOKER: 'Snooker',
  TABLE_TENNIS: 'Table Tennis',
};

function planUnit(p: PricingPlan): string {
  switch (p.billing_type) {
    case 'HOURLY':
      return 'per hour';
    case 'PER_MINUTE':
      return 'per minute';
    case 'FIXED':
      return 'flat rate';
    case 'PACKAGE':
      return p.duration_minutes ? `for ${p.duration_minutes >= 60 ? `${p.duration_minutes / 60} hour${p.duration_minutes >= 120 ? 's' : ''}` : `${p.duration_minutes} min`}` : 'package';
    default:
      return '';
  }
}

/* ---------------------------------------------------------- page */

export default function HomePage() {
  const [data, setData] = useState<HomeData>({ settings: null, rows: null, plans: null });

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const [avail, settings, plans] = await Promise.all([
      supabase.rpc('public_get_availability').then((r: { data: unknown }) => r.data as AvailabilityRow[] | null, () => null),
      supabase
        .from('settings')
        .select('cafe_name, address, phone, currency_symbol, timezone')
        .eq('id', 'default')
        .maybeSingle()
        .then((r: { data: HomeData['settings'] }) => r.data, () => null),
      supabase
        .from('pricing_plans')
        .select('id, name, price, billing_type, duration_minutes, resource_type, active')
        .eq('active', true)
        .order('price')
        .then((r: { data: unknown }) => (r.data as PricingPlan[] | null) ?? null, () => null),
    ]);
    setData({ settings, rows: avail ?? null, plans });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useDebouncedCallback(() => load(), 700);
  useRealtime('resources', refetch);
  useRealtime('sessions', refetch);
  useRealtime('bookings', refetch);

  const cafeName = data.settings?.cafe_name ?? 'Gaming Cafe';
  const sym = data.settings?.currency_symbol ?? '₹';
  const tz = data.settings?.timezone;

  const rows = data.rows ?? [];
  const freeCount = rows.filter((r) => r.status === 'AVAILABLE').length;
  const minRate = useMemo(() => {
    const rates = rows.map((r) => Number(r.hourly_rate)).filter((n) => n > 0);
    return rates.length ? Math.min(...rates) : null;
  }, [rows]);

  const plans = useMemo(() => (data.plans ?? []).slice(0, 4), [data.plans]);

  return (
    <div className="min-h-dvh overflow-x-clip">
      {/* ---------------- nav ---------------- */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Logo className="h-9 w-auto" alt={cafeName} />
            <span className="text-base font-extrabold tracking-tight">{cafeName}</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/admin/login"
              className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-content sm:inline-flex"
            >
              <LogIn className="h-4 w-4" aria-hidden /> Staff
            </Link>
            <Link
              href="/book"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-glow-sm transition-transform hover:scale-[1.03] active:scale-95"
            >
              <Zap className="h-4 w-4" aria-hidden /> Book Now
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="relative">
        {/* backdrop */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 100%)',
            }}
          />
          <div className="absolute -top-20 left-[12%] h-72 w-72 animate-float rounded-full bg-primary/25 blur-[110px]" />
          <div className="absolute right-[5%] top-32 h-80 w-80 animate-float-slow rounded-full bg-secondary/20 blur-[120px]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-24 lg:pt-24">
          {/* left */}
          <div className="animate-slide-up text-center lg:text-left">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {rows.length > 0 ? (
                <>
                  Live — {freeCount} of {rows.length} stations free
                </>
              ) : (
                'Live availability'
              )}
            </div>

            <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              Play. Compete.
              <br />
              <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent">
                Repeat.
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
              {cafeName} — book a PS5 or pool table in seconds. See live availability, grab your
              slot, order snacks to your seat, and pay only for the time you actually play.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link
                href="/book"
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/80 px-7 text-base font-black text-white shadow-glow transition-transform hover:scale-[1.03] active:scale-95 sm:w-auto"
              >
                <Gamepad2 className="h-5 w-5" aria-hidden />
                Book a Station
              </Link>
              <a
                href="#availability"
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface-2 px-7 text-base font-bold text-content transition-colors hover:border-primary/40 hover:bg-surface-3 sm:w-auto"
              >
                Live availability
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-muted lg:justify-start">
              {['No account needed', 'Walk-ins welcome', 'Fair per-minute billing'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* right — floating live station cards */}
          <div className="relative hidden lg:block" aria-hidden>
            <div className="animate-float-slow space-y-4">
              {(rows.length ? rows.slice(0, 3) : [null, null, null]).map((r, i) => (
                <div
                  key={r?.resource_id ?? i}
                  className={`glass rounded-2xl p-4 shadow-card ${i === 1 ? 'ml-10' : i === 2 ? 'ml-4' : ''}`}
                >
                  {r ? (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                          {r.resource_type === 'POOL' ? <Target className="h-5 w-5" /> : <Gamepad2 className="h-5 w-5" />}
                        </span>
                        <div>
                          <p className="text-sm font-bold">{r.name}</p>
                          <p className="text-xs text-muted">{r.rate_label}</p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${STATUS_META[r.status]?.chip ?? ''}`}>
                        {STATUS_META[r.status]?.label ?? r.status}
                      </span>
                    </div>
                  ) : (
                    <div className="h-11 animate-pulse rounded-xl bg-surface-3" />
                  )}
                </div>
              ))}
            </div>
            <div className="absolute -right-3 -top-3 rounded-full border border-primary/30 bg-background px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary shadow-glow-sm">
              updates live
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- live availability ---------------- */}
      <section id="availability" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Right now</p>
            <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Live station availability</h2>
          </div>
          <span className="flex items-center gap-2 text-xs font-semibold text-muted">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-success" aria-hidden />
            Updates automatically — no refresh needed
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass h-32 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.MAINTENANCE;
              const note =
                r.status === 'BUSY' && r.busy_until
                  ? `Until ${formatClock(r.busy_until, tz)}`
                  : r.status === 'RESERVED' && r.next_booking_start
                    ? `Next slot ${formatClock(r.next_booking_start, tz)}`
                    : r.status === 'AVAILABLE'
                      ? 'Ready to play'
                      : null;
              return (
                <div key={r.resource_id} className="glass group rounded-2xl p-5 transition-all hover:-translate-y-1 hover:border-primary/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 text-primary">
                        {r.resource_type === 'POOL' ? <Target className="h-6 w-6" aria-hidden /> : <Gamepad2 className="h-6 w-6" aria-hidden />}
                      </span>
                      <div>
                        <p className="font-bold">{r.name}</p>
                        <p className="text-xs text-muted">{TYPE_LABEL[r.resource_type] ?? r.resource_type}</p>
                      </div>
                    </div>
                    <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${meta.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${r.status === 'AVAILABLE' ? 'animate-pulse-dot' : ''}`} aria-hidden />
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-4">
                    <div>
                      <p className="text-sm font-extrabold text-content">{r.rate_label}</p>
                      {note && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          <Clock className="h-3 w-3" aria-hidden /> {note}
                        </p>
                      )}
                    </div>
                    {r.status !== 'MAINTENANCE' && (
                      <Link
                        href="/book"
                        className="rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2 text-xs font-bold text-primary transition-colors group-hover:bg-primary group-hover:text-white"
                      >
                        Book
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- stats strip ---------------- */}
      <section className="border-y border-border/60 bg-surface/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-border/60 lg:grid-cols-4">
          {[
            { icon: Gamepad2, value: String(rows.length || '—'), label: 'Play stations' },
            { icon: CircleDollarSign, value: minRate ? `from ${formatMoney(minRate, sym)}/hr` : 'fair rates', label: 'Transparent pricing' },
            { icon: Timer, value: 'Per-minute', label: 'You pay for exact play time' },
            { icon: QrCode, value: '30 seconds', label: 'Scan QR → booked' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <s.icon className="mb-1 h-5 w-5 text-primary" aria-hidden />
              <p className="text-xl font-black tracking-tight">{s.value}</p>
              <p className="text-xs font-semibold text-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- features ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Why players love us</p>
          <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Everything for a great session</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Gamepad2,
              title: 'Console Gaming',
              text: 'PlayStation 5 stations with the latest titles, extra controllers and comfortable seating.',
            },
            {
              icon: Target,
              title: 'Pool & More',
              text: 'Challenge your friends on the pool table — book by the hour or a quick 30-minute round.',
            },
            {
              icon: CupSoda,
              title: 'Snacks & Drinks',
              text: 'Coke, chips and energy drinks delivered straight to your station — added to your tab.',
            },
            {
              icon: Timer,
              title: 'Fair Billing',
              text: 'Transparent per-minute billing with visible rates. Pause the clock, pay only for play.',
            },
          ].map((f) => (
            <div key={f.title} className="glass rounded-2xl p-6 transition-all hover:-translate-y-1 hover:border-primary/30">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-secondary/25 text-primary shadow-glow-sm">
                <f.icon className="h-6 w-6" aria-hidden />
              </span>
              <h3 className="font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- pricing ---------------- */}
      {plans.length > 0 && (
        <section id="pricing" className="border-y border-border/60 bg-surface/40 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 text-center">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Straightforward rates</p>
              <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Pick a plan, play your way</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((p) => {
                const isPackage = p.billing_type === 'PACKAGE';
                return (
                  <div
                    key={p.id}
                    className={`relative rounded-2xl p-6 transition-all hover:-translate-y-1 ${
                      isPackage
                        ? 'border border-primary/40 bg-gradient-to-b from-primary/15 to-transparent shadow-glow-sm'
                        : 'glass'
                    }`}
                  >
                    {isPackage && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                        Best value
                      </span>
                    )}
                    <p className="text-xs font-bold uppercase tracking-wider text-muted">
                      {TYPE_LABEL[p.resource_type] ?? p.resource_type}
                    </p>
                    <h3 className="mt-1 font-bold">{p.name}</h3>
                    <p className="mt-4 text-3xl font-black tracking-tight">
                      {formatMoney(Number(p.price), sym)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted">{planUnit(p)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ---------------- how it works ---------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Dead simple</p>
          <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">How it works</h2>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {[
            {
              icon: QrCode,
              step: '01',
              title: 'Book your slot',
              text: 'Scan the QR at the counter or open the booking page. Pick a station, date and time — see the price before you confirm.',
            },
            {
              icon: Gamepad2,
              step: '02',
              title: 'Walk in & play',
              text: 'Arrive, share your booking code, and your station fires up instantly. No waiting, no paperwork.',
            },
            {
              icon: CircleDollarSign,
              step: '03',
              title: 'Pay when done',
              text: 'Order snacks to your seat — everything lands on one bill. Pay by cash, UPI or card when you finish.',
            },
          ].map((s) => (
            <div key={s.step} className="relative text-center sm:text-left">
              <div className="mb-4 flex items-center justify-center gap-3 sm:justify-start">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-white shadow-glow-sm">
                  <s.icon className="h-6 w-6" aria-hidden />
                </span>
                <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-3xl font-black text-transparent">
                  {s.step}
                </span>
              </div>
              <h3 className="font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- CTA banner ---------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/25 via-surface to-secondary/15 px-6 py-12 text-center sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-primary/30 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-secondary/30 blur-[80px]" aria-hidden />
          <h2 className="relative text-3xl font-black tracking-tight sm:text-4xl">
            Ready to play?
          </h2>
          <p className="relative mx-auto mt-3 max-w-md text-sm text-muted sm:text-base">
            {freeCount > 0
              ? `${freeCount} station${freeCount === 1 ? '' : 's'} free right now — grab yours before someone else does.`
              : 'All stations busy? Join the waitlist and we will ping you the moment one frees up.'}
          </p>
          <Link
            href="/book"
            className="relative mt-7 inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-black text-black transition-transform hover:scale-[1.04] active:scale-95"
          >
            <Zap className="h-5 w-5 text-primary" aria-hidden />
            Book a Station
          </Link>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-border/60 bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-10 sm:flex-row sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-auto" alt={cafeName} />
            <div>
              <p className="text-sm font-extrabold">{cafeName}</p>
              {(data.settings?.address || data.settings?.phone) && (
                <p className="text-xs text-muted">
                  {[data.settings?.address, data.settings?.phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-5 text-xs font-semibold text-muted">
            <Link href="/book" className="transition-colors hover:text-content">Book a station</Link>
            <Link href="/admin/login" className="transition-colors hover:text-content">Staff login</Link>
            <span>© {new Date().getFullYear()} {cafeName}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
