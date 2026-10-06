'use client';

import { useState } from 'react';
import { Search, Ticket, XCircle } from 'lucide-react';
import { formatClock, formatMoney, num } from '@/lib/billing/format';
import { useToast } from '@/components/ui/toast';
import { errorCode, errorMessage, getSupabase, saveLastBooking, validateMobile } from './api';
import { durationLabel, instantDayLabel, type DayKey } from './tz';
import { ConfirmDialog, Field, PrimaryButton, StatusPill, inputClass, type Tone } from './primitives';
import type { LookupResult } from './types';

const STATUS: Record<string, { tone: Tone; label: string; note: string }> = {
  PENDING: { tone: 'warning', label: 'Pending', note: 'We’ve got your request — the counter will confirm it shortly.' },
  CONFIRMED: { tone: 'success', label: 'Confirmed', note: 'All set. Show your code at the counter when you arrive.' },
  CHECKED_IN: { tone: 'primary', label: 'Checked in', note: 'You’re checked in — enjoy the game!' },
  COMPLETED: { tone: 'muted', label: 'Completed', note: 'This booking has been completed. Thanks for playing!' },
  CANCELLED: { tone: 'danger', label: 'Cancelled', note: 'This booking was cancelled.' },
  NO_SHOW: { tone: 'danger', label: 'No-show', note: 'This booking was marked as a no-show.' },
};

export function MyBooking({
  tz,
  todayKey,
  sym,
  initialCode,
  initialMobile,
  onBookNew,
}: {
  tz: string;
  todayKey: DayKey;
  sym: string;
  initialCode: string;
  initialMobile: string;
  onBookNew: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(initialCode);
  const [mobile, setMobile] = useState(initialMobile);
  const [errors, setErrors] = useState<{ code?: string; mobile?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<LookupResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    const next: typeof errors = {};
    if (code.trim().length < 3) next.code = 'Enter the booking code from your confirmation.';
    const m = validateMobile(mobile);
    if (m) next.mobile = m;
    setErrors(next);
    if (next.code || next.mobile) return;
    setLoading(true);
    try {
      const { data, error } = await getSupabase().rpc('public_lookup_booking', {
        p_code: code.trim(),
        p_mobile: mobile.trim(),
      });
      if (error) {
        setBooking(null);
        setErrors({ form: errorMessage(error) });
        return;
      }
      setBooking(data as LookupResult);
      saveLastBooking({ code: code.trim().toUpperCase(), mobile: mobile.trim() });
    } catch {
      setErrors({ form: errorMessage({ message: 'Failed to fetch' }) });
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    if (!booking) return;
    setCancelling(true);
    try {
      const { data, error } = await getSupabase().rpc('public_cancel_booking', {
        p_code: booking.booking_code,
        p_mobile: mobile.trim(),
      });
      if (error) {
        toast.error(errorMessage(error));
        if (errorCode(error) === 'BOOKING_NOT_CANCELLABLE') void lookup();
        return;
      }
      const status = (data as { status?: string } | null)?.status ?? 'CANCELLED';
      setBooking({ ...booking, status });
      toast.success('Booking cancelled');
      setConfirmOpen(false);
    } catch {
      toast.error(errorMessage({ message: 'Failed to fetch' }));
    } finally {
      setCancelling(false);
    }
  }

  const meta = booking ? STATUS[booking.status] ?? { tone: 'muted' as Tone, label: booking.status, note: '' } : null;
  const start = booking ? Date.parse(booking.start_time) : 0;
  const end = booking ? Date.parse(booking.end_time) : 0;
  const cancellable = booking && (booking.status === 'PENDING' || booking.status === 'CONFIRMED');

  return (
    <div>
      <p className="font-hud text-[11px] font-bold uppercase tracking-[0.3em] text-primary">My booking</p>
      <h1 className="mt-1.5 font-display text-[2.6rem] uppercase leading-[0.95] tracking-tight">Find your slot</h1>
      <p className="mt-2 text-sm text-muted">Enter your booking code and the mobile number you booked with.</p>

      <form onSubmit={lookup} noValidate className="mt-5 space-y-4">
        <Field label="Booking code" htmlFor="mb-code" error={errors.code}>
          <input
            id="mb-code"
            className={`${inputClass} font-hud uppercase tracking-[0.2em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="GC-1234"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? 'mb-code-error' : undefined}
          />
        </Field>
        <Field label="Mobile number" htmlFor="mb-mobile" error={errors.mobile}>
          <input
            id="mb-mobile"
            type="tel"
            inputMode="tel"
            className={inputClass}
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="98765 43210"
            autoComplete="tel"
            maxLength={16}
            aria-invalid={!!errors.mobile}
            aria-describedby={errors.mobile ? 'mb-mobile-error' : undefined}
          />
        </Field>
        {errors.form && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm font-semibold text-danger">
            {errors.form}
          </p>
        )}
        <PrimaryButton type="submit" busy={loading} className="w-full">
          <Search className="h-4 w-4" aria-hidden /> {loading ? 'Searching…' : 'Find booking'}
        </PrimaryButton>
      </form>

      {booking && meta && (
        <section aria-label="Booking details" className="glass hud mt-6 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 font-hud text-[10px] font-bold uppercase tracking-[0.25em] text-muted">
                <Ticket className="h-3.5 w-3.5" aria-hidden /> Code
              </p>
              <p className="mt-1 font-display text-3xl leading-none tracking-[0.06em]">{booking.booking_code}</p>
            </div>
            <StatusPill tone={meta.tone} pulse={booking.status === 'CONFIRMED'}>
              {meta.label}
            </StatusPill>
          </div>
          {meta.note && <p className="mt-3 text-sm text-muted">{meta.note}</p>}
          <dl className="mt-3 divide-y divide-border/60 border-t border-border/60">
            {[
              ['Station', booking.resource_name],
              ['When', `${instantDayLabel(start, tz, todayKey)} · ${formatClock(start, tz)} – ${formatClock(end, tz)}`],
              ['Duration', durationLabel(booking.duration_minutes)],
              ['Name', booking.customer_name],
              ...(booking.estimated_amount != null ? [['Estimated', formatMoney(num(booking.estimated_amount), sym)]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="font-hud text-[10px] font-bold uppercase tracking-[0.22em] text-muted">{k}</dt>
                <dd className="text-right text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {cancellable ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-danger/50 bg-danger/10 font-hud text-xs font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/20"
            >
              <XCircle className="h-4 w-4" aria-hidden /> Cancel booking
            </button>
          ) : booking.status === 'CANCELLED' ? (
            <PrimaryButton onClick={onBookNew} className="mt-4 w-full">
              Book a new slot
            </PrimaryButton>
          ) : null}
        </section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Cancel booking?"
        body={
          booking ? (
            <>
              Your <span className="font-semibold text-content">{booking.resource_name}</span> slot on{' '}
              <span className="font-semibold text-content">
                {instantDayLabel(start, tz, todayKey)} at {formatClock(start, tz)}
              </span>{' '}
              will be released for someone else. This can&apos;t be undone.
            </>
          ) : null
        }
        confirmLabel="Yes, cancel"
        busy={cancelling}
        onConfirm={cancel}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
