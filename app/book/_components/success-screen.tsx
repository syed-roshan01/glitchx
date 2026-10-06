'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarPlus, Check, CheckCircle2, Copy, MapPin, Phone, Share2, Ticket } from 'lucide-react';
import { formatClock, formatMoney, num } from '@/lib/billing/format';
import { useToast } from '@/components/ui/toast';
import { buildIcs, copyText, downloadFile, shareOrCopy } from './share';
import { durationLabel, instantDayLabel, type DayKey } from './tz';
import { GhostButton, PrimaryButton } from './primitives';
import type { SuccessData } from './types';

export function SuccessScreen({
  result,
  tz,
  todayKey,
  cafeName,
  phone,
  address,
  sym,
  onBookAnother,
  onManage,
}: {
  result: SuccessData;
  tz: string;
  todayKey: DayKey;
  cafeName: string;
  phone: string | null;
  address: string | null;
  sym: string;
  onBookAnother: () => void;
  onManage: () => void;
}) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const start = Date.parse(result.start_time);
  const end = Date.parse(result.end_time);
  const when = `${instantDayLabel(start, tz, todayKey)} · ${formatClock(start, tz)} – ${formatClock(end, tz)}`;
  const amount = result.estimated_amount == null ? null : num(result.estimated_amount);

  const shareText = [
    `${cafeName} booking ${result.booking_code}`,
    `${result.resource_name} — ${when}`,
    'Show this code at the counter.',
    address ? `Address: ${address}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  async function copyCode() {
    const ok = await copyText(result.booking_code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else toast.error('Couldn’t copy — please note the code down.');
  }

  async function share() {
    const r = await shareOrCopy({ title: `${cafeName} booking`, text: shareText });
    if (r === 'copied') toast.success('Booking details copied');
    else if (r === 'failed') toast.error('Sharing isn’t supported on this device.');
  }

  function addToCalendar() {
    const ics = buildIcs({
      uid: `${result.booking_code}@glitchx`,
      start,
      end,
      summary: `${result.resource_name} @ ${cafeName}`,
      description: `Booking code: ${result.booking_code}\nShow this code at the counter.${
        phone ? `\nCafe: ${phone}` : ''
      }`,
      location: address,
    });
    downloadFile(`booking-${result.booking_code}.ics`, ics, 'text/calendar;charset=utf-8');
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="pt-2"
    >
      <div className="text-center">
        <motion.div
          initial={reduce ? false : { scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-success/40 bg-success/15"
        >
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
        </motion.div>
        <p className="mt-4 font-hud text-[11px] font-bold uppercase tracking-[0.3em] text-success">Booking locked in</p>
        <h1 className="mt-1.5 font-display text-5xl uppercase leading-[0.95] tracking-tight">
          You&apos;re{' '}
          <span className="glitch bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent" data-text="in.">
            in.
          </span>
        </h1>
      </div>

      {/* code */}
      <div className="glass hud relative mt-7 rounded-lg p-5 text-center">
        <p className="flex items-center justify-center gap-1.5 font-hud text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          <Ticket className="h-3.5 w-3.5" aria-hidden /> Your booking code
        </p>
        <p className="mt-2 select-all break-all font-display text-[clamp(2.6rem,13vw,3.75rem)] leading-none tracking-[0.08em] text-content">
          {result.booking_code}
        </p>
        <button
          type="button"
          onClick={copyCode}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 font-hud text-[11px] font-bold uppercase tracking-widest text-secondary transition-colors hover:text-content"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy code'}</span>
        </button>
        <p className="mt-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          Show this code at the counter when you arrive.
        </p>
      </div>

      {/* details */}
      <dl className="glass mt-4 divide-y divide-border/60 rounded-lg px-4">
        {[
          ['Station', result.resource_name],
          ['When', when],
          ['Duration', durationLabel(result.duration_minutes)],
          ['Name', result.name],
          ['Mobile', result.mobile],
          ...(amount !== null ? [['Estimated total', formatMoney(amount, sym)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 font-hud text-[10px] font-bold uppercase tracking-[0.22em] text-muted">{k}</dt>
            <dd className="text-right text-sm font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <GhostButton onClick={addToCalendar}>
          <CalendarPlus className="h-4 w-4" aria-hidden /> Calendar
        </GhostButton>
        <GhostButton onClick={share}>
          <Share2 className="h-4 w-4" aria-hidden /> Share
        </GhostButton>
      </div>

      {(phone || address) && (
        <div className="mt-4 space-y-1 rounded-lg border border-border/70 bg-surface/50 p-4 text-sm">
          <p className="font-hud text-[10px] font-bold uppercase tracking-[0.22em] text-muted">{cafeName}</p>
          {phone && (
            <a
              href={`tel:${phone.replace(/[^\d+]/g, '')}`}
              className="flex min-h-[44px] items-center gap-2 font-semibold text-content hover:text-secondary"
            >
              <Phone className="h-4 w-4 text-secondary" aria-hidden /> {phone}
            </a>
          )}
          {address && (
            <p className="flex items-start gap-2 text-muted">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden /> {address}
            </p>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-muted">
        Running late or can&apos;t make it? You can{' '}
        <button type="button" onClick={onManage} className="font-semibold text-secondary underline-offset-2 hover:underline">
          manage or cancel this booking
        </button>
        .
      </p>

      <PrimaryButton onClick={onBookAnother} className="mt-6 w-full">
        Book another station
      </PrimaryButton>
    </motion.div>
  );
}
