'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { useApi, invalidate } from '@/lib/use-api';
import { EmptyState, StatCard } from '@/components/ui/misc';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Logo } from '@/components/ui/logo';
import { formatMoney, formatDateTime, formatDuration, formatClock } from '@/lib/billing/format';
import type { CafeSettings, Invoice, InvoiceItem, Payment } from '@/types';
import { ArrowLeft, Printer, FileText, Receipt, Share2, Banknote, CheckCircle2 } from 'lucide-react';

interface InvoiceDetail {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  settings: CafeSettings;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data, error, reload } = useApi<InvoiceDetail>(id ? `/api/admin/invoices/${id}` : null);
  const [layout, setLayout] = useState<'a4' | 'thermal'>('a4');
  const [payOpen, setPayOpen] = useState(false);

  const load = () => {
    reload();
    invalidate('/api/admin/invoices?');
    invalidate('/api/admin/payments');
    invalidate('/api/admin/dashboard');
  };

  if (error && !data) {
    return (
      <EmptyState
        title="Couldn’t load invoice"
        message={error.message}
        className="mt-10"
        action={
          <button onClick={() => reload()} className="text-sm font-bold text-primary hover:underline">
            Retry
          </button>
        }
      />
    );
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
      </div>
    );
  }

  const { invoice, items, payments, settings } = data;
  const sym = settings.currency_symbol || '₹';
  const paidTotal = payments.filter((p) => p.payment_status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(invoice.total_amount - paidTotal, 0);

  function print() {
    window.print();
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Invoice ${invoice.invoice_number}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Invoice link copied');
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className={`mx-auto max-w-4xl ${layout === 'thermal' ? 'thermal-print' : 'a4-print'}`}>
      {/* toolbar (never printed) */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/invoices" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-content">
          <ArrowLeft className="h-4 w-4" /> Invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-border bg-surface-2 p-1">
            <button
              onClick={() => setLayout('a4')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${layout === 'a4' ? 'bg-primary text-white' : 'text-muted'}`}
              aria-pressed={layout === 'a4'}
            >
              <FileText className="mr-1 inline h-3.5 w-3.5" /> A4
            </button>
            <button
              onClick={() => setLayout('thermal')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${layout === 'thermal' ? 'bg-primary text-white' : 'text-muted'}`}
              aria-pressed={layout === 'thermal'}
            >
              <Receipt className="mr-1 inline h-3.5 w-3.5" /> Thermal 80mm
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={share}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
          <Button size="sm" onClick={print}>
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
          {invoice.status !== 'PAID' && invoice.status !== 'VOID' && remaining > 0 && (
            <Button variant="success" size="sm" onClick={() => setPayOpen(true)}>
              <Banknote className="h-4 w-4" /> Record payment
            </Button>
          )}
        </div>
      </div>

      {/* payment status banner */}
      <div className="no-print mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={formatMoney(invoice.total_amount, sym)} tone="primary" />
        <StatCard label="Paid" value={formatMoney(paidTotal, sym)} tone="success" />
        <StatCard label="Balance" value={formatMoney(remaining, sym)} tone={remaining > 0 ? 'warning' : 'success'} />
        <StatCard label="Status" value={invoice.status} />
      </div>

      {/* PRINT AREA */}
      <div className="print-area mx-auto overflow-hidden rounded-2xl bg-white text-black shadow-card">
        {layout === 'a4' ? (
          <A4Layout invoice={invoice} items={items} payments={payments} settings={settings} sym={sym} />
        ) : (
          <ThermalLayout invoice={invoice} items={items} payments={payments} settings={settings} sym={sym} />
        )}
      </div>

      {/* payments list (never printed) */}
      {payments.length > 0 && (
        <section className="no-print mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Payments</h2>
          <ul className="glass divide-y divide-border rounded-2xl shadow-card">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                <span className="flex-1">
                  {p.payment_method}
                  {p.transaction_reference ? ` · ref ${p.transaction_reference}` : ''}
                  {' · '}
                  {formatDateTime(p.paid_at ?? p.created_at, settings.timezone)}
                </span>
                <span className="font-bold tabular-nums">{formatMoney(p.amount, sym)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PaymentModal
        invoice={invoice}
        remaining={remaining}
        sym={sym}
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          load();
        }}
      />
    </div>
  );
}

function A4Layout({
  invoice, items, payments, settings, sym,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  settings: CafeSettings;
  sym: string;
}) {
  return (
    <div className="p-8 sm:p-12" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* header */}
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-start gap-4">
          <Logo className="h-16 w-auto shrink-0 rounded-lg" alt={settings.cafe_name} />
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">{settings.cafe_name}</h1>
            {settings.address && <p className="mt-1 text-xs text-gray-700">{settings.address}</p>}
            <p className="text-xs text-gray-700">
              {settings.phone ? `Phone: ${settings.phone}` : ''}
              {settings.email ? ` · ${settings.email}` : ''}
            </p>
            {settings.gstin && <p className="text-xs text-gray-700">GSTIN: {settings.gstin}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-black uppercase">Invoice</p>
          <p className="mt-1 font-mono text-sm font-bold">{invoice.invoice_number}</p>
          <p className="text-xs text-gray-700">{formatDateTime(invoice.issued_at, settings.timezone)}</p>
        </div>
      </div>

      {/* customer */}
      <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Billed to</p>
          <p className="mt-1 text-base font-bold">{invoice.customer_name}</p>
          <p className="text-gray-700">{invoice.customer_mobile}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Session</p>
          <p className="mt-1 font-bold">{invoice.resource_name}</p>
          <p className="text-gray-700">
            {formatDateTime(invoice.session_start, settings.timezone)} – {formatClock(invoice.session_end, settings.timezone)}
          </p>
          <p className="text-gray-700">
            Duration: {invoice.duration_minutes ?? 0} minutes
            {invoice.duration_minutes ? ` (${formatDuration(invoice.duration_minutes * 60)})` : ''}
          </p>
        </div>
      </div>

      {/* items */}
      <table className="mt-8 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2 text-[10px] font-bold uppercase tracking-widest">Description</th>
            <th className="py-2 text-right text-[10px] font-bold uppercase tracking-widest">Qty</th>
            <th className="py-2 text-right text-[10px] font-bold uppercase tracking-widest">Rate</th>
            <th className="py-2 text-right text-[10px] font-bold uppercase tracking-widest">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-gray-200">
              <td className="py-2.5">
                {it.name_snapshot}
                <span className="ml-2 text-[10px] uppercase text-gray-400">{it.item_type}</span>
              </td>
              <td className="py-2.5 text-right tabular-nums">{it.quantity}</td>
              <td className="py-2.5 text-right tabular-nums">{formatMoney(it.unit_price, sym)}</td>
              <td className="py-2.5 text-right font-semibold tabular-nums">{formatMoney(it.total_price, sym)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="mt-6 flex justify-end">
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(invoice.subtotal, sym)}</span>
          </div>
          {invoice.discount_amount > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Discount{invoice.discount_type === 'PERCENT' ? ` (${invoice.discount_value}%)` : ''}</span>
              <span className="tabular-nums">− {formatMoney(invoice.discount_amount, sym)}</span>
            </div>
          )}
          {invoice.tax_amount > 0 && (
            <div className="flex justify-between">
              <span>{invoice.tax_name} ({invoice.tax_rate}%)</span>
              <span className="tabular-nums">{formatMoney(invoice.tax_amount, sym)}</span>
            </div>
          )}
          <div className="flex justify-between border-t-2 border-black pt-2 text-base font-black">
            <span>TOTAL</span>
            <span className="tabular-nums">{formatMoney(invoice.total_amount, sym)}</span>
          </div>
          <div className="flex justify-between pt-1 text-xs text-gray-600">
            <span>Payment status</span>
            <span className="font-bold uppercase">{invoice.status}</span>
          </div>
          {payments.length > 0 && (
            <div className="pt-1 text-xs text-gray-600">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>Paid via {p.payment_method}</span>
                  <span className="tabular-nums">{formatMoney(p.amount, sym)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-10 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-500">
        Thank you for playing at {settings.cafe_name}! · Generated by Gaming Cafe Management System
      </p>
    </div>
  );
}

function ThermalLayout({
  invoice, items, payments, settings, sym,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  settings: CafeSettings;
  sym: string;
}) {
  return (
    <div className="thermal-receipt mx-auto p-3" style={{ fontFamily: 'ui-monospace, Courier New, monospace' }}>
      <div className="text-center">
        <div className="mb-1 flex justify-center">
          <Logo className="h-10 w-auto rounded" alt={settings.cafe_name} />
        </div>
        <p className="text-sm font-black uppercase">{settings.cafe_name}</p>
        {settings.address && <p className="text-[10px]">{settings.address}</p>}
        {settings.phone && <p className="text-[10px]">Ph: {settings.phone}</p>}
        {settings.gstin && <p className="text-[10px]">GSTIN: {settings.gstin}</p>}
        <p className="my-1">{'─'.repeat(32)}</p>
        <p className="text-xs font-bold">TAX INVOICE</p>
        <p className="text-[10px]">{invoice.invoice_number}</p>
        <p className="text-[10px]">{formatDateTime(invoice.issued_at, settings.timezone)}</p>
      </div>
      <p className="my-1">{'─'.repeat(32)}</p>
      <p className="text-[10px]">Customer: {invoice.customer_name}</p>
      <p className="text-[10px]">Mobile: {invoice.customer_mobile}</p>
      <p className="text-[10px]">Station: {invoice.resource_name}</p>
      <p className="text-[10px]">
        {formatDateTime(invoice.session_start, settings.timezone)} – {formatClock(invoice.session_end, settings.timezone)}
      </p>
      <p className="text-[10px]">Duration: {invoice.duration_minutes ?? 0} min</p>
      <p className="my-1">{'─'.repeat(32)}</p>
      {items.map((it) => (
        <div key={it.id} className="flex justify-between text-[10px]">
          <span className="truncate">
            {it.name_snapshot.slice(0, 18)} x{it.quantity}
          </span>
          <span className="tabular-nums">{formatMoney(it.total_price, sym)}</span>
        </div>
      ))}
      <p className="my-1">{'─'.repeat(32)}</p>
      <div className="flex justify-between text-[11px]">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatMoney(invoice.subtotal, sym)}</span>
      </div>
      {invoice.discount_amount > 0 && (
        <div className="flex justify-between text-[11px]">
          <span>Discount</span>
          <span className="tabular-nums">-{formatMoney(invoice.discount_amount, sym)}</span>
        </div>
      )}
      {invoice.tax_amount > 0 && (
        <div className="flex justify-between text-[11px]">
          <span>{invoice.tax_name}</span>
          <span className="tabular-nums">{formatMoney(invoice.tax_amount, sym)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t border-dashed border-black pt-1 text-sm font-black">
        <span>TOTAL</span>
        <span className="tabular-nums">{formatMoney(invoice.total_amount, sym)}</span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span>Status: {invoice.status}</span>
        {payments[0] && <span>{payments[0].payment_method}</span>}
      </div>
      <p className="my-1">{'─'.repeat(32)}</p>
      <p className="text-center text-[10px]">Thank you! Game again soon.</p>
      <p className="text-center text-[9px]">{settings.cafe_name}</p>
    </div>
  );
}

function PaymentModal({
  invoice, remaining, sym, open, onClose, onPaid,
}: {
  invoice: Invoice;
  remaining: number;
  sym: string;
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setAmount(remaining), [remaining, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0 || amount > remaining + 0.01) {
      toast.error(`Amount must be between 0 and ${remaining}`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/admin/payments', {
        invoiceId: invoice.id,
        amount: Number(amount),
        paymentMethod: method,
        transactionReference: reference || null,
      });
      toast.success('Payment recorded');
      onPaid();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Record payment — ${invoice.invoice_number}`} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">
          Outstanding balance: <strong className="text-content">{formatMoney(remaining, sym)}</strong>
        </p>
        <Field label={`Amount (${sym})`} required>
          <Input type="number" min={0.01} max={remaining} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} required autoFocus />
        </Field>
        <Field label="Method" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI txn id…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="success" loading={busy}>Record payment</Button>
        </div>
      </form>
    </Modal>
  );
}
