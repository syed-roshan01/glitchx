// ============================================================
// Client-side invoice PDF (A4 or 80mm receipt) built with jsPDF.
// jsPDF is imported dynamically so it never lands in the initial bundle.
//
// Default jsPDF fonts are WinAnsi-only (no ₹ glyph, no narrow no-break
// spaces), so every string goes through `clean()` and currency is printed
// as "Rs." (or the settings currency code).
// ============================================================

import logo from '@/components/ui/logo.jpeg';
import { formatDateTime, formatClock, formatMinutes } from '@/lib/billing/format';
import type { CafeSettings, Invoice, InvoiceItem, Payment } from '@/types';

export type InvoicePdfFormat = 'a4' | 'receipt';

export interface InvoicePdfOptions {
  format?: InvoicePdfFormat;
}

type JsPDFDoc = InstanceType<typeof import('jspdf').jsPDF>;

/** Replace characters the built-in PDF fonts can't render. */
function clean(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/₹/g, 'Rs.')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[  -​  　]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '');
}

function currencyLabel(settings: CafeSettings): string {
  const sym = settings.currency_symbol || '';
  if (sym && /^[\x20-\x7E]+$/.test(sym)) return sym;
  if (!settings.currency || settings.currency.toUpperCase() === 'INR') return 'Rs.';
  return settings.currency.toUpperCase();
}

function money(n: number, cur: string): string {
  const v = Number.isFinite(n) ? n : 0;
  const hasFraction = Math.abs(v % 1) > 0.001;
  const d = hasFraction ? 2 : 0;
  const body = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${v < 0 ? '-' : ''}${cur} ${body}`;
}

export function invoicePdfFilename(invoice: Pick<Invoice, 'invoice_number'>): string {
  return `${(invoice.invoice_number || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`;
}

let logoCache: Promise<{ dataUrl: string; w: number; h: number } | null> | null = null;

function loadLogo(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (logoCache) return logoCache;
  logoCache = (async () => {
    try {
      const src = typeof logo === 'string' ? (logo as string) : logo.src;
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const w = logo.width || 1536;
      const h = logo.height || 1024;
      return { dataUrl, w, h };
    } catch {
      return null;
    }
  })();
  // don't cache failures forever
  logoCache.then((v) => {
    if (!v) logoCache = null;
  });
  return logoCache;
}

interface Ctx {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  settings: CafeSettings;
  cur: string;
  paid: number;
  balance: number;
  customer: string;
  mobile: string;
  tz: string;
}

function makeCtx(invoice: Invoice, items: InvoiceItem[], payments: Payment[], settings: CafeSettings): Ctx {
  const paid = payments
    .filter((p) => p.payment_status === 'PAID')
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  return {
    invoice,
    items: [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    payments: payments.filter((p) => p.payment_status === 'PAID'),
    settings,
    cur: currencyLabel(settings),
    paid,
    balance: Math.max(Number(invoice.total_amount || 0) - paid, 0),
    customer: clean(invoice.customer_name?.trim()) || 'Walk-in',
    mobile: clean(invoice.customer_mobile?.trim() || ''),
    tz: settings.timezone,
  };
}

function sessionLine(c: Ctx): string {
  const { invoice, tz } = c;
  if (!invoice.session_start) return '';
  const start = formatDateTime(invoice.session_start, tz);
  const end = invoice.session_end ? formatClock(invoice.session_end, tz) : '';
  return clean(end ? `${start} - ${end}` : start);
}

function durationLine(c: Ctx): string {
  const m = c.invoice.duration_minutes;
  if (!m) return '';
  return clean(`${formatMinutes(m)} (${m} min)`);
}

const ITEM_LABEL: Record<string, string> = { GAMING: 'Gaming', ITEM: 'Item', SERVICE: 'Service' };

// ------------------------------------------------------------ A4

async function drawA4(doc: JsPDFDoc, c: Ctx, logoImg: Awaited<ReturnType<typeof loadLogo>>) {
  const { invoice, settings, cur } = c;
  const W = 210;
  const M = 16;
  const R = W - M;
  let y = M;

  // header — left: logo + cafe details
  let textX = M;
  if (logoImg) {
    const h = 20;
    const w = (logoImg.w / logoImg.h) * h;
    try {
      doc.addImage(logoImg.dataUrl, 'JPEG', M, y, w, h);
      textX = M + w + 5;
    } catch {
      /* skip logo */
    }
  }
  doc.setTextColor(17, 17, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(clean(settings.cafe_name).toUpperCase(), textX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  let hy = y + 11;
  const leftMax = 112 - textX;
  if (settings.address) {
    const lines = doc.splitTextToSize(clean(settings.address), leftMax) as string[];
    doc.text(lines, textX, hy);
    hy += lines.length * 3.8;
  }
  const contact = [settings.phone ? `Phone: ${settings.phone}` : '', settings.email || '']
    .filter(Boolean)
    .join('  |  ');
  if (contact) {
    doc.text(clean(contact), textX, hy);
    hy += 3.8;
  }
  if (settings.gstin) {
    doc.text(clean(`GSTIN: ${settings.gstin}`), textX, hy);
    hy += 3.8;
  }

  // header — right: INVOICE / number / date
  doc.setTextColor(17, 17, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('INVOICE', R, y + 7, { align: 'right' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(clean(invoice.invoice_number), R, y + 13, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(clean(formatDateTime(invoice.issued_at, c.tz)), R, y + 17.5, { align: 'right' });

  y = Math.max(hy, y + 22) + 3;
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.6);
  doc.line(M, y, R, y);
  y += 8;

  // billed to / session
  const label = (t: string, x: number, yy: number, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(t, x, yy, { align });
  };
  label('BILLED TO', M, y);
  label('SESSION', R, y, 'right');
  doc.setTextColor(17, 17, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(c.customer, M, y + 6);
  doc.text(clean(invoice.resource_name || '-'), R, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  if (c.mobile) doc.text(c.mobile, M, y + 11);
  const sLine = sessionLine(c);
  const dLine = durationLine(c);
  let sy = y + 11;
  if (sLine) {
    doc.text(sLine, R, sy, { align: 'right' });
    sy += 4.5;
  }
  if (dLine) doc.text(`Duration: ${dLine}`, R, sy, { align: 'right' });
  y += 22;

  // items table
  const colQty = 128;
  const colRate = 160;
  const colAmt = R;
  doc.setFillColor(244, 244, 245);
  doc.rect(M, y - 5, R - M, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(60, 60, 60);
  doc.text('DESCRIPTION', M + 2, y);
  doc.text('QTY', colQty, y, { align: 'right' });
  doc.text('RATE', colRate, y, { align: 'right' });
  doc.text('AMOUNT', colAmt - 2, y, { align: 'right' });
  y += 8;

  doc.setFontSize(9.5);
  for (const it of c.items) {
    if (y > 260) {
      doc.addPage();
      y = M + 6;
    }
    const name = doc.splitTextToSize(clean(it.name_snapshot), colQty - M - 22) as string[];
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 17, 17);
    doc.text(name, M + 2, y);
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text((ITEM_LABEL[it.item_type] || it.item_type).toUpperCase(), M + 2, y + name.length * 4.2);
    doc.setFontSize(9.5);
    doc.setTextColor(17, 17, 17);
    doc.text(String(it.quantity), colQty, y, { align: 'right' });
    doc.text(money(it.unit_price, cur), colRate, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(money(it.total_price, cur), colAmt - 2, y, { align: 'right' });
    y += name.length * 4.2 + 4;
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.2);
    doc.line(M, y - 2, R, y - 2);
    y += 3;
  }

  // totals
  if (y > 225) {
    doc.addPage();
    y = M + 6;
  }
  y += 4;
  const tl = 128;
  const row = (l: string, v: string, opts: { bold?: boolean; size?: number; color?: [number, number, number] } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 9.5);
    const [r, g, b] = opts.color ?? [17, 17, 17];
    doc.setTextColor(r, g, b);
    doc.text(l, tl, y);
    doc.text(v, R - 2, y, { align: 'right' });
    y += (opts.size ?? 9.5) * 0.55;
  };
  row('Subtotal', money(invoice.subtotal, cur));
  if (invoice.discount_amount > 0) {
    const pct = invoice.discount_type === 'PERCENT' && invoice.discount_value ? ` (${invoice.discount_value}%)` : '';
    row(`Discount${pct}`, `- ${money(invoice.discount_amount, cur)}`, { color: [21, 128, 61] });
  }
  if (invoice.tax_amount > 0) {
    row(clean(`${invoice.tax_name || 'Tax'}${invoice.tax_rate ? ` (${invoice.tax_rate}%)` : ''}`), money(invoice.tax_amount, cur));
  }
  y += 1;
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.6);
  doc.line(tl, y - 3, R, y - 3);
  y += 3;
  row('TOTAL', money(invoice.total_amount, cur), { bold: true, size: 13 });
  y += 2;

  for (const p of c.payments) {
    row(
      clean(`Paid via ${p.payment_method}${p.paid_at ? ` - ${formatDateTime(p.paid_at, c.tz)}` : ''}`),
      money(p.amount, cur),
      { size: 8.5, color: [90, 90, 90] }
    );
  }
  y += 2;
  if (c.balance > 0.009) {
    row('BALANCE DUE', money(c.balance, cur), { bold: true, size: 11, color: [185, 28, 28] });
  } else if (invoice.status !== 'VOID') {
    // PAID stamp
    doc.setDrawColor(21, 128, 61);
    doc.setTextColor(21, 128, 61);
    doc.setLineWidth(0.7);
    doc.roundedRect(R - 30, y - 4.5, 28, 9, 1.5, 1.5, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PAID', R - 16, y + 1.8, { align: 'center' });
    y += 8;
  }
  if (invoice.status === 'VOID') {
    y += 2;
    row('STATUS', 'VOID', { bold: true, color: [185, 28, 28] });
  }

  // footer
  const pageH = 297;
  const pages = doc.getNumberOfPages();
  doc.setPage(pages);
  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(M, pageH - 20, R, pageH - 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(clean(`Thank you for playing at ${settings.cafe_name}!`), W / 2, pageH - 14, { align: 'center' });
  doc.setFontSize(7);
  doc.text('This is a computer-generated invoice.', W / 2, pageH - 10, { align: 'center' });
}

// ------------------------------------------------------------ 80mm receipt

/** Draws the receipt; returns the final y. Pass the real doc or a measuring doc. */
function drawReceipt(doc: JsPDFDoc, c: Ctx, logoImg: Awaited<ReturnType<typeof loadLogo>>): number {
  const { invoice, settings, cur } = c;
  const W = 80;
  const M = 5;
  const R = W - M;
  const CW = R - M;
  let y = 6;

  const center = (t: string, size: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(t), CW) as string[];
    doc.text(lines, W / 2, y, { align: 'center' });
    y += lines.length * size * 0.42 + 1;
  };
  const rule = () => {
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.2);
    (doc as unknown as { setLineDashPattern: (a: number[], p: number) => void }).setLineDashPattern([1, 1], 0);
    doc.line(M, y, R, y);
    (doc as unknown as { setLineDashPattern: (a: number[], p: number) => void }).setLineDashPattern([], 0);
    y += 4;
  };
  const pair = (l: string, v: string, size = 8, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const vw = doc.getTextWidth(v);
    const lines = doc.splitTextToSize(clean(l), CW - vw - 3) as string[];
    doc.text(lines, M, y);
    doc.text(v, R, y, { align: 'right' });
    y += lines.length * size * 0.42 + 1.2;
  };
  const line = (t: string, size = 8) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(t), CW) as string[];
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 1;
  };

  doc.setTextColor(0, 0, 0);
  if (logoImg) {
    const h = 14;
    const w = (logoImg.w / logoImg.h) * h;
    try {
      doc.addImage(logoImg.dataUrl, 'JPEG', (W - w) / 2, y - 2, w, h);
      y += h + 2;
    } catch {
      /* skip */
    }
  }
  y += 2;
  center(settings.cafe_name.toUpperCase(), 11, true);
  if (settings.address) center(settings.address, 7);
  if (settings.phone) center(`Ph: ${settings.phone}`, 7);
  if (settings.gstin) center(`GSTIN: ${settings.gstin}`, 7);
  y += 1;
  rule();
  center('INVOICE', 10, true);
  center(invoice.invoice_number, 8);
  center(formatDateTime(invoice.issued_at, c.tz), 7);
  rule();
  line(`Customer: ${c.customer}`);
  if (c.mobile) line(`Mobile: ${c.mobile}`);
  line(`Station: ${invoice.resource_name || '-'}`);
  const sLine = sessionLine(c);
  if (sLine) line(sLine, 7);
  const dLine = durationLine(c);
  if (dLine) line(`Duration: ${dLine}`, 7);
  rule();
  for (const it of c.items) {
    pair(it.name_snapshot, money(it.total_price, cur), 8);
    doc.setTextColor(90, 90, 90);
    line(`  ${it.quantity} x ${money(it.unit_price, cur)}`, 6.5);
    doc.setTextColor(0, 0, 0);
  }
  rule();
  pair('Subtotal', money(invoice.subtotal, cur));
  if (invoice.discount_amount > 0) pair('Discount', `- ${money(invoice.discount_amount, cur)}`);
  if (invoice.tax_amount > 0) {
    pair(`${invoice.tax_name || 'Tax'}${invoice.tax_rate ? ` (${invoice.tax_rate}%)` : ''}`, money(invoice.tax_amount, cur));
  }
  y += 1;
  pair('TOTAL', money(invoice.total_amount, cur), 11, true);
  for (const p of c.payments) pair(`Paid (${p.payment_method})`, money(p.amount, cur), 7.5);
  if (c.balance > 0.009) pair('BALANCE DUE', money(c.balance, cur), 9, true);
  else if (invoice.status !== 'VOID') center('*** PAID ***', 9, true);
  if (invoice.status === 'VOID') center('*** VOID ***', 9, true);
  rule();
  center(`Thank you for playing at ${settings.cafe_name}!`, 7.5);
  return y + 4;
}

// ------------------------------------------------------------ public API

export async function buildInvoicePdf(
  invoice: Invoice,
  items: InvoiceItem[],
  payments: Payment[],
  settings: CafeSettings,
  options: InvoicePdfOptions = {}
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const c = makeCtx(invoice, items, payments, settings);
  const logoImg = await loadLogo();
  const title = clean(`Invoice ${invoice.invoice_number} - ${settings.cafe_name}`);

  let doc: JsPDFDoc;
  if (options.format === 'receipt') {
    // measure on a tall page, then draw on a page cut to fit
    const probe = new jsPDF({ unit: 'mm', format: [80, 2000] });
    const h = Math.max(drawReceipt(probe, c, logoImg), 100);
    doc = new jsPDF({ unit: 'mm', format: [80, h] });
    drawReceipt(doc, c, logoImg);
  } else {
    doc = new jsPDF({ unit: 'mm', format: 'a4' });
    await drawA4(doc, c, logoImg);
  }
  doc.setProperties({ title, subject: title, author: clean(settings.cafe_name), creator: clean(settings.cafe_name) });
  return doc.output('blob');
}

/** Same as buildInvoicePdf but wrapped in a File with the invoice-number filename. */
export async function buildInvoicePdfFile(
  invoice: Invoice,
  items: InvoiceItem[],
  payments: Payment[],
  settings: CafeSettings,
  options: InvoicePdfOptions = {}
): Promise<File> {
  const blob = await buildInvoicePdf(invoice, items, payments, settings, options);
  return new File([blob], invoicePdfFilename(invoice), { type: 'application/pdf' });
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
