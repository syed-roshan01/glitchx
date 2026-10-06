// ============================================================
// Cafe-timezone helpers. Everything on /book is expressed in the
// CAFE's timezone (settings.timezone), never the device timezone.
// ============================================================

export const DEFAULT_TZ = 'Asia/Kolkata';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "YYYY-MM-DD" calendar day in the cafe timezone */
export type DayKey = string;

export function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts of an instant as seen in `tz`. */
export function wallParts(ms: number, tz: string): WallParts {
  const out: WallParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type in out) (out as unknown as Record<string, number>)[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Convert a cafe-local wall time to a UTC instant (ms). DST-safe (two-pass). */
export function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const o1 = tzOffsetMs(guess, tz);
  let t = guess - o1;
  const o2 = tzOffsetMs(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKeyOf(ms: number, tz: string): DayKey {
  const p = wallParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDayKey(k: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = k.split('-').map(Number);
  return { y, m, d };
}

export function addDays(k: DayKey, n: number): DayKey {
  const { y, m, d } = parseDayKey(k);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** UTC instant for `minutesOfDay` minutes after local midnight on day `k`. */
export function wallTimeToUtc(k: DayKey, minutesOfDay: number, tz: string): number {
  const { y, m, d } = parseDayKey(k);
  return zonedWallToUtc(y, m, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, tz);
}

export function minutesOfDay(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  return p.hour * 60 + p.minute;
}

const weekdayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

export interface DayLabel {
  /** "Today" | "Tomorrow" | "Thu" */
  top: string;
  /** "6 Oct" */
  bottom: string;
  /** "Today, 6 Oct" | "Thu, 8 Oct" */
  full: string;
  /** "Tuesday 6 October" style accessible label */
  weekday: string;
}

export function dayLabel(k: DayKey, todayKey: DayKey): DayLabel {
  const { y, m, d } = parseDayKey(k);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = weekdayFmt.format(date);
  const month = monthFmt.format(date);
  const top = k === todayKey ? 'Today' : k === addDays(todayKey, 1) ? 'Tomorrow' : weekday;
  const bottom = `${d} ${month}`;
  return { top, bottom, full: `${top}, ${bottom}`, weekday };
}

/** "Today, 6 Oct" for an instant in the cafe timezone. */
export function instantDayLabel(ms: number, tz: string, todayKey: DayKey): string {
  return dayLabel(dayKeyOf(ms, tz), todayKey).full;
}

export function roundUp(ms: number, stepMinutes: number): number {
  const s = stepMinutes * MINUTE;
  return Math.ceil(ms / s) * s;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h} hr${h > 1 ? 's' : ''}`;
  if (m === 30) return `${h}.5 hrs`;
  return `${h}h ${m}m`;
}
