// ============================================================
// Formatting helpers — money, durations, dates (cafe timezone)
// ============================================================

export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(
  amount: number | string | null | undefined,
  symbol = '₹',
  decimals = 0
): string {
  const n = num(amount);
  const hasFraction = Math.abs(n % 1) > 0.001;
  const d = hasFraction ? 2 : decimals;
  return `${symbol}${n.toLocaleString('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/** 3725 → "01:02:05" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

/** 3725 → "1h 2m" */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function formatMinutes(minutes: number): string {
  return formatDurationShort(minutes * 60);
}

function safeFormat(
  iso: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions,
  timeZone?: string
): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timeZone || undefined,
      ...opts,
    }).format(d);
  } catch {
    return '—';
  }
}

/** "8:15 PM" */
export function formatClock(iso: string | number | Date | null | undefined, timeZone?: string): string {
  return safeFormat(iso, { hour: 'numeric', minute: '2-digit', hour12: true }, timeZone);
}

/** "03 Oct 2026" */
export function formatDate(iso: string | number | Date | null | undefined, timeZone?: string): string {
  return safeFormat(iso, { day: '2-digit', month: 'short', year: 'numeric' }, timeZone);
}

/** "03 Oct 2026, 8:15 PM" */
export function formatDateTime(
  iso: string | number | Date | null | undefined,
  timeZone?: string
): string {
  return safeFormat(
    iso,
    { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
    timeZone
  );
}

/** "8:15 PM" for a plain "HH:MM" / "HH:MM:SS" string */
export function formatTimeOfDay(t: string | null | undefined): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

export function dayName(dow: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] ?? '';
}

/** Value for <input type="datetime-local"> in local time */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
