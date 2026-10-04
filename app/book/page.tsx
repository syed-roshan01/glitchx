'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/utils/errors';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { useToast } from '@/components/ui/toast';
import { Logo } from '@/components/ui/logo';
import { formatMoney, formatClock, formatDate } from '@/lib/billing/format';
import type { AvailabilityRow, CafeSettings } from '@/types';
import {
  RefreshCw, CheckCircle2, Clock, Users, X, ChevronRight, Hourglass,
} from 'lucide-react';

interface BookingResult {
  booking_code: string;
  resource_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  estimated_amount: number | null;
}

export default function BookPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [bookingResource, setBookingResource] = useState<AvailabilityRow | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [result, setResult] = useState<(BookingResult & { name: string; mobile: string }) | null>(null);
  const clientRef = useRef<ReturnType<typeof createBrowserSupabaseClient> | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = createBrowserSupabaseClient();
    return clientRef.current;
  }, []);

  const load = useCallback(async () => {
    const supabase = getClient();
    // lazy-activate due sessions so availability is accurate (fire-and-forget)
    void supabase.rpc('activate_due_sessions').then(undefined, () => {});
    const [avail, settingsRes] = await Promise.all([
      supabase.rpc('public_get_availability'),
      supabase.from('settings').select('*').eq('id', 'default').single(),
    ]);
    if (avail.error) {
      toast.error('Could not load availability. Please refresh.');
      return;
    }
    setRows((avail.data as AvailabilityRow[]) ?? []);
    if (settingsRes.data) setSettings(settingsRes.data as CafeSettings);
  }, [getClient]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // REALTIME: sessions/bookings change resources.current_status via trigger;
  // subscribing to resources instantly refreshes availability. No refresh needed.
  const refetch = useDebouncedCallback(load, 400);
  useRealtime('resources', refetch);
  useRealtime('sessions', refetch);
  useRealtime('bookings', refetch);

  if (result) {
    return <SuccessScreen result={result} cafeName={settings?.cafe_name ?? 'Gaming Cafe'} onDone={() => { setResult(null); load(); }} />;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 pb-16 pt-8">
      {/* header */}
      <header className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <Logo className="h-16 w-auto rounded-2xl shadow-glow" alt={settings?.cafe_name ?? 'Gaming Cafe'} />
        </div>
        <h1 className="text-2xl font-black tracking-tight">{settings?.cafe_name ?? 'Gaming Cafe'}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse-dot" aria-hidden />
          Live availability — updates automatically
        </p>
      </header>

      {/* availability */}
      {!rows ? (
        <div className="space-y-4" aria-label="Loading availability">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass h-36 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-lg font-bold">Coming soon!</p>
          <p className="mt-1 text-sm text-muted">No stations are bookable right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <ResourceCard key={r.resource_id} row={r} onBook={() => setBookingResource(r)} onWaitlist={() => setWaitlistOpen(true)} />
          ))}
        </div>
      )}

      {/* waitlist hint */}
      {rows && rows.length > 0 && (
        <button
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-4 text-sm font-bold text-warning"
          onClick={() => setWaitlistOpen(true)}
        >
          <Hourglass className="h-4 w-4" aria-hidden />
          Everything busy? Join the waitlist
        </button>
      )}

      <footer className="mt-10 text-center text-xs text-muted">
        <p>
          Walk-ins always welcome · Pay at the counter
        </p>
      </footer>

      {/* booking modal */}
      {bookingResource && (
        <BookingModal
          resource={bookingResource}
          settings={settings}
          maxDaysAhead={settings?.booking_max_days_ahead ?? 7}
          onClose={() => setBookingResource(null)}
          onBooked={(res, name, mobile) => setResult({ ...res, name, mobile })}
        />
      )}

      {/* waitlist modal */}
      {waitlistOpen && (
        <WaitlistModal
          rows={rows ?? []}
          onClose={() => setWaitlistOpen(false)}
          onJoined={() => {
            setWaitlistOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------- resource card ----------------

const STATUS_STYLES: Record<string, { ring: string; text: string; chip: string; label: string }> = {
  AVAILABLE: { ring: 'border-l-success', text: 'text-success', chip: 'border-success/30 bg-success/10', label: 'AVAILABLE' },
  BUSY: { ring: 'border-l-danger', text: 'text-danger', chip: 'border-danger/30 bg-danger/10', label: 'BUSY' },
  RESERVED: { ring: 'border-l-warning', text: 'text-warning', chip: 'border-warning/30 bg-warning/10', label: 'RESERVED' },
  MAINTENANCE: { ring: 'border-l-muted', text: 'text-muted', chip: 'border-muted/30 bg-muted/10', label: 'MAINTENANCE' },
};

function ResourceCard({
  row, onBook, onWaitlist,
}: {
  row: AvailabilityRow;
  onBook: () => void;
  onWaitlist: () => void;
}) {
  const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.MAINTENANCE;
  const canBook = row.status === 'AVAILABLE' || row.status === 'RESERVED';

  return (
    <article className={`glass rounded-2xl border-l-4 p-5 shadow-card ${style.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold">{row.name}</h2>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{row.resource_type.replace(/_/g, ' ')}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${style.text} ${style.chip}`}>
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${row.status === 'AVAILABLE' ? 'animate-pulse-dot' : ''}`} style={{ backgroundColor: 'currentColor' }} />
          {style.label}
        </span>
      </div>

      {/* status detail */}
      <div className="mt-3 min-h-[24px] text-sm text-muted">
        {row.status === 'AVAILABLE' && row.rate_label && (
          <p>
            <span className="text-xl font-black text-content">{row.rate_label.split('/hour')[0]}</span>
            <span className="text-xs">/hour</span>
          </p>
        )}
        {row.status === 'BUSY' && (
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {row.session_started_at ? `Started ${formatClock(row.session_started_at)}` : 'In use'}
            {row.busy_until ? ` · expected until ${formatClock(row.busy_until)}` : ''}
          </p>
        )}
        {row.status === 'RESERVED' && row.next_booking_start && (
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Reserved from {formatClock(row.next_booking_start)}
            {row.rate_label ? ` · ${row.rate_label}` : ''}
          </p>
        )}
        {row.status === 'MAINTENANCE' && <p>Back soon — under maintenance</p>}
      </div>

      <button
        onClick={canBook ? onBook : onWaitlist}
        disabled={false}
        className={`mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-extrabold transition-transform active:scale-[0.98] ${
          canBook
            ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glow-sm'
            : 'border border-warning/50 bg-warning/10 text-warning'
        }`}
      >
        {canBook ? 'BOOK NOW' : 'JOIN WAITLIST'}
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
    </article>
  );
}

// ---------------- booking modal ----------------

function BookingModal({
  resource, settings, maxDaysAhead, onClose, onBooked,
}: {
  resource: AvailabilityRow;
  settings: CafeSettings | null;
  maxDaysAhead: number;
  onClose: () => void;
  onBooked: (result: BookingResult, name: string, mobile: string) => void;
}) {
  const toast = useToast();
  const [dayOffset, setDayOffset] = useState(0);
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const list: { offset: number; label: string; date: Date }[] = [];
    for (let i = 0; i <= Math.min(maxDaysAhead, 7); i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      list.push({
        offset: i,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDate(d).slice(0, 6),
        date: d,
      });
    }
    return list;
  }, [maxDaysAhead]);

  const slots = useMemo(() => {
    const now = new Date();
    const base = new Date(days[dayOffset].date);
    base.setHours(0, 0, 0, 0);
    const out: { value: string; label: string; disabled: boolean }[] = [];
    // default start: when busy/reserved, offer the next free moment
    let firstSlot = new Date(Math.ceil((now.getTime() + 15 * 60000) / (30 * 60000)) * 30 * 60000);
    if (resource.status === 'RESERVED' && resource.next_booking_start) {
      const nb = new Date(resource.next_booking_start);
      if (nb > firstSlot) firstSlot = new Date(Math.ceil(nb.getTime() / (30 * 60000)) * 30 * 60000);
    }
    for (let i = 0; i < 48; i++) {
      const t = new Date(base.getTime() + i * 30 * 60000);
      const value = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      out.push({ value, label: formatClock(t), disabled: dayOffset === 0 && t < firstSlot });
    }
    return out;
  }, [days, dayOffset, resource]);

  useEffect(() => {
    const first = slots.find((s) => !s.disabled);
    setStartTime(first?.value ?? '');
  }, [slots]);

  const effectiveDuration = duration === -1 ? Math.max(15, Math.min(480, Number(customDuration) || 60)) : duration;

  const startDateTime = useMemo(() => {
    if (!startTime) return null;
    const d = new Date(days[dayOffset].date);
    const [h, m] = startTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  }, [days, dayOffset, startTime]);

  // estimate from the advertised rate (server computes exact on booking)
  const estimate = resource.hourly_rate
    ? Math.round(((resource.hourly_rate / 60) * effectiveDuration) * 100) / 100
    : null;
  const sym = resource.currency_symbol || settings?.currency_symbol || '₹';

  async function confirm() {
    if (!startDateTime) {
      toast.error('Pick a start time');
      return;
    }
    if (name.trim().length < 2) {
      toast.error('Please enter your name');
      return;
    }
    if (!/^\+?\d{7,15}$/.test(mobile.replace(/[\s\-]/g, ''))) {
      toast.error('Please enter a valid mobile number');
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.rpc('public_create_booking', {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_resource_id: resource.resource_id,
        p_start_time: startDateTime.toISOString(),
        p_duration_minutes: effectiveDuration,
        p_notes: null,
      });
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      onBooked(data as BookingResult, name.trim(), mobile.trim());
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Book ${resource.name}`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="glass relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-6 animate-slide-up sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black">{resource.name}</h2>
            <p className="text-xs text-muted">{resource.rate_label}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* day */}
        <p className="label-base">Day</p>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Booking day">
          {days.map((d) => (
            <button
              key={d.offset}
              role="radio"
              aria-checked={dayOffset === d.offset}
              onClick={() => setDayOffset(d.offset)}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold ${
                dayOffset === d.offset ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* time */}
        <p className="label-base">Start time</p>
        <div className="mb-4 grid max-h-40 grid-cols-4 gap-2 overflow-y-auto" role="radiogroup" aria-label="Start time">
          {slots.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-checked={startTime === s.value}
              disabled={s.disabled}
              onClick={() => setStartTime(s.value)}
              className={`rounded-lg py-2 text-xs font-bold tabular-nums ${
                startTime === s.value
                  ? 'bg-primary text-white'
                  : s.disabled
                    ? 'bg-surface-2/50 text-muted/30'
                    : 'bg-surface-2 text-muted hover:text-content'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* duration */}
        <p className="label-base">Duration</p>
        <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Duration">
          {[
            { v: 30, l: '30 min' },
            { v: 60, l: '1 hour' },
            { v: 90, l: '1.5 hours' },
            { v: 120, l: '2 hours' },
            { v: 180, l: '3 hours' },
            { v: -1, l: 'Custom' },
          ].map((d) => (
            <button
              key={d.v}
              role="radio"
              aria-checked={duration === d.v}
              onClick={() => setDuration(d.v)}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold ${
                duration === d.v ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
              }`}
            >
              {d.l}
            </button>
          ))}
        </div>
        {duration === -1 && (
          <div className="mb-4 flex items-center gap-2">
            <input
              type="number"
              min={15}
              max={480}
              step={15}
              value={customDuration}
              onChange={(e) => setCustomDuration(e.target.value)}
              className="input-base w-28"
              placeholder="Minutes"
              aria-label="Custom duration in minutes"
            />
            <span className="text-xs text-muted">minutes (15–480)</span>
          </div>
        )}

        {/* contact */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label-base" htmlFor="bk-name">Your name</label>
            <input id="bk-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul" autoComplete="name" />
          </div>
          <div>
            <label className="label-base" htmlFor="bk-mobile">Mobile number</label>
            <input id="bk-mobile" className="input-base" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="9876543210" inputMode="tel" autoComplete="tel" />
          </div>
        </div>

        {/* estimate + confirm */}
        <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">
              {resource.name} · {effectiveDuration} min{startDateTime ? ` from ${formatClock(startDateTime)}` : ''}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-bold">Estimated total</span>
            <span className="text-2xl font-black tabular-nums text-primary">
              {estimate != null ? formatMoney(estimate, sym) : '—'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted">Final amount is confirmed at the counter.</p>
        </div>

        <button
          onClick={confirm}
          disabled={busy || !startTime}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-base font-black text-white shadow-glow-sm transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <RefreshCw className="h-5 w-5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
          {busy ? 'Confirming…' : 'CONFIRM BOOKING'}
        </button>
      </div>
    </div>
  );
}

// ---------------- waitlist modal ----------------

function WaitlistModal({
  rows, onClose, onJoined,
}: {
  rows: AvailabilityRow[];
  onClose: () => void;
  onJoined: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [preferred, setPreferred] = useState('');
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  async function join() {
    if (name.trim().length < 2) {
      toast.error('Please enter your name');
      return;
    }
    if (!/^\+?\d{7,15}$/.test(mobile.replace(/[\s\-]/g, ''))) {
      toast.error('Please enter a valid mobile number');
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.rpc('public_join_waitlist', {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_resource_id: preferred || null,
        p_resource_type: null,
        p_duration_minutes: duration,
      });
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      setPosition((data as any)?.position ?? null);
      setTimeout(onJoined, 3500);
    } catch {
      toast.error('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Join waitlist">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="glass relative z-10 max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl p-6 animate-slide-up sm:rounded-3xl">
        {position !== null ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <Users className="h-8 w-8 text-success" aria-hidden />
            </div>
            <h2 className="text-xl font-black">You&apos;re on the list!</h2>
            <p className="mt-2 text-3xl font-black text-success">#{position}</p>
            <p className="mt-2 text-sm text-muted">
              We&apos;ll call you when a station frees up. Stay nearby!
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black">Join the waitlist</h2>
              <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label-base" htmlFor="wl-name">Your name</label>
                <input id="wl-name" className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun" />
              </div>
              <div>
                <label className="label-base" htmlFor="wl-mobile">Mobile number</label>
                <input id="wl-mobile" className="input-base" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="9876543210" inputMode="tel" />
              </div>
              <div>
                <label className="label-base" htmlFor="wl-resource">Preferred station (optional)</label>
                <select id="wl-resource" className="input-base" value={preferred} onChange={(e) => setPreferred(e.target.value)}>
                  <option value="">Any station</option>
                  {rows.map((r) => (
                    <option key={r.resource_id} value={r.resource_id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="label-base">How long do you want to play?</p>
                <div className="flex flex-wrap gap-2">
                  {[30, 60, 90, 120, 180].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-bold ${duration === d ? 'bg-primary text-white' : 'bg-surface-2 text-muted'}`}
                      aria-pressed={duration === d}
                    >
                      {d >= 60 ? `${d / 60}h` : `${d}m`}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={join}
                disabled={busy}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-warning to-primary text-base font-black text-white shadow-glow-sm transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? <RefreshCw className="h-5 w-5 animate-spin" aria-hidden /> : <Hourglass className="h-5 w-5" aria-hidden />}
                {busy ? 'Joining…' : 'JOIN WAITLIST'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- success ----------------

function SuccessScreen({
  result, cafeName, onDone,
}: {
  result: BookingResult & { name: string; mobile: string };
  cafeName: string;
  onDone: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-4 py-8 text-center">
      <div className="glass w-full rounded-3xl p-8 shadow-glow animate-slide-up">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
        </div>
        <h1 className="text-2xl font-black">Booking Confirmed!</h1>
        <p className="mt-1 text-sm text-muted">
          Show this code at the counter of {cafeName}
        </p>
        <p className="mt-5 rounded-2xl border border-primary/40 bg-primary/10 py-4 font-mono text-3xl font-black tracking-widest text-primary">
          {result.booking_code}
        </p>
        <dl className="mt-6 space-y-2.5 text-left text-sm">
          <Detail label="Station" value={result.resource_name} />
          <Detail label="Date" value={formatDate(result.start_time)} />
          <Detail label="Time" value={`${formatClock(result.start_time)} – ${formatClock(result.end_time)}`} />
          <Detail label="Duration" value={`${result.duration_minutes} minutes`} />
          <Detail label="Name" value={result.name} />
          <Detail label="Mobile" value={result.mobile} />
          {result.estimated_amount != null && <Detail label="Estimated total" value={formatMoney(result.estimated_amount)} />}
        </dl>
        <button
          onClick={onDone}
          className="mt-7 flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-primary to-secondary text-base font-black text-white shadow-glow-sm transition-transform active:scale-[0.98]"
        >
          Back to live availability
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
