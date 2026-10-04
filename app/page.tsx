'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  animate,
} from 'framer-motion';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { Logo } from '@/components/ui/logo';
import { anton, chakraPetch } from '@/app/fonts';
import { formatMoney, formatClock } from '@/lib/billing/format';
import type { AvailabilityRow, CafeSettings, PricingPlan } from '@/types';
import {
  Gamepad2, Target, CupSoda, Timer, QrCode, ArrowRight, LogIn,
  CircleDollarSign, Zap, Clock,
} from 'lucide-react';

/* ========================================================== data */

interface HomeData {
  settings: Pick<CafeSettings, 'cafe_name' | 'address' | 'phone' | 'currency_symbol' | 'timezone'> | null;
  rows: AvailabilityRow[] | null;
  plans: PricingPlan[] | null;
}

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  AVAILABLE: { label: 'Free now', chip: 'border-success/40 bg-success/10 text-success', dot: 'bg-success' },
  BUSY: { label: 'Busy', chip: 'border-danger/40 bg-danger/10 text-danger', dot: 'bg-danger' },
  RESERVED: { label: 'Reserved', chip: 'border-warning/40 bg-warning/10 text-warning', dot: 'bg-warning' },
  MAINTENANCE: { label: 'Offline', chip: 'border-muted/40 bg-muted/10 text-muted', dot: 'bg-muted' },
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

const TICKER = [
  'PlayStation 5',
  'Pool Table',
  'Snacks & Drinks',
  'Per-minute billing',
  'No account needed',
  'Book in 30 seconds',
  'Walk-ins welcome',
];

function planUnit(p: PricingPlan): string {
  switch (p.billing_type) {
    case 'HOURLY': return 'per hour';
    case 'PER_MINUTE': return 'per minute';
    case 'FIXED': return 'flat rate';
    case 'PACKAGE':
      return p.duration_minutes
        ? `for ${p.duration_minutes >= 60 ? `${p.duration_minutes / 60}h` : `${p.duration_minutes} min`}`
        : 'package';
    default: return '';
  }
}

/* ========================================================== motion primitives */

const reveal = {
  hidden: { opacity: 0, y: 36 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};

function Stagger({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={reveal}>
      {children}
    </motion.div>
  );
}

/** number that counts up when scrolled into view */
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const controls = animate(0, to, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = `${Math.round(v)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [inView, to, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

/** card that tilts toward the cursor */
function Tilt({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 260, damping: 24 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-7, 7]), { stiffness: 260, damping: 24 });
  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** button that gravitates toward the cursor */
function Magnetic({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const x = useSpring(useMotionValue(0), { stiffness: 180, damping: 16 });
  const y = useSpring(useMotionValue(0), { stiffness: 180, damping: 16 });
  return (
    <motion.div
      className={className}
      style={{ x, y }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.25);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* ========================================================== page */

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
  const plans = useMemo(() => (data.plans ?? []).slice(0, 5), [data.plans]);

  return (
    <div className={`${anton.variable} ${chakraPetch.variable} min-h-dvh overflow-x-clip`}>
      {/* ============================= NAV ============================= */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Logo className="h-9 w-auto" alt={cafeName} />
            <span className="font-hud text-sm font-bold uppercase tracking-[0.18em]">{cafeName}</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/admin/login"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 font-hud text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:bg-surface-2 hover:text-content sm:inline-flex"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden /> Staff
            </Link>
            <Link
              href="/book"
              className="btn-shine inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-hud text-xs font-bold uppercase tracking-wider text-white shadow-glow-sm transition-transform hover:scale-[1.04] active:scale-95"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden /> Book now
            </Link>
          </div>
        </div>
      </header>

      {/* ============================= HERO ============================= */}
      <section className="relative overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="scanlines absolute inset-0" />
          <div className="noise absolute inset-0 opacity-[0.05]" />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'linear-gradient(rgba(124,58,237,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.09) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse 85% 65% at 50% 0%, black 30%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 85% 65% at 50% 0%, black 30%, transparent 100%)',
            }}
          />
          <div className="absolute -top-16 left-[8%] h-80 w-80 animate-float rounded-full bg-primary/25 blur-[130px]" />
          <div className="absolute right-[2%] top-40 h-96 w-96 animate-float-slow rounded-full bg-secondary/15 blur-[140px]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-24">
          {/* left — massive type */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.14, delayChildren: 0.15 } } }}
            className="text-center lg:text-left"
          >
            <motion.p
              variants={reveal}
              className="mb-5 inline-flex items-center gap-2.5 rounded-full border border-success/30 bg-success/10 px-4 py-1.5 font-hud text-[11px] font-bold uppercase tracking-[0.22em] text-success"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {rows.length > 0 ? `Live — ${freeCount}/${rows.length} stations free` : 'Live availability'}
            </motion.p>

            <motion.h1
              variants={reveal}
              className="font-display text-[clamp(3.8rem,11vw,7.5rem)] leading-[0.88] tracking-tight uppercase"
            >
              Unleash
              <br />
              <span className="text-outline">Your</span>
              <br />
              <span className="glitch bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent" data-text="Game.">
                Game.
              </span>
            </motion.h1>

            <motion.p variants={reveal} className="mx-auto mt-6 max-w-md text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
              {cafeName} — PS5 &amp; pool, zero queue. Book in seconds, order snacks to your
              seat, and pay only for the time you actually play.
            </motion.p>

            <motion.div variants={reveal} className="mt-9 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
              <Magnetic>
                <Link
                  href="/book"
                  className="btn-shine inline-flex h-14 items-center gap-2.5 rounded-xl bg-primary px-8 font-hud text-sm font-bold uppercase tracking-widest text-white shadow-glow transition-shadow hover:shadow-glow-sm"
                >
                  <Gamepad2 className="h-5 w-5" aria-hidden /> Book a station
                </Link>
              </Magnetic>
              <a
                href="#live"
                className="group inline-flex h-14 items-center gap-2 rounded-xl border border-border-strong bg-surface-2/60 px-7 font-hud text-sm font-bold uppercase tracking-widest text-content backdrop-blur transition-colors hover:border-secondary/50 hover:text-secondary"
              >
                Live status
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
            </motion.div>
          </motion.div>

          {/* right — tilted live station cards */}
          <motion.div
            initial={{ opacity: 0, x: 60, rotate: 6 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative hidden lg:block"
          >
            <div className="animate-float-slow space-y-5 [transform:perspective(1000px)]">
              {(rows.length ? rows.slice(0, 3) : [null, null, null]).map((r, i) => (
                <Tilt
                  key={r?.resource_id ?? i}
                  className={`glass hud rounded-lg p-4 shadow-card ${i === 1 ? 'ml-12 rotate-[-2deg]' : i === 2 ? 'ml-5 rotate-[1.5deg]' : 'rotate-[2.5deg]'}`}
                >
                  {r ? (
                    <div className="flex items-center justify-between gap-6" style={{ transform: 'translateZ(24px)' }}>
                      <div className="flex items-center gap-3.5">
                        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/15 text-primary">
                          {r.resource_type === 'POOL' ? <Target className="h-6 w-6" /> : <Gamepad2 className="h-6 w-6" />}
                        </span>
                        <div>
                          <p className="font-hud text-sm font-bold uppercase tracking-wider">{r.name}</p>
                          <p className="mt-0.5 text-xs text-muted">{r.rate_label}</p>
                        </div>
                      </div>
                      <span className={`rounded border px-2 py-1 font-hud text-[10px] font-bold uppercase tracking-widest ${STATUS_META[r.status]?.chip ?? ''}`}>
                        {STATUS_META[r.status]?.label ?? r.status}
                      </span>
                    </div>
                  ) : (
                    <div className="h-12 animate-pulse rounded-md bg-surface-3" />
                  )}
                </Tilt>
              ))}
            </div>
            <motion.div
              initial={{ scale: 0, rotate: 20 }}
              animate={{ scale: 1, rotate: -8 }}
              transition={{ delay: 0.9, type: 'spring', stiffness: 260, damping: 14 }}
              className="sticker absolute -right-2 top-6 rounded-md border-2 border-secondary bg-background px-3 py-1.5 font-hud text-[10px] font-black uppercase tracking-[0.25em] text-secondary shadow-glow-sm"
            >
              Live feed
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ============================= TICKER ============================= */}
      <div className="relative -rotate-1 border-y-2 border-primary/40 bg-primary/10 py-3 backdrop-blur-sm" aria-hidden>
        <div className="marquee">
          <div className="marquee-track">
            {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="mx-5 flex items-center gap-5 whitespace-nowrap font-hud text-sm font-bold uppercase tracking-[0.25em] text-content/80">
                {t}
                <span className="text-secondary">✦</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ============================= 01 / LIVE STATUS ============================= */}
      <section id="live" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
        <Stagger className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <Item>
            <p className="font-hud text-xs font-bold uppercase tracking-[0.3em] text-primary">01 / Live status</p>
            <h2 className="mt-3 font-display text-4xl uppercase leading-none tracking-tight sm:text-6xl">
              Who&apos;s playing
              <br />
              right now
            </h2>
          </Item>
          <Item className="text-right">
            <p className="font-display text-5xl leading-none text-success sm:text-7xl">
              <Counter to={freeCount} />
            </p>
            <p className="mt-1.5 font-hud text-xs font-bold uppercase tracking-[0.25em] text-muted">
              stations free · updates live
            </p>
          </Item>
        </Stagger>

        {rows.length === 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass h-36 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : (
          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.MAINTENANCE;
              const note =
                r.status === 'BUSY' && r.busy_until
                  ? `free ~${formatClock(r.busy_until, tz)}`
                  : r.status === 'RESERVED' && r.next_booking_start
                    ? `opens ${formatClock(r.next_booking_start, tz)}`
                    : r.status === 'AVAILABLE'
                      ? 'ready to play'
                      : null;
              return (
                <Item key={r.resource_id}>
                  <Tilt className="glass hud group rounded-lg p-5 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5">
                        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-gradient-to-br from-primary/25 to-secondary/20 text-primary">
                          {r.resource_type === 'POOL' ? <Target className="h-6 w-6" aria-hidden /> : <Gamepad2 className="h-6 w-6" aria-hidden />}
                        </span>
                        <div>
                          <p className="font-hud text-sm font-bold uppercase tracking-wider">{r.name}</p>
                          <p className="text-xs text-muted">{TYPE_LABEL[r.resource_type] ?? r.resource_type}</p>
                        </div>
                      </div>
                      <span className={`flex items-center gap-1.5 rounded border px-2 py-1 font-hud text-[10px] font-bold uppercase tracking-widest ${meta.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${r.status === 'AVAILABLE' ? 'animate-pulse-dot' : ''}`} aria-hidden />
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4" style={{ transform: 'translateZ(18px)' }}>
                      <div>
                        <p className="text-sm font-extrabold">{r.rate_label}</p>
                        {note && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                            <Clock className="h-3 w-3" aria-hidden /> {note}
                          </p>
                        )}
                      </div>
                      {r.status !== 'MAINTENANCE' && (
                        <Link
                          href="/book"
                          className="btn-shine rounded-md border border-primary/40 bg-primary/10 px-4 py-2 font-hud text-[11px] font-bold uppercase tracking-widest text-primary transition-colors group-hover:bg-primary group-hover:text-white"
                        >
                          Book
                        </Link>
                      )}
                    </div>
                  </Tilt>
                </Item>
              );
            })}
          </Stagger>
        )}
      </section>

      {/* ============================= 02 / THE SETUP (bento) ============================= */}
      <section className="border-y border-border/50 bg-surface/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Stagger className="mb-12">
            <Item>
              <p className="font-hud text-xs font-bold uppercase tracking-[0.3em] text-primary">02 / The setup</p>
              <h2 className="mt-3 font-display text-4xl uppercase leading-none tracking-tight sm:text-6xl">
                Built for sessions
              </h2>
            </Item>
          </Stagger>

          <Stagger className="grid gap-5 lg:grid-cols-3">
            <Item className="lg:col-span-2">
              <div className="glass hud group relative h-full overflow-hidden rounded-lg p-7">
                <Gamepad2 className="absolute -bottom-8 -right-8 h-48 w-48 text-primary/10 transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110" aria-hidden />
                <span className="font-hud text-xs font-bold uppercase tracking-[0.25em] text-primary">Console row</span>
                <h3 className="mt-3 font-display text-3xl uppercase tracking-tight">PlayStation 5 stations</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
                  Latest titles, extra controllers on request, comfortable seating. Grab a station
                  solo or squad up — rates shown before you book, always.
                </p>
                {minRate && (
                  <p className="mt-5 font-hud text-sm font-bold uppercase tracking-widest text-content">
                    from <span className="text-primary">{formatMoney(minRate, sym)}/hr</span>
                  </p>
                )}
              </div>
            </Item>
            <Item>
              <div className="glass hud h-full rounded-lg p-7">
                <Target className="h-8 w-8 text-secondary" aria-hidden />
                <h3 className="mt-4 font-display text-2xl uppercase tracking-tight">Pool table</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">
                  Book by the hour or a quick 30-minute challenge. First to sink the black ball buys the snacks.
                </p>
              </div>
            </Item>
            <Item>
              <div className="glass hud h-full rounded-lg p-7">
                <CupSoda className="h-8 w-8 text-warning" aria-hidden />
                <h3 className="mt-4 font-display text-2xl uppercase tracking-tight">Snacks &amp; drinks</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">
                  Coke, chips, energy drinks — delivered to your station and added to one tab.
                </p>
              </div>
            </Item>
            <Item className="lg:col-span-2">
              <div className="glass hud group flex h-full flex-col justify-between gap-6 rounded-lg p-7 sm:flex-row sm:items-center">
                <div>
                  <Timer className="h-8 w-8 text-success" aria-hidden />
                  <h3 className="mt-4 font-display text-2xl uppercase tracking-tight">Fair per-minute billing</h3>
                  <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted">
                    The clock starts when you press play and stops when you don&apos;t. Pause it,
                    stretch, order more chips — you only pay for game time.
                  </p>
                </div>
                <div className="shrink-0 rounded-lg border border-success/30 bg-success/10 px-5 py-4 text-center">
                  <p className="font-display text-3xl text-success">00:01</p>
                  <p className="mt-1 font-hud text-[10px] font-bold uppercase tracking-[0.25em] text-success/80">
                    = billed exactly
                  </p>
                </div>
              </div>
            </Item>
          </Stagger>
        </div>
      </section>

      {/* ============================= 03 / RATES ============================= */}
      {plans.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Stagger className="mb-10">
            <Item>
              <p className="font-hud text-xs font-bold uppercase tracking-[0.3em] text-primary">03 / Rates</p>
              <h2 className="mt-3 font-display text-4xl uppercase leading-none tracking-tight sm:text-6xl">
                No surprises
              </h2>
            </Item>
          </Stagger>

          <Stagger className="divide-y divide-border/70 border-y border-border/70">
            {plans.map((p, i) => {
              const isPackage = p.billing_type === 'PACKAGE';
              return (
                <Item key={p.id}>
                  <Link
                    href="/book"
                    className={`group grid grid-cols-[1fr_auto] items-center gap-4 py-5 transition-all sm:grid-cols-[3rem_1fr_auto_auto] sm:gap-6 sm:py-6 ${
                      isPackage ? 'bg-transparent' : ''
                    } hover:bg-surface/60 hover:pl-3 sm:hover:pl-5`}
                  >
                    <span className="hidden font-display text-2xl text-muted/40 sm:block">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="font-hud text-base font-bold uppercase tracking-wider">{p.name}</h3>
                        {isPackage && (
                          <span className="rounded-sm bg-primary px-2 py-0.5 font-hud text-[10px] font-black uppercase tracking-widest text-white">
                            Best value
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">{TYPE_LABEL[p.resource_type] ?? p.resource_type}</p>
                    </div>
                    <span className="font-hud text-xs uppercase tracking-widest text-muted">{planUnit(p)}</span>
                    <span className="font-display text-3xl tracking-tight transition-colors group-hover:text-primary sm:text-4xl">
                      {formatMoney(Number(p.price), sym)}
                    </span>
                  </Link>
                </Item>
              );
            })}
          </Stagger>
        </section>
      )}

      {/* ============================= 04 / HOW IT WORKS ============================= */}
      <section className="border-y border-border/50 bg-surface/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <Stagger className="mb-12">
            <Item>
              <p className="font-hud text-xs font-bold uppercase tracking-[0.3em] text-primary">04 / How it works</p>
              <h2 className="mt-3 font-display text-4xl uppercase leading-none tracking-tight sm:text-6xl">
                Three moves
              </h2>
            </Item>
          </Stagger>

          <Stagger className="grid gap-10 sm:grid-cols-3 sm:gap-6">
            {[
              { icon: QrCode, n: '01', title: 'Book your slot', text: 'Scan the QR at the counter or tap Book. Pick a station, time and duration — the price shows before you confirm.' },
              { icon: Gamepad2, n: '02', title: 'Walk in & play', text: 'Give your booking code at the desk and your station fires up instantly. No paperwork, no waiting.' },
              { icon: CircleDollarSign, n: '03', title: 'Pay when done', text: 'Snacks land on the same tab. End your session and pay by cash, UPI or card — for exactly what you played.' },
            ].map((s) => (
              <Item key={s.n}>
                <div className="group">
                  <div className="flex items-center gap-4">
                    <span className="font-display text-6xl leading-none text-outline-primary transition-all group-hover:text-primary group-hover:[-webkit-text-stroke-width:0px] sm:text-7xl">
                      {s.n}
                    </span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/15 text-primary">
                      <s.icon className="h-5 w-5" aria-hidden />
                    </span>
                  </div>
                  <h3 className="mt-5 font-hud text-base font-bold uppercase tracking-wider">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </div>
              </Item>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ============================= CTA ============================= */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="noise absolute inset-0 opacity-[0.06]" />
          <div className="absolute left-1/2 top-1/2 h-72 w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[130px]" />
        </div>
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <motion.h2
            initial={{ opacity: 0, scale: 0.92 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[clamp(3rem,10vw,6.5rem)] uppercase leading-[0.9] tracking-tight"
          >
            Ready to
            <br />
            <span className="glitch bg-gradient-to-r from-secondary to-primary bg-clip-text text-transparent" data-text="Play?">
              Play?
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="mx-auto mt-5 max-w-md font-hud text-sm uppercase tracking-[0.2em] text-muted"
          >
            {freeCount > 0
              ? `${freeCount} station${freeCount === 1 ? '' : 's'} free right now`
              : 'All stations busy — join the waitlist'}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="mt-10"
          >
            <Magnetic className="inline-block">
              <Link
                href="/book"
                className="btn-shine inline-flex h-16 items-center gap-3 rounded-xl bg-white px-10 font-hud text-base font-black uppercase tracking-widest text-black transition-transform hover:scale-[1.04] active:scale-95"
              >
                <Zap className="h-5 w-5 text-primary" aria-hidden />
                Book a station
              </Link>
            </Magnetic>
          </motion.div>
        </div>
      </section>

      {/* ============================= FOOTER ============================= */}
      <footer className="border-t border-border/60 bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-10 sm:flex-row sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-auto" alt={cafeName} />
            <div>
              <p className="font-hud text-sm font-bold uppercase tracking-[0.15em]">{cafeName}</p>
              {(data.settings?.address || data.settings?.phone) && (
                <p className="mt-0.5 text-xs text-muted">
                  {[data.settings?.address, data.settings?.phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-5 font-hud text-xs font-semibold uppercase tracking-wider text-muted">
            <Link href="/book" className="transition-colors hover:text-content">Book</Link>
            <Link href="/admin/login" className="transition-colors hover:text-content">Staff</Link>
            <span className="text-muted/60">© {new Date().getFullYear()} {cafeName}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
