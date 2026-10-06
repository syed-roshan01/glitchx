// ============================================================
// Slot availability — pure functions over busy intervals.
// A start S with duration D is bookable iff
//   S >= now - grace, S <= now + maxDaysAhead, and
//   [S, S+D) overlaps no busy interval of that resource.
// ============================================================
import type { AvailabilityRow } from '@/types';
import type { BusySlot } from './types';
import { DAY, MINUTE, roundUp, wallTimeToUtc, type DayKey } from './tz';

export interface Interval {
  start: number;
  end: number;
}

/** server accepts starts up to 2 minutes in the past */
export const GRACE_MS = 2 * MINUTE;
export const SLOT_STEP_MIN = 30;
/** assumed length of a reservation when we only know its start (fallback mode) */
const FALLBACK_RESERVATION_MIN = 60;

/** End of the buffer we hold for an open-ended (or overrunning) live session. */
function openEndedUntil(now: number): number {
  return roundUp(now + 15 * MINUTE, 15);
}

function push(map: Map<string, Interval[]>, id: string, iv: Interval) {
  if (!(iv.end > iv.start)) return;
  const list = map.get(id);
  if (list) list.push(iv);
  else map.set(id, [iv]);
}

/**
 * Busy intervals per resource. Uses public_get_busy_slots when available;
 * otherwise falls back to what public_get_availability tells us (status-based).
 */
export function buildBusyMap(
  slots: BusySlot[] | null,
  rows: AvailabilityRow[] | null,
  now: number
): Map<string, Interval[]> {
  const map = new Map<string, Interval[]>();
  const openEnd = openEndedUntil(now);

  if (slots) {
    for (const s of slots) {
      const start = Date.parse(s.start_time);
      if (Number.isNaN(start)) continue;
      if (s.kind === 'LIVE') {
        let end = s.end_time ? Date.parse(s.end_time) : openEnd;
        if (Number.isNaN(end) || end <= now) end = openEnd; // overrunning session
        push(map, s.resource_id, { start: Math.min(start, now), end });
      } else {
        const end = s.end_time ? Date.parse(s.end_time) : start + FALLBACK_RESERVATION_MIN * MINUTE;
        if (Number.isNaN(end)) continue;
        push(map, s.resource_id, { start, end });
      }
    }
  } else if (rows) {
    for (const r of rows) {
      if (r.status === 'BUSY') {
        let end = r.busy_until ? Date.parse(r.busy_until) : openEnd;
        if (Number.isNaN(end) || end <= now) end = openEnd;
        push(map, r.resource_id, { start: now - DAY, end });
      }
      if (r.next_booking_start) {
        const nb = Date.parse(r.next_booking_start);
        if (!Number.isNaN(nb)) push(map, r.resource_id, { start: nb, end: nb + FALLBACK_RESERVATION_MIN * MINUTE });
      }
    }
  }

  map.forEach((list) => list.sort((a, b) => a.start - b.start));
  return map;
}

export function isFree(intervals: Interval[] | undefined, start: number, durationMin: number): boolean {
  if (!intervals || intervals.length === 0) return true;
  const end = start + durationMin * MINUTE;
  for (const iv of intervals) {
    if (iv.start < end && iv.end > start) return false;
  }
  return true;
}

export function horizonOf(now: number, maxDaysAhead: number): number {
  return now + Math.max(1, maxDaysAhead) * DAY;
}

/** Is `start` a valid, free start right now? */
export function isBookable(
  intervals: Interval[] | undefined,
  start: number,
  durationMin: number,
  now: number,
  horizon: number
): boolean {
  if (start < now - GRACE_MS) return false;
  if (start > horizon) return false;
  return isFree(intervals, start, durationMin);
}

/** The "start now" instant (next 5-minute mark). */
export function nowStart(now: number): number {
  return roundUp(now, 5);
}

/** Earliest free start (continuous, 5-minute resolution) or null within the horizon. */
export function nextFreeStart(
  intervals: Interval[] | undefined,
  durationMin: number,
  now: number,
  horizon: number
): number | null {
  let c = nowStart(now);
  for (let guard = 0; guard < 1000; guard++) {
    if (c > horizon) return null;
    const end = c + durationMin * MINUTE;
    let blockEnd = -1;
    for (const iv of intervals ?? []) {
      if (iv.start < end && iv.end > c) blockEnd = Math.max(blockEnd, iv.end);
    }
    if (blockEnd < 0) return c;
    c = roundUp(blockEnd, 5);
  }
  return null;
}

export interface Slot {
  start: number;
  minuteOfDay: number;
  free: boolean;
}

/** Grid slots for a cafe-local day (past + beyond-horizon slots omitted). */
export function buildDaySlots(opts: {
  dayKey: DayKey;
  tz: string;
  now: number;
  horizon: number;
  intervals: Interval[] | undefined;
  durationMin: number;
  stepMin?: number;
}): Slot[] {
  const step = opts.stepMin ?? SLOT_STEP_MIN;
  const out: Slot[] = [];
  let prev = -1;
  for (let m = 0; m < 24 * 60; m += step) {
    const start = wallTimeToUtc(opts.dayKey, m, opts.tz);
    if (start === prev) continue; // DST duplicate
    prev = start;
    if (start < opts.now - GRACE_MS) continue;
    if (start > opts.horizon) continue;
    out.push({ start, minuteOfDay: m, free: isFree(opts.intervals, start, opts.durationMin) });
  }
  return out;
}

export type SlotGroupId = 'late' | 'morning' | 'afternoon' | 'evening' | 'night';

export const SLOT_GROUPS: { id: SlotGroupId; label: string; from: number; to: number }[] = [
  { id: 'late', label: 'After midnight', from: 0, to: 5 * 60 },
  { id: 'morning', label: 'Morning', from: 5 * 60, to: 12 * 60 },
  { id: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { id: 'evening', label: 'Evening', from: 17 * 60, to: 21 * 60 },
  { id: 'night', label: 'Night', from: 21 * 60, to: 24 * 60 },
];

export function groupSlots(slots: Slot[]): { id: SlotGroupId; label: string; slots: Slot[] }[] {
  return SLOT_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    slots: slots.filter((s) => s.minuteOfDay >= g.from && s.minuteOfDay < g.to),
  })).filter((g) => g.slots.length > 0);
}
