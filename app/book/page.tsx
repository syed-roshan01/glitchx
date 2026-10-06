'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Hourglass, LoaderCircle, Phone, RefreshCw, Ticket, WifiOff } from 'lucide-react';
import { anton, chakraPetch } from '@/app/fonts';
import { Logo } from '@/components/ui/logo';
import { useToast } from '@/components/ui/toast';
import { formatClock, formatMoney, num } from '@/lib/billing/format';
import type { AvailabilityRow } from '@/types';

import { useBookingData } from './_components/use-booking-data';
import { buildBusyMap, GRACE_MS, horizonOf, isBookable, isFree, nowStart } from './_components/availability';
import {
  errorCode,
  errorMessage,
  getSupabase,
  loadContact,
  loadLastBooking,
  messageFor,
  saveContact,
  saveLastBooking,
  validateMobile,
  validateName,
  type LastBooking,
} from './_components/api';
import { dayKeyOf, dayLabel, durationLabel, instantDayLabel, MINUTE, resolveTimeZone, type DayKey } from './_components/tz';
import { CardSkeleton, GhostButton } from './_components/primitives';
import { StationStep, computeStationAvailability } from './_components/station-step';
import { WhenStep, buildDays } from './_components/when-step';
import { DetailsStep } from './_components/details-step';
import { ReviewStep } from './_components/review-step';
import { SummaryBar } from './_components/summary-bar';
import { SuccessScreen } from './_components/success-screen';
import { MyBooking } from './_components/my-booking';
import { WaitlistSheet } from './_components/waitlist';
import type { BookingResult, Contact, Step, SuccessData } from './_components/types';

const STEP_ORDER: Step[] = ['station', 'when', 'details', 'review'];

export default function BookPage() {
  const toast = useToast();
  const reduce = useReducedMotion();
  const data = useBookingData();
  const { settings, rows, busy, busySupported, now, reload } = data;

  // ------------------------------------------------------------ derived settings
  const tz = useMemo(() => resolveTimeZone(settings?.timezone), [settings?.timezone]);
  const todayKey = useMemo(() => dayKeyOf(now, tz), [now, tz]);
  const maxDays = Math.min(30, Math.max(1, settings?.booking_max_days_ahead ?? 7));
  const horizon = horizonOf(now, maxDays);
  const sym = settings?.currency_symbol || rows?.[0]?.currency_symbol || '₹';
  const cafeName = settings?.cafe_name || 'Gaming Cafe';
  const bookingOpen = settings ? settings.allow_public_bookings !== false : true;
  const waitlistEnabled = settings ? settings.waitlist_enabled !== false : true;

  const busyMap = useMemo(() => buildBusyMap(busySupported ? busy : null, rows, now), [busy, busySupported, rows, now]);
  const stations = useMemo(
    () => (rows ? computeStationAvailability(rows, busyMap, now, horizon) : []),
    [rows, busyMap, now, horizon]
  );

  // ------------------------------------------------------------ flow state
  const [tab, setTab] = useState<'book' | 'manage'>('book');
  const [step, setStep] = useState<Step>('station');
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<DayKey | null>(null);
  const [duration, setDuration] = useState(60);
  const [start, setStart] = useState<number | null>(null);
  const [startIsNow, setStartIsNow] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [notes, setNotes] = useState('');
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState<{ name?: boolean; mobile?: boolean }>({});
  const [showErrors, setShowErrors] = useState(false);
  const [savedContact, setSavedContact] = useState<Contact | null>(null);
  const [lastBooking, setLastBooking] = useState<LastBooking | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SuccessData | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const [estimates, setEstimates] = useState<Record<string, number | null>>({});
  const [estimating, setEstimating] = useState(false);
  const resultRef = useRef(false);
  resultRef.current = result !== null;

  // repeat customers: restore contact + last booking (device only)
  useEffect(() => {
    const c = loadContact();
    if (c) {
      setName(c.name);
      setMobile(c.mobile);
      setSavedContact(c);
    }
    setLastBooking(loadLastBooking());
  }, []);

  const resource: AvailabilityRow | null = useMemo(
    () => rows?.find((r) => r.resource_id === resourceId) ?? null,
    [rows, resourceId]
  );
  const intervals = resourceId ? busyMap.get(resourceId) : undefined;
  const activeDay = dayKey && dayKey >= todayKey ? dayKey : todayKey;

  const days = useMemo(
    () =>
      resource
        ? buildDays({ todayKey, maxDays, tz, now, horizon, intervals, durationMin: duration })
        : [],
    [resource, todayKey, maxDays, tz, now, horizon, intervals, duration]
  );

  // ------------------------------------------------------------ navigation
  const goTo = useCallback(
    (next: Step) => {
      setStep(next);
      try {
        window.history.pushState({ bookStep: next }, '');
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    },
    [reduce]
  );

  const back = useCallback(() => {
    const st = window.history.state as { bookStep?: Step } | null;
    if (st?.bookStep) window.history.back();
    else setStep((s) => STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(s) - 1)]);
  }, []);

  const resetSelection = useCallback(() => {
    setResourceId(null);
    setStart(null);
    setStartIsNow(false);
    setNotice(null);
    setNotes('');
    setSubmitError(null);
    setShowErrors(false);
    setTouched({});
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { bookStep?: Step } | null)?.bookStep;
      if (resultRef.current) {
        setResult(null);
        resetSelection();
        setStep('station');
        return;
      }
      setStep(s && STEP_ORDER.includes(s) ? s : 'station');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [resetSelection]);

  // ------------------------------------------------------------ keep the selection valid as data refreshes
  useEffect(() => {
    if (!rows || !resourceId) return;
    if (!resource || resource.status === 'MAINTENANCE') {
      resetSelection();
      setStep('station');
      toast.error(messageFor('RESOURCE_UNAVAILABLE'));
    }
  }, [rows, resource, resourceId, resetSelection, toast]);

  useEffect(() => {
    if (start === null || !resource || submitting) return;
    if (startIsNow) {
      const ns = nowStart(now);
      if (isFree(intervals, ns, duration)) {
        if (ns !== start && ns > start) setStart(ns);
        return;
      }
    } else if (isBookable(intervals, start, duration, now, horizon)) {
      return;
    }
    const passed = !startIsNow && start < now - GRACE_MS;
    setStart(null);
    setStartIsNow(false);
    setNotice(passed ? 'That start time has passed — pick a new one.' : messageFor('SLOT_TAKEN'));
    if (step === 'details' || step === 'review') setStep('when');
  }, [now, intervals, start, startIsNow, duration, horizon, resource, step, submitting]);

  // ------------------------------------------------------------ price estimate (server-side, cached)
  const estimateKey = resourceId ? `${resourceId}:${duration}` : null;
  const estimatesRef = useRef(estimates);
  estimatesRef.current = estimates;
  useEffect(() => {
    if (!resourceId || !estimateKey || estimateKey in estimatesRef.current) return;
    let cancelled = false;
    (async () => {
      setEstimating(true);
      let value: number | null = null;
      try {
        const { data: est, error } = await getSupabase().rpc('estimate_booking_amount', {
          p_resource_id: resourceId,
          p_duration_minutes: duration,
        });
        value = error || est == null ? null : num(est);
      } catch {
        value = null;
      }
      if (!cancelled) {
        setEstimates((m) => ({ ...m, [estimateKey]: value }));
        setEstimating(false);
      }
    })();
    return () => {
      cancelled = true;
      setEstimating(false);
    };
  }, [resourceId, duration, estimateKey]);

  const localEstimate =
    resource?.hourly_rate ? Math.round(((resource.hourly_rate / 60) * duration) * 100) / 100 : null;
  const price = (estimateKey ? estimates[estimateKey] : null) ?? localEstimate;
  const priceSym = resource?.currency_symbol || sym;

  // ------------------------------------------------------------ handlers
  const pickStation = (row: AvailabilityRow, firstFree: number | null) => {
    if (row.resource_id !== resourceId) {
      setStart(null);
      setStartIsNow(false);
    }
    setResourceId(row.resource_id);
    setNotice(null);
    setSubmitError(null);
    setDayKey(firstFree !== null ? dayKeyOf(firstFree, tz) : todayKey);
    goTo('when');
  };

  const bookNow = (row: AvailabilityRow) => {
    const iv = busyMap.get(row.resource_id);
    const ns = nowStart(now);
    const d = [duration, 60, 30].find((m) => isFree(iv, ns, m)) ?? 30;
    setResourceId(row.resource_id);
    setDuration(d);
    setDayKey(todayKey);
    setStart(ns);
    setStartIsNow(true);
    setNotice(null);
    setSubmitError(null);
    goTo('when');
  };

  const changeDay = (k: DayKey) => {
    setDayKey(k);
    setNotice(null);
    if (start !== null && dayKeyOf(start, tz) !== k) {
      setStart(null);
      setStartIsNow(false);
    }
  };

  const changeDuration = (m: number) => {
    setDuration(m);
    if (start === null) return;
    const s = startIsNow ? nowStart(now) : start;
    if (!isFree(intervals, s, m)) {
      setNotice(
        `${startIsNow ? 'Starting now' : formatClock(start, tz)} doesn’t fit ${durationLabel(m)} — pick another time.`
      );
      setStart(null);
      setStartIsNow(false);
    } else setNotice(null);
  };

  const chooseStart = (ms: number, isNow: boolean) => {
    setStart(ms);
    setStartIsNow(isNow);
    setNotice(null);
    setSubmitError(null);
    const k = dayKeyOf(ms, tz);
    if (k !== activeDay) setDayKey(k);
  };

  const nameError = validateName(name);
  const mobileError = validateMobile(mobile);
  const detailErrors = {
    name: touched.name || showErrors ? nameError : null,
    mobile: touched.mobile || showErrors ? mobileError : null,
  };

  const continueFromWhen = () => {
    if (start === null) {
      setNotice('Pick a start time to continue.');
      return;
    }
    // returning customers with saved, valid details skip straight to review
    if (savedContact && !nameError && !mobileError) goTo('review');
    else goTo('details');
  };

  const continueFromDetails = () => {
    setShowErrors(true);
    if (nameError || mobileError) {
      document.getElementById(nameError ? 'bk-name' : 'bk-mobile')?.focus();
      return;
    }
    goTo('review');
  };

  async function submit() {
    if (!resource || start === null || submitting) return;
    if (nameError || mobileError) {
      setShowErrors(true);
      goTo('details');
      return;
    }
    // "start now" bookings: never send a start that slipped into the past
    const s = startIsNow ? Math.max(start, Math.ceil(Date.now() / MINUTE) * MINUTE) : start;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data: res, error } = await getSupabase().rpc('public_create_booking', {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_resource_id: resource.resource_id,
        p_start_time: new Date(s).toISOString(),
        p_duration_minutes: duration,
        p_notes: notes.trim() || null,
      });
      if (error) {
        const code = errorCode(error);
        const msg = errorMessage(error);
        switch (code) {
          case 'SLOT_TAKEN':
          case 'INVALID_START_TIME':
            setStart(null);
            setStartIsNow(false);
            setNotice(msg);
            void reload();
            goTo('when');
            break;
          case 'TOO_FAR_AHEAD':
          case 'INVALID_DURATION':
            setStart(null);
            setNotice(msg);
            goTo('when');
            break;
          case 'INVALID_NAME':
          case 'INVALID_MOBILE':
            setShowErrors(true);
            toast.error(msg);
            goTo('details');
            break;
          case 'RESOURCE_UNAVAILABLE':
            resetSelection();
            toast.error(msg);
            void reload();
            goTo('station');
            break;
          case 'BOOKINGS_DISABLED':
            setSubmitError(msg);
            void reload();
            break;
          default:
            setSubmitError(msg);
        }
        return;
      }
      const booking = res as BookingResult;
      const contact = { name: name.trim(), mobile: mobile.trim() };
      saveContact(remember ? contact : null);
      setSavedContact(remember ? contact : null);
      const last = { code: booking.booking_code, mobile: contact.mobile };
      saveLastBooking(last);
      setLastBooking(last);
      setResult({ ...booking, ...contact, notes: notes.trim() });
      window.scrollTo({ top: 0 });
      void reload();
    } catch {
      setSubmitError(messageFor('NETWORK'));
    } finally {
      setSubmitting(false);
    }
  }

  const bookAnother = () => {
    setResult(null);
    resetSelection();
    setTab('book');
    goTo('station');
  };

  // ------------------------------------------------------------ render helpers
  const effectiveStep: Step = !resource ? 'station' : step === 'review' && start === null ? 'when' : step;
  const showBar = tab === 'book' && !result && !!rows && bookingOpen && !!resource && effectiveStep !== 'station';

  let bar: React.ReactNode = null;
  if (showBar && resource) {
    const when =
      start !== null
        ? `${startIsNow ? 'Now' : `${instantDayLabel(start, tz, todayKey).split(',')[0]} ${formatClock(start, tz)}`}`
        : `${dayLabel(activeDay, todayKey).top} · pick a time`;
    const detail = `${when} · ${durationLabel(duration)}`;
    const priceLabel = price !== null ? formatMoney(price, priceSym) : null;
    if (effectiveStep === 'when')
      bar = (
        <SummaryBar
          title={resource.name}
          detail={detail}
          price={priceLabel}
          ctaLabel="Continue"
          ctaDisabled={start === null}
          onCta={continueFromWhen}
        />
      );
    else if (effectiveStep === 'details')
      bar = <SummaryBar title={resource.name} detail={detail} price={priceLabel} ctaLabel="Review" onCta={continueFromDetails} />;
    else
      bar = (
        <SummaryBar
          title={resource.name}
          detail={detail}
          price={priceLabel}
          ctaLabel={submitting ? 'Booking…' : 'Confirm'}
          busy={submitting}
          final
          onCta={submit}
        />
      );
  }

  const stepMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, x: 28 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -28 },
        transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
      };

  let content: React.ReactNode;
  if (result) {
    content = (
      <SuccessScreen
        result={result}
        tz={tz}
        todayKey={todayKey}
        cafeName={cafeName}
        phone={settings?.phone ?? null}
        address={settings?.address ?? null}
        sym={sym}
        onBookAnother={bookAnother}
        onManage={() => {
          setResult(null);
          resetSelection();
          setStep('station');
          setTab('manage');
        }}
      />
    );
  } else if (tab === 'manage') {
    content = (
      <MyBooking
        key={lastBooking?.code ?? 'none'}
        tz={tz}
        todayKey={todayKey}
        sym={sym}
        initialCode={lastBooking?.code ?? ''}
        initialMobile={lastBooking?.mobile ?? savedContact?.mobile ?? ''}
        onBookNew={bookAnother}
      />
    );
  } else if (!rows && data.error) {
    content = (
      <div className="glass hud mt-6 rounded-lg p-8 text-center">
        <WifiOff className="mx-auto h-9 w-9 text-muted" aria-hidden />
        <p className="mt-4 font-display text-3xl uppercase">Can&apos;t connect</p>
        <p className="mt-2 text-sm text-muted">
          {data.error === 'offline'
            ? 'Looks like you’re offline. Check your connection and try again.'
            : 'We couldn’t load live availability. Please try again.'}
        </p>
        <GhostButton onClick={() => void reload()} className="mt-5" disabled={data.refreshing}>
          <RefreshCw className={`h-4 w-4 ${data.refreshing ? 'animate-spin' : ''}`} aria-hidden /> Retry
        </GhostButton>
      </div>
    );
  } else if (!rows) {
    content = (
      <div aria-busy="true" aria-label="Loading live availability">
        <div className="mb-5 space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-surface-3" />
          <div className="h-10 w-3/4 animate-pulse rounded bg-surface-3" />
        </div>
        <div className="space-y-3.5">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  } else {
    const stationStep = (
      <StationStep
        stations={stations}
        tz={tz}
        todayKey={todayKey}
        sym={sym}
        bookingOpen={bookingOpen}
        waitlistEnabled={waitlistEnabled}
        selectedId={resourceId}
        onBookNow={bookNow}
        onPick={pickStation}
        onWaitlist={() => setWaitlistOpen(true)}
      />
    );
    content = (
      <>
        {!bookingOpen && (
          <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
            <p className="font-hud text-sm font-bold uppercase tracking-wider text-warning">Online booking is paused</p>
            <p className="mt-1 text-sm text-muted">
              Walk-ins are welcome — check live availability below
              {settings?.phone ? ', or give us a call' : ''}.
              {waitlistEnabled ? ' You can also join the waitlist and we’ll call you.' : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {settings?.phone && (
                <a
                  href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border-strong bg-surface-2/60 px-4 font-hud text-xs font-bold uppercase tracking-widest"
                >
                  <Phone className="h-4 w-4" aria-hidden /> Call
                </a>
              )}
              {waitlistEnabled && (
                <button
                  type="button"
                  onClick={() => setWaitlistOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-warning px-4 font-hud text-xs font-bold uppercase tracking-widest text-black"
                >
                  <Hourglass className="h-4 w-4" aria-hidden /> Join waitlist
                </button>
              )}
            </div>
          </div>
        )}
        {bookingOpen ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={effectiveStep} {...stepMotion}>
              {effectiveStep === 'station' && stationStep}
              {effectiveStep === 'when' && resource && (
                <WhenStep
                  resource={resource}
                  tz={tz}
                  todayKey={todayKey}
                  now={now}
                  horizon={horizon}
                  days={days}
                  intervals={intervals}
                  dayKey={activeDay}
                  onDay={changeDay}
                  duration={duration}
                  onDuration={changeDuration}
                  start={start}
                  startIsNow={startIsNow}
                  onStart={chooseStart}
                  notice={notice}
                  fallbackMode={!busySupported}
                  waitlistEnabled={waitlistEnabled}
                  onWaitlist={() => setWaitlistOpen(true)}
                  onBack={back}
                />
              )}
              {effectiveStep === 'details' && (
                <DetailsStep
                  name={name}
                  mobile={mobile}
                  notes={notes}
                  remember={remember}
                  errors={detailErrors}
                  returning={savedContact ? savedContact.name.split(' ')[0] : null}
                  onName={setName}
                  onMobile={setMobile}
                  onNotes={setNotes}
                  onRemember={setRemember}
                  onBlurField={(f) => setTouched((t) => ({ ...t, [f]: true }))}
                  onSubmit={continueFromDetails}
                  onBack={back}
                />
              )}
              {effectiveStep === 'review' && resource && start !== null && (
                <ReviewStep
                  resource={resource}
                  tz={tz}
                  todayKey={todayKey}
                  start={startIsNow ? Math.max(start, nowStart(now)) : start}
                  startIsNow={startIsNow}
                  duration={duration}
                  name={name}
                  mobile={mobile}
                  notes={notes}
                  estimate={price}
                  estimating={estimating}
                  sym={priceSym}
                  error={submitError}
                  onEdit={(s) => goTo(s)}
                  onBack={back}
                />
              )}
            </motion.div>
          </AnimatePresence>
        ) : (
          stationStep
        )}
      </>
    );
  }

  const stale = !!rows && (!data.online || !!data.error);

  return (
    <div className={`${anton.variable} ${chakraPetch.variable} relative min-h-dvh overflow-x-clip`}>
      {/* backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-0" aria-hidden>
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(rgba(124,58,237,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.09) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%, black 25%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 55% at 50% 0%, black 25%, transparent 100%)',
          }}
        />
        <div className="absolute -top-24 left-[-10%] h-72 w-72 rounded-full bg-primary/20 blur-[110px]" />
        <div className="absolute right-[-15%] top-56 h-72 w-72 rounded-full bg-secondary/10 blur-[120px]" />
      </div>

      {/* header */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label={`${cafeName} home`}>
            <Logo className="h-8 w-auto" alt="" />
            <span className="truncate font-hud text-xs font-bold uppercase tracking-[0.18em]">{cafeName}</span>
          </Link>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 font-hud text-[10px] font-bold uppercase tracking-widest ${
              stale ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'
            }`}
            aria-live="polite"
          >
            {data.refreshing && !rows ? (
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-warning' : 'bg-success animate-pulse-dot'}`} aria-hidden />
            )}
            {stale ? 'Offline' : 'Live'}
          </span>
        </div>
      </header>

      <main className={`relative mx-auto max-w-lg px-4 pt-4 ${showBar ? 'pb-36' : 'pb-16'}`}>
        {!result && (
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-surface/60 p-1" role="tablist" aria-label="Booking options">
            {(
              [
                ['book', 'Book a station'],
                ['manage', 'My booking'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-[44px] rounded-md font-hud text-xs font-bold uppercase tracking-widest transition-colors ${
                  tab === id ? 'bg-surface-3 text-content shadow-card' : 'text-muted hover:text-content'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {stale && !result && tab === 'book' && (
          <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
            <span className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
              Connection lost — showing the last known availability.
            </span>
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded px-2 font-hud font-bold uppercase tracking-widest hover:text-content"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${data.refreshing ? 'animate-spin' : ''}`} aria-hidden /> Retry
            </button>
          </div>
        )}

        {!result && tab === 'book' && effectiveStep === 'station' && lastBooking && rows && (
          <button
            type="button"
            onClick={() => setTab('manage')}
            className="mb-4 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-secondary/30 bg-secondary/10 px-3.5 text-left text-sm"
          >
            <span className="flex items-center gap-2 text-content/90">
              <Ticket className="h-4 w-4 text-secondary" aria-hidden />
              Your last booking <span className="font-hud font-bold tracking-wider">{lastBooking.code}</span>
            </span>
            <span className="font-hud text-[11px] font-bold uppercase tracking-widest text-secondary">View</span>
          </button>
        )}

        {content}

        {!result && (
          <footer className="mt-12 text-center font-hud text-[11px] uppercase tracking-[0.2em] text-muted/80">
            <p>Walk-ins welcome · Pay at the counter</p>
            {(settings?.phone || settings?.address) && (
              <p className="mt-2 normal-case tracking-normal text-muted/70">
                {[settings?.address, settings?.phone].filter(Boolean).join(' · ')}
              </p>
            )}
          </footer>
        )}
      </main>

      {bar}

      <WaitlistSheet
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        rows={(rows ?? []).filter((r) => r.status !== 'MAINTENANCE')}
        defaultResourceId={resourceId}
        defaultDuration={duration}
        contact={savedContact ?? (name || mobile ? { name, mobile } : null)}
        onJoined={(c) => {
          if (remember) {
            saveContact(c);
            setSavedContact(c);
          }
          if (!name) setName(c.name);
          if (!mobile) setMobile(c.mobile);
        }}
      />
    </div>
  );
}
