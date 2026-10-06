'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CalendarClock, Clock, Hourglass, Zap } from 'lucide-react';
import type { AvailabilityRow } from '@/types';
import { formatClock, formatMoney } from '@/lib/billing/format';
import { nextFreeStart, nowStart, type Interval } from './availability';
import { dayKeyOf, instantDayLabel, type DayKey } from './tz';
import { GhostButton, PrimaryButton, StationIcon, StatusPill, StepHeader, typeLabel, type Tone } from './primitives';

export interface StationAvailability {
  row: AvailabilityRow;
  nextFree: number | null;
  freeNow: boolean;
}

export function computeStationAvailability(
  rows: AvailabilityRow[],
  busyMap: Map<string, Interval[]>,
  now: number,
  horizon: number
): StationAvailability[] {
  const ns = nowStart(now);
  return rows.map((row) => {
    if (row.status === 'MAINTENANCE') return { row, nextFree: null, freeNow: false };
    const nextFree = nextFreeStart(busyMap.get(row.resource_id), 30, now, horizon);
    return { row, nextFree, freeNow: nextFree !== null && nextFree <= ns };
  });
}

function pill(a: StationAvailability): { tone: Tone; label: string } {
  if (a.row.status === 'MAINTENANCE') return { tone: 'muted', label: 'Offline' };
  if (a.freeNow) return { tone: 'success', label: 'Free now' };
  if (a.row.status === 'BUSY') return { tone: 'danger', label: 'In use' };
  if (a.row.status === 'RESERVED') return { tone: 'warning', label: 'Reserved' };
  return { tone: 'warning', label: 'Booked' };
}

export function StationStep({
  stations,
  tz,
  todayKey,
  sym,
  bookingOpen,
  waitlistEnabled,
  selectedId,
  onBookNow,
  onPick,
  onWaitlist,
}: {
  stations: StationAvailability[];
  tz: string;
  todayKey: DayKey;
  sym: string;
  bookingOpen: boolean;
  waitlistEnabled: boolean;
  selectedId: string | null;
  onBookNow: (row: AvailabilityRow) => void;
  onPick: (row: AvailabilityRow, firstFree: number | null) => void;
  onWaitlist: () => void;
}) {
  const reduce = useReducedMotion();
  const freeCount = stations.filter((s) => s.freeNow).length;
  const allBusy = stations.length > 0 && freeCount === 0;

  return (
    <div>
      <StepHeader
        index={1}
        total={4}
        kicker="01 / Station"
        title="Pick your station"
        subtitle={
          stations.length > 0 ? (
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {freeCount}/{stations.length} free right now · updates live
            </span>
          ) : undefined
        }
      />

      {allBusy && bookingOpen && waitlistEnabled && (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="font-hud text-sm font-bold uppercase tracking-wider text-warning">All stations busy right now</p>
          <p className="mt-1 text-sm text-muted">
            Grab a later slot below, or join the waitlist and we&apos;ll call you the moment one frees up.
          </p>
          <button
            type="button"
            onClick={onWaitlist}
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-warning px-4 font-hud text-xs font-bold uppercase tracking-widest text-black transition-transform active:scale-[0.98]"
          >
            <Hourglass className="h-4 w-4" aria-hidden /> Join waitlist
          </button>
        </div>
      )}

      {stations.length === 0 ? (
        <div className="glass hud rounded-lg p-8 text-center">
          <p className="font-display text-3xl uppercase">Coming soon</p>
          <p className="mt-2 text-sm text-muted">No stations are bookable online yet. Walk-ins are always welcome.</p>
        </div>
      ) : (
        <ul className="space-y-3.5">
          {stations.map((a, i) => {
            const { row } = a;
            const p = pill(a);
            const offline = row.status === 'MAINTENANCE';
            const rate = row.hourly_rate ? formatMoney(row.hourly_rate, row.currency_symbol || sym) : null;
            const freeNote = offline
              ? 'Under maintenance — back soon'
              : a.freeNow
                ? 'Ready to play right now'
                : a.nextFree !== null
                  ? dayKeyOf(a.nextFree, tz) === todayKey
                    ? `Free from ${formatClock(a.nextFree, tz)}`
                    : `Free ${instantDayLabel(a.nextFree, tz, todayKey)} · ${formatClock(a.nextFree, tz)}`
                  : 'Fully booked for now';
            const selected = selectedId === row.resource_id;
            return (
              <motion.li
                key={row.resource_id}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: reduce ? 0 : i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <article
                  aria-label={row.name}
                  className={`glass hud rounded-lg p-4 shadow-card transition-colors ${offline ? 'opacity-60' : ''} ${
                    selected ? 'border-primary/70' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/25 to-secondary/20 text-primary">
                        <StationIcon type={row.resource_type} />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate font-hud text-base font-bold uppercase tracking-wider">{row.name}</h2>
                        <p className="text-xs text-muted">{typeLabel(row.resource_type)}</p>
                      </div>
                    </div>
                    <StatusPill tone={p.tone} pulse={a.freeNow}>
                      {p.label}
                    </StatusPill>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/60 pt-3.5">
                    <p
                      className={`flex items-center gap-1.5 text-sm ${
                        a.freeNow ? 'text-success' : offline ? 'text-muted' : 'text-content/90'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {freeNote}
                    </p>
                    {rate && (
                      <p className="shrink-0 text-right">
                        <span className="font-display text-2xl leading-none tracking-tight">{rate}</span>
                        <span className="ml-0.5 font-hud text-[10px] font-bold uppercase tracking-widest text-muted">/hr</span>
                      </p>
                    )}
                  </div>

                  {bookingOpen && !offline && (
                    <div className={`mt-4 grid gap-2.5 ${a.freeNow ? 'grid-cols-[1.3fr_1fr]' : 'grid-cols-1'}`}>
                      {a.freeNow ? (
                        <>
                          <PrimaryButton onClick={() => onBookNow(row)} aria-label={`Book ${row.name} now`}>
                            <Zap className="h-4 w-4" aria-hidden /> Book now
                          </PrimaryButton>
                          <GhostButton onClick={() => onPick(row, a.nextFree)} aria-label={`Pick a time for ${row.name}`}>
                            <CalendarClock className="h-4 w-4" aria-hidden /> Later
                          </GhostButton>
                        </>
                      ) : (
                        <PrimaryButton
                          onClick={() => onPick(row, a.nextFree)}
                          disabled={a.nextFree === null}
                          aria-label={`Book a slot on ${row.name}`}
                        >
                          <CalendarClock className="h-4 w-4" aria-hidden /> Book a slot
                        </PrimaryButton>
                      )}
                    </div>
                  )}
                </article>
              </motion.li>
            );
          })}
        </ul>
      )}

      {waitlistEnabled && stations.length > 0 && !allBusy && (
        <button
          type="button"
          onClick={onWaitlist}
          className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-warning/40 px-4 font-hud text-xs font-bold uppercase tracking-widest text-warning/90 transition-colors hover:bg-warning/10"
        >
          <Hourglass className="h-4 w-4" aria-hidden /> Nothing fits? Join the waitlist
        </button>
      )}
    </div>
  );
}
