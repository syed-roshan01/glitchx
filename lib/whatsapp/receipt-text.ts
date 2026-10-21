// ============================================================
// WhatsApp receipt text + deep link.
//
// One-click "Send on WhatsApp" after ending a session (and from
// the invoice page) opens WhatsApp with a ready-to-send receipt
// message framed like a proper invoice.
// ============================================================

export interface ReceiptTextLine {
  name: string;
  quantity?: number;
  amount: number;
}

export interface ReceiptTextInput {
  invoiceNumber: string;
  issuedAt?: string | Date | null;
  customerName?: string | null;
  resourceName?: string | null;
  sessionStart?: string | Date | null;
  sessionEnd?: string | Date | null;
  durationSeconds?: number | null;
  durationMinutes?: number | null;
  /** gaming charge row(s) */
  sessionLines?: ReceiptTextLine[];
  /** food / drink / service rows */
  itemLines?: ReceiptTextLine[];
  subtotal: number;
  discountAmount?: number;
  taxLabel?: string | null;
  taxAmount?: number;
  total: number;
  /** staff hand-edited the final amount */
  totalAdjusted?: boolean;
  paid?: boolean;
  paymentMethod?: string | null;
}

export interface ReceiptTextOptions {
  cafeName?: string | null;
  currency?: string;
  timezone?: string;
  footer?: string | null;
}

const DIVIDER = '────────────────────';
const RULE = '━━━━━━━━━━━━━━━━━━━━';

function money(n: number, sym: string): string {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeOf(v: string | Date | null | undefined, timeZone?: string): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone || undefined,
  });
}

function dateOf(v: string | Date | null | undefined, timeZone?: string): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timeZone || undefined,
  });
}

function durationText(seconds?: number | null, minutes?: number | null): string {
  const totalSec = seconds != null ? Math.max(Math.round(seconds), 0) : (minutes ?? 0) * 60;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return seconds != null ? `${pad(h)}:${pad(m)}:${pad(s)}` : (h > 0 ? `${h}h ${pad(m)}m` : `${m}m`);
}

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** The receipt message, framed for WhatsApp (*bold* works there). */
export function buildReceiptText(input: ReceiptTextInput, opts: ReceiptTextOptions = {}): string {
  const sym = opts.currency || '₹';
  const tz = opts.timezone;
  const L: string[] = [];

  // ── header
  L.push(`*🧾 INVOICE & RECEIPT*`);
  if (opts.cafeName) L.push(`*${opts.cafeName}*`);
  L.push(RULE);

  // ── meta
  const dateStr = dateOf(input.issuedAt, tz);
  const timeStr = timeOf(input.issuedAt, tz);
  if (dateStr) L.push(`📅 ${dateStr}${timeStr ? ` · ${timeStr}` : ''}`);
  L.push(`🧾 Invoice *${input.invoiceNumber}*`);
  if (input.customerName?.trim()) L.push(`👤 Customer *${input.customerName.trim()}*`);

  // ── session
  const hasSession =
    !!input.resourceName || (input.sessionLines ?? []).some((l) => l.amount > 0);
  if (hasSession) {
    L.push('');
    L.push(`*🎮 GAME SESSION*`);
    if (input.resourceName) L.push(`*${input.resourceName}*`);
    const start = timeOf(input.sessionStart, tz);
    const end = timeOf(input.sessionEnd, tz);
    if (start) L.push(line('Start', start));
    if (end) L.push(line('End', end));
    L.push(line('Duration', durationText(input.durationSeconds, input.durationMinutes)));
    for (const l of input.sessionLines ?? []) {
      if (l.amount > 0) L.push(line(l.name, money(l.amount, sym)));
    }
  }

  // ── food / drink / services
  const items = (input.itemLines ?? []).filter((l) => l.amount > 0);
  if (items.length) {
    L.push('');
    L.push(`*🍟 FOOD & SERVICES*`);
    for (const l of items) {
      const qty = l.quantity && l.quantity > 1 ? `${l.quantity} × ` : '';
      L.push(line(`${qty}${l.name}`, money(l.amount, sym)));
    }
  }

  // ── billing
  const moneyRows = (input.sessionLines ?? []).filter((l) => l.amount > 0).length + items.length;
  const discount = input.discountAmount ?? 0;
  const tax = input.taxAmount ?? 0;
  L.push('');
  L.push(`*💰 BILLING*`);
  if (moneyRows > 1) L.push(line('Subtotal', money(input.subtotal, sym)));
  if (discount > 0) L.push(line('Discount', `− ${money(discount, sym)}`));
  if (tax > 0) L.push(line(input.taxLabel?.trim() || 'Tax', money(tax, sym)));
  L.push(DIVIDER);
  L.push(
    `*TOTAL PAYABLE${input.totalAdjusted ? ' (adjusted)' : ''}: ${money(input.total, sym)}*`
  );
  if (input.paid && input.paymentMethod) {
    const method = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' }[input.paymentMethod] ?? input.paymentMethod;
    L.push(`Paid in full · ${method} ✓`);
  }

  // ── footer
  L.push(RULE);
  L.push('Thank you for gaming with us! 🎮');
  if (opts.footer?.trim()) L.push(opts.footer.trim());

  return L.join('\n');
}

/** Customer mobile → WhatsApp digits (91 prefix for 10-digit Indian numbers). */
export function whatsappDigits(mobile: string | null | undefined): string | null {
  const d = String(mobile ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length > 10) return d;
  return d.length >= 7 ? d : null;
}

/** The one-click link: WhatsApp opens with the receipt ready to send.
 *  Without a mobile it opens the contact picker with the text attached. */
export function whatsappReceiptUrl(text: string, mobile?: string | null): string {
  const digits = whatsappDigits(mobile);
  const q = new URLSearchParams({ text, type: 'phone_number', app_absent: '0' });
  return digits
    ? `https://api.whatsapp.com/send/?phone=${digits}&${q.toString()}`
    : `https://api.whatsapp.com/send/?${q.toString()}`;
}
