'use client';

import { useEffect, useState } from 'react';
import { useApi, invalidate } from '@/lib/use-api';
import { api } from '@/lib/api-client';
import { useAdmin } from '@/components/admin/admin-context';
import { PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatMoney } from '@/lib/billing/format';
import {
  MessageCircle, QrCode, RefreshCw, XCircle, CheckCircle2, AlertTriangle,
  Smartphone, Wifi, WifiOff,
} from 'lucide-react';

interface WaState {
  enabled: boolean;
  auto_send: boolean;
  send_delay_ms: number;
  connected: boolean;
  phone: string | null;
  qr: string | null;
  last_seen: string | null;
  last_error: string | null;
}
interface WaMessage {
  id: string;
  invoice_id: string | null;
  to_mobile: string;
  caption: string | null;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  invoices: { invoice_number: string; total_amount: number } | null;
}

export default function WhatsAppPage() {
  const { profile } = useAdmin();
  const toast = useToast();
  const { data, reload } = useApi<{ state: WaState | null; messages: WaMessage[] }>('/api/admin/whatsapp');
  const [saving, setSaving] = useState(false);

  // poll: QR linking + delivery log need to feel live
  useEffect(() => {
    const id = setInterval(() => reload(), 4000);
    return () => clearInterval(id);
  }, [reload]);

  const state = data?.state ?? null;
  const now = Date.now();
  const relayOnline = !!state?.last_seen && now - new Date(state.last_seen).getTime() < 15_000;
  const sym = '₹';
  const isAdmin = profile.role === 'ADMIN';

  async function saveConfig(patch: Partial<Pick<WaState, 'enabled' | 'auto_send' | 'send_delay_ms'>>) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      await api.put('/api/admin/whatsapp', patch);
      invalidate('/api/admin/whatsapp');
      await reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: 'retry' | 'cancel') {
    try {
      await api.post(`/api/admin/whatsapp/${id}`, { action });
      toast.success(action === 'retry' ? 'Queued again' : 'Cancelled');
      await reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="WhatsApp receipts"
        subtitle="Invoice PDFs are sent to the customer's number automatically — via your own WhatsApp, linked here."
      />

      {/* connection */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-extrabold">
              {relayOnline ? <Wifi className="h-4 w-4 text-success" /> : <WifiOff className="h-4 w-4 text-muted" />}
              Relay app: {relayOnline ? 'online' : 'offline'}
            </p>
            <p className="flex items-center gap-2 text-sm font-extrabold">
              <Smartphone className="h-4 w-4 text-primary" />
              WhatsApp:{' '}
              {state?.connected ? (
                <span className="text-success">connected{state.phone ? ` · ${state.phone}` : ''}</span>
              ) : (
                <span className="text-warning">not linked</span>
              )}
            </p>
            {state?.last_error && (
              <p className="text-xs font-semibold text-danger">Last error: {state.last_error}</p>
            )}
          </div>
          <div className="text-right text-xs text-muted">
            {state?.last_seen && <p>last heartbeat {formatDateTime(state.last_seen)}</p>}
          </div>
        </div>

        {/* QR linking */}
        {!state?.connected && (
          <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-6">
            {relayOnline && state?.qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.qr} alt="WhatsApp QR code" width={220} height={220} className="rounded-lg bg-white p-2" />
                <p className="text-center text-xs text-muted">
                  Open <strong>WhatsApp → Settings → Linked Devices → Link a Device</strong> and scan this code.
                </p>
              </>
            ) : (
              <>
                <QrCode className="h-8 w-8 text-muted" />
                <p className="max-w-md text-center text-xs text-muted">
                  {relayOnline
                    ? 'Starting WhatsApp… the scanner QR appears here in a moment.'
                    : 'Start the relay app on the shop PC to link your WhatsApp:'}
                  <br />
                  <code className="mt-1 inline-block rounded bg-surface px-2 py-1 font-bold text-content">
                    cd whatsapp-relay && npm install && npm start
                  </code>
                </p>
              </>
            )}
          </div>
        )}

        <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This uses WhatsApp Web automation (unofficial). Use a <strong>dedicated shop number</strong>, not your
            personal one — heavy automation can get a number banned. Only invoice receipts are sent.
          </span>
        </p>
      </section>

      {/* settings */}
      <section className="glass mb-4 rounded-2xl p-5 shadow-card">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Automation</h2>
        <div className="space-y-3">
          <Toggle
            label="Send receipts automatically"
            hint="Every new invoice is queued the moment it is generated."
            checked={!!state?.auto_send}
            disabled={!isAdmin || saving}
            onChange={(v) => saveConfig({ auto_send: v })}
          />
          <Toggle
            label="Enabled (master switch)"
            hint="Off = nothing is queued or sent."
            checked={!!state?.enabled}
            disabled={!isAdmin || saving}
            onChange={(v) => saveConfig({ enabled: v })}
          />
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">Delay between sends</span>
            <input
              type="number"
              min={0}
              max={60000}
              step={500}
              value={state?.send_delay_ms ?? 2500}
              disabled={!isAdmin || saving}
              onChange={(e) => {}}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== state?.send_delay_ms) saveConfig({ send_delay_ms: v });
              }}
              className="input-base w-28"
            />
            <span className="text-xs text-muted">ms — keeps messaging human-looking</span>
          </label>
        </div>
      </section>

      {/* message log */}
      <section className="glass rounded-2xl p-5 shadow-card">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Message log</h2>
        {(data?.messages ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No receipts sent yet</p>
        ) : (
          <ul className="divide-y divide-border">
            {(data?.messages ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {m.invoices?.invoice_number ?? 'invoice'}{' '}
                    <span className="font-normal text-muted">→ {m.to_mobile}</span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {m.invoices ? `${formatMoney(m.invoices.total_amount, sym)} · ` : ''}
                    {formatDateTime(m.created_at)}
                    {m.attempts > 1 ? ` · ${m.attempts} attempts` : ''}
                  </p>
                  {m.last_error && <p className="truncate text-xs text-danger">{m.last_error}</p>}
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                    m.status === 'SENT'
                      ? 'border-success/40 bg-success/10 text-success'
                      : m.status === 'FAILED'
                        ? 'border-danger/40 bg-danger/10 text-danger'
                        : 'border-warning/40 bg-warning/10 text-warning'
                  }`}
                >
                  {m.status === 'SENT' ? <CheckCircle2 className="h-3 w-3" /> : m.status === 'FAILED' ? <XCircle className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                  {m.status === 'PENDING' ? 'queued' : m.status.toLowerCase()}
                </span>
                <div className="flex gap-1.5">
                  {m.status !== 'PENDING' && (
                    <Button size="sm" variant="outline" onClick={() => act(m.id, 'retry')}>
                      <RefreshCw className="h-3.5 w-3.5" /> Send again
                    </Button>
                  )}
                  {m.status === 'PENDING' && (
                    <Button size="sm" variant="ghost" onClick={() => act(m.id, 'cancel')}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface-2/60 p-3 text-left hover:bg-surface-2 disabled:opacity-60"
    >
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-success' : 'bg-border-strong'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
