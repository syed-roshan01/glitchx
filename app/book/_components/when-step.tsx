'use client';

import { useMemo } from 'react';
import { CalendarX, Moon, Sparkles, Sun, Sunrise, Sunset, Zap, type LucideIcon } from 'lucide-react';
import type { AvailabilityRow } from '@/types';
import { formatClock } from '@/lib/billing/format';
import {
  buildDaySlots,
  groupSlots,
  isFree,
  nowStart,
  type Interval,
  type SlotGroupId,
} from './availability';
import { addDays, dayKeyOf, dayLabel, instantDayLabel, wallTimeToUtc, type DayKey } from './tz';
import { Chip, SectionLabel, StepHeader } from './primitives';

export const DURATIONS: { min: number; label: string }[] = [
  { min: 30, label: '30m' },
  { min: 60, label: '1h' },
  { min: 90, label: '1.5h' },
  { min: 120, label: '2h' },
  { min: 180, label: '3h' },
];

const GROUP_ICON: Record<SlotGroupId, LucideIcon> = {
  late: Moon,
  morning: Sunrise,
  afternoon: Sun,
  evening: Sunset,
  night: Moon,
};

export interface DayInfo {
  key: DayKey;
  hasFree: boolean;
}

/** Days from today to the booking horizon, each flagged with whether any slot fits. */
export function buildDays(opts: {
  todayKey: DayKey;
  maxDays: number;
  tz: string;
  now: number;
  horizon: number;
  intervals: Interval[] | undefined;
  durationMin: number;
}): DayInfo[] {
  const out: DayInfo[] = [];
  for (let i = 0; i <= opts.maxDays; i++) {
    const key = addDays(opts.todayKey, i);
    if (wallTimeToUtc(key, 0, opts.tz) > opts.horizon) break;
    const slots = buildDaySlots({ ...opts, dayKey: key });
    const nowOk = i === 0 && isFree(opts.intervals, nowStart(opts.now), opts.durationMin);
    out.push({ key, hasFree: nowOk || slots.some((s) => s.free) });
  }
  return out;
}

/** First bookable start on/after `fromDay` (prefers "start now" today). */
export function firstAvailable(opts: {
  days: DayInfo[];
  fromDay?: DayKey;
  todayKey: DayKey;
  tz: string;
  now: number;
  horizon: number;
  intervals: Interval[] | undefined;
  durationMin: number;
}): number | null {
  for (const d of opts.days) {
    if (opts.fromDay && d.key < opts.fromDay) continue;
    if (!d.hasFree) continue;
    if (d.key === opts.todayKey && isFree(opts.intervals, nowStart(opts.now), opts.durationMin)) return nowStart(opts.now);
    const slot = buildDaySlots({ ...opts, dayKey: d.key }).find((s) => s.free);
    if (slot) return slot.start;
  }
  return null;
}

export function WhenStep({
  resource,
  tz,
  todayKey,
  now,
  horizon,
  days,
  intervals,
  dayKey,
  onDay,
  duration,
  onDuration,
  start,
  startIsNow,
  onStart,
  notice,
  fallbackMode,
  waitlistEnabled,
  onWaitlist,
  onBack,
}: {
  resource: AvailabilityRow;
  tz: string;
  todayKey: DayKey;
  now: number;
  horizon: number;
  days: DayInfo[];
  intervals: Interval[] | undefined;
  dayKey: DayKey;
  onDay: (k: DayKey) => void;
  duration: number;
  onDuration: (m: number) => void;
  start: number | null;
  startIsNow: boolean;
  onStart: (ms: number, isNow: boolean) => void;
  notice: string | null;
  fallbackMode: boolean;
  waitlistEnabled: boolean;
  onWaitlist: () => void;
  onBack: () => void;
}) {
  const slots = useMemo(
    () => buildDaySlots({ dayKey, tz, now, horizon, intervals, durationMin: duration }),
    [dayKey, tz, now, horizon, intervals, duration]
  );
  const groups = useMemo(() => groupSlots(slots), [slots]);
  const isToday = dayKey === todayKey;
  const ns = nowStart(now);
  const canStartNow = isToday && isFree(intervals, ns, duration);
  const anyFreeToday = canStartNow || slots.some((s) => s.free);

  const next = useMemo(
    () => firstAvailable({ days, todayKey, tz, now, horizon, intervals, durationMin: duration }),
    [days, todayKey, tz, now, horizon, intervals, duration]
  );
  const nextOnOtherDay = next !== null && dayKeyOf(next, tz) !== dayKey;
  const dayFull = dayLabel(dayKey, todayKey);

  return (
    <div>
      <StepHeader
        index={2}
        total={4}
        kicker={`02 / ${resource.name}`}
        title="Lock in a time"
        subtitle="Pick a day and how long you want to play — we only show times that fit."
        onBack={onBack}
      />

      <div aria-live="polite" className="empty:hidden">
        {notice && (
          <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm font-semibold text-warning">
            {notice}
          </p>
        )}
      </div>

      {/* ---- day ---- */}
      <section aria-labelledby="day-label" className="mb-6">
        <SectionLabel id="day-label">Day</SectionLabel>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map((d) => {
            const l = dayLabel(d.key, todayKey);
            const active = d.key === dayKey;
            return (
              <Chip
                key={d.key}
                pressed={active}
                onClick={() => onDay(d.key)}
                ariaLabel={`${l.top === 'Today' || l.top === 'Tomorrow' ? `${l.top}, ` : ''}${l.weekday} ${l.bottom}${d.hasFree ? '' : ', fully booked'}`}
                className="flex min-w-[4.75rem] shrink-0 snap-start flex-col items-center justify-center px-3 py-2"
              >
                <span className={`text-[10px] tracking-[0.2em] ${active ? 'text-white/80' : 'text-muted'}`}>{l.top}</span>
                <span className="mt-0.5 text-sm normal-case tracking-normal">{l.bottom}</span>
                <span
                  className={`mt-1 h-1 w-1 rounded-full ${d.hasFree ? (active ? 'bg-white' : 'bg-success') : 'bg-danger/70'}`}
                  aria-hidden
                />
              </Chip>
            );
          })}
        </div>
      </section>

      {/* ---- duration ---- */}
      <section aria-labelledby="dur-label" className="mb-6">
        <SectionLabel id="dur-label">How long?</SectionLabel>
        <div className="grid grid-cols-5 gap-2">
          {DURATIONS.map((d) => (
            <Chip
              key={d.min}
              pressed={duration === d.min}
              onClick={() => onDuration(d.min)}
              ariaLabel={`${d.min} minutes`}
              className="px-1 text-sm"
            >
              {d.label}
            </Chip>
          ))}
        </div>
      </section>

      {/* ---- time ---- */}
      <section aria-labelledby="time-label">
        <SectionLabel
          id="time-label"
          right={
            next !== null && next !== start ? (
              <button
                type="button"
                onClick={() => {
                  if (nextOnOtherDay) onDay(dayKeyOf(next, tz));
                  onStart(next, next === ns && dayKeyOf(next, tz) === todayKey);
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 font-hud text-[11px] font-bold uppercase tracking-widest text-secondary transition-colors hover:text-content"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Next: {nextOnOtherDay ? `${instantDayLabel(next, tz, todayKey).split(',')[0]} ` : ''}
                {next === ns && !nextOnOtherDay ? 'now' : formatClock(next, tz)}
              </button>
            ) : null
          }
        >
          Start time
        </SectionLabel>

        {canStartNow && (
          <button
            type="button"
            aria-pressed={startIsNow && start !== null}
            onClick={() => onStart(ns, true)}
            className={`mb-4 flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg border px-4 text-left transition-colors active:scale-[0.99] ${
              startIsNow && start !== null
                ? 'border-success bg-success/20 text-content shadow-[0_0_18px_-6px_rgba(34,197,94,0.6)]'
                : 'border-success/40 bg-success/10 text-content hover:bg-success/15'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Zap className="h-5 w-5 text-success" aria-hidden />
              <span>
                <span className="block font-hud text-sm font-bold uppercase tracking-widest text-success">Start now</span>
                <span className="block text-xs text-muted">Walk in and play from {formatClock(ns, tz)}</span>
              </span>
            </span>
            <span className="font-hud text-[10px] font-bold uppercase tracking-widest text-success">Free</span>
          </button>
        )}

        {!anyFreeToday ? (
          <div className="glass rounded-lg p-6 text-center">
            <CalendarX className="mx-auto h-8 w-8 text-muted" aria-hidden />
            <p className="mt-3 font-hud text-sm font-bold uppercase tracking-wider">
              {slots.length === 0 && isToday ? 'Nothing left today' : `No ${duration}-min slots on ${dayFull.full}`}
            </p>
            <p className="mt-1 text-sm text-muted">
              {next !== null
                ? 'Try a shorter session or jump to the next free slot.'
                : 'Everything is booked for this duration. Try a shorter session.'}
            </p>
            {next === null && waitlistEnabled && (
              <button
                type="button"
                onClick={onWaitlist}
                className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-warning/50 bg-warning/10 px-4 font-hud text-xs font-bold uppercase tracking-widest text-warning"
              >
                Join the waitlist
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const Icon = GROUP_ICON[g.id];
              const free = g.slots.filter((s) => s.free).length;
              return (
                <div key={g.id} role="group" aria-label={`${g.label} start times`}>
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {g.label}
                    <span className="text-muted/60">· {free} free</span>
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {g.slots.map((s) => {
                      const selected = start === s.start && !startIsNow;
                      const label = formatClock(s.start, tz);
                      return (
                        <button
                          key={s.start}
                          type="button"
                          aria-pressed={selected}
                          aria-label={s.free ? label : `${label}, unavailable`}
                          disabled={!s.free}
                          onClick={() => onStart(s.start, false)}
                          className={`min-h-[44px] rounded-md border px-1 font-hud text-[13px] font-bold uppercase tabular-nums transition-[background-color,border-color,transform] active:scale-[0.96] ${
                            selected
                              ? 'border-primary bg-primary text-white shadow-glow-sm'
                              : s.free
                                ? 'border-border-strong bg-surface-2/70 text-content hover:border-primary/60'
                                : 'cursor-not-allowed border-transparent bg-surface/30 text-muted/35 line-through'
                          }`}
                        >
                          {label.replace(/\s?(am|pm)$/i, '')}
                          <span className={`ml-0.5 text-[9px] ${selected ? 'text-white/80' : 'text-muted'}`}>
                            {/(am|pm)$/i.exec(label)?.[0] ?? ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {fallbackMode && (
          <p className="mt-4 text-xs text-muted/80">
            Showing estimated availability. Your slot is double-checked when you confirm.
          </p>
        )}
      </section>
    </div>
  );
}
