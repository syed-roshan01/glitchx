// ============================================================
// Timezone helpers — "today" boundaries in the cafe's timezone.
// ============================================================

/** UTC instant of local midnight for the given date in `timeZone`. */
export function getZonedDayStart(timeZone = 'Asia/Kolkata', date = new Date()): Date {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
    const asUtc = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      (+parts.hour % 24) || 0,
      +parts.minute,
      +parts.second
    );
    const offset = asUtc - date.getTime();
    const midUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 0, 0, 0);
    return new Date(midUtc - offset);
  } catch {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

/** UTC instant of local midnight N days before today. */
export function getZonedDayStartNDaysAgo(days: number, timeZone = 'Asia/Kolkata'): Date {
  const start = getZonedDayStart(timeZone);
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Local YYYY-MM-DD for a date in the timezone. */
export function zonedDateKey(date: Date, timeZone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Local hour (0-23) of a date in the timezone. */
export function zonedHour(date: Date, timeZone = 'Asia/Kolkata'): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date);
    return Number(h) % 24;
  } catch {
    return date.getHours();
  }
}
