'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useApi, invalidate } from '@/lib/use-api';
import { useAdmin } from '@/components/admin/admin-context';
import { PageHeader, EmptyState, ErrorState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/billing/format';
import type { CafeSettings, Profile } from '@/types';
import { Store, QrCode, Users, Download, Printer, Save } from 'lucide-react';

export default function SettingsPage() {
  const toast = useToast();
  const { settings: shared, setSettings: setSharedSettings } = useAdmin();
  // the form starts from the shell's settings (instant), then refreshes from
  // the API unless the user has already started editing
  const [settings, setSettingsState] = useState<CafeSettings>(shared);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const setSettings = (s: CafeSettings) => {
    setDirty(true);
    setSettingsState(s);
  };

  const { data: fresh } = useApi<{ settings: CafeSettings }>('/api/admin/settings');
  useEffect(() => {
    if (fresh?.settings && !dirty) setSettingsState(fresh.settings);
  }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      const res = await api.put<{ settings: CafeSettings }>('/api/admin/settings', settings);
      setSettingsState(res.settings);
      setDirty(false);
      // propagate to the shell and every page reading useSettings()
      setSharedSettings(res.settings);
      invalidate('/api/admin');
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Settings" subtitle="Cafe profile, billing rules and team" />

      <form onSubmit={save} className="space-y-6">
        {/* cafe info */}
        <section className="glass rounded-2xl p-5 shadow-card" aria-label="Cafe information">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
            <Store className="h-4 w-4" /> Cafe information
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cafe name" required>
              <Input value={settings.cafe_name} onChange={(e) => setSettings({ ...settings, cafe_name: e.target.value })} required />
            </Field>
            <Field label="Phone">
              <Input value={settings.phone ?? ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={settings.email ?? ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} />
            </Field>
            <Field label="GSTIN (optional)">
              <Input value={settings.gstin ?? ''} onChange={(e) => setSettings({ ...settings, gstin: e.target.value })} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={settings.address ?? ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} />
            </Field>
            <Field label="Logo URL (optional)">
              <Input value={settings.logo_url ?? ''} onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label="Invoice prefix" hint={`Invoices look like ${settings.invoice_prefix}-2026-00001`}>
              <Input value={settings.invoice_prefix} onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value.toUpperCase() })} maxLength={10} />
            </Field>
          </div>
        </section>

        {/* billing */}
        <section className="glass rounded-2xl p-5 shadow-card" aria-label="Billing settings">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
            <Save className="h-4 w-4" /> Billing &amp; tax
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Billing mode" hint="How elapsed time is rounded on the final bill">
              <Select value={settings.billing_mode} onChange={(e) => setSettings({ ...settings, billing_mode: e.target.value as any })}>
                <option value="EXACT_MINUTES">Per minute (exact)</option>
                <option value="ROUND_UP_15">Round up to 15 minutes</option>
                <option value="ROUND_UP_30">Round up to 30 minutes</option>
                <option value="ROUND_UP_60">Round up to 1 hour</option>
              </Select>
            </Field>
            <Field label="Minimum billing (minutes)">
              <Input type="number" min={0} max={240} value={settings.min_billing_minutes} onChange={(e) => setSettings({ ...settings, min_billing_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="Currency symbol">
              <Input value={settings.currency_symbol} onChange={(e) => setSettings({ ...settings, currency_symbol: e.target.value })} maxLength={4} />
            </Field>
            <Field label="Timezone">
              <Select value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}>
                {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'UTC', 'America/New_York', 'Europe/London'].map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-2/60 p-4">
            <label className="flex items-center justify-between text-sm font-semibold">
              Enable tax (GST etc.)
              <input
                type="checkbox"
                checked={settings.tax_enabled}
                onChange={(e) => setSettings({ ...settings, tax_enabled: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
            </label>
            {settings.tax_enabled && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tax name">
                  <Input value={settings.tax_name ?? ''} onChange={(e) => setSettings({ ...settings, tax_name: e.target.value })} placeholder="GST" />
                </Field>
                <Field label="Tax rate (%)">
                  <Input type="number" min={0} max={100} step="0.01" value={settings.tax_rate ?? 0} onChange={(e) => setSettings({ ...settings, tax_rate: Number(e.target.value) })} />
                </Field>
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Toggle label="Pause allowed" checked={settings.pause_enabled} onChange={(v) => setSettings({ ...settings, pause_enabled: v })} />
            <Toggle label="Public bookings (QR page)" checked={settings.allow_public_bookings} onChange={(v) => setSettings({ ...settings, allow_public_bookings: v })} />
            <Toggle label="Waitlist enabled" checked={settings.waitlist_enabled} onChange={(v) => setSettings({ ...settings, waitlist_enabled: v })} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Booking window (days ahead)">
              <Input type="number" min={0} max={90} value={settings.booking_max_days_ahead} onChange={(e) => setSettings({ ...settings, booking_max_days_ahead: Number(e.target.value) })} />
            </Field>
          </div>
        </section>

        <div className="sticky bottom-20 z-30 sm:bottom-4">
          <Button type="submit" size="lg" loading={busy} className="w-full shadow-glow">
            <Save className="h-4 w-4" /> Save settings
          </Button>
        </div>
      </form>

      <QrSection />
      <StaffSection />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm font-semibold">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-3'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function QrSection() {
  const toast = useToast();
  const [appUrl, setAppUrl] = useState('');

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  const bookingUrl = `${appUrl}/book`;

  return (
    <section className="glass rounded-2xl p-5 shadow-card" aria-label="Booking QR code">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
        <QrCode className="h-4 w-4" /> Customer booking QR
      </h2>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="rounded-2xl bg-white p-3 shadow-glow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/admin/qr" alt="Booking QR code" width={180} height={180} />
        </div>
        <div className="flex-1 space-y-3 text-center sm:text-left">
          <p className="text-sm text-muted">
            Print this QR and place it on the counter. Customers scan it with their phone camera to see
            live availability and book — the QR always points to the same page, so it never needs
            reprinting.
          </p>
          <p className="rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-secondary">{bookingUrl}</p>
          <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
            <a href="/api/admin/qr" download="gaming-cafe-booking-qr.png">
              <Button variant="secondary" size="sm" type="button">
                <Download className="h-4 w-4" /> Download PNG
              </Button>
            </a>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                const w = window.open('', '_blank', 'width=460,height=600');
                if (!w) return;
                w.document.write(
                  `<html><head><title>Booking QR</title><style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px}</style></head><body><h2 style="margin:0">Scan to book & see live availability</h2><img src="${appUrl}/api/admin/qr" width="360" height="360"/><p style="font-size:12px;color:#555">${bookingUrl}</p><script>window.onload=()=>window.print()</script></body></html>`
                );
                w.document.close();
              }}
            >
              <Printer className="h-4 w-4" /> Print QR
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(bookingUrl);
                toast.success('Booking link copied');
              }}
            >
              Copy link
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function StaffSection() {
  const toast = useToast();
  const { data, error, reload: load, mutate } = useApi<{ staff: Profile[] }>('/api/admin/staff');
  const staff = data?.staff ?? null;
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const [busy, setBusy] = useState(false);

  async function update(id: string, patch: Partial<Profile>) {
    const prev = data;
    mutate((d) => (d ? { ...d, staff: d.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : d));
    try {
      await api.patch(`/api/admin/staff/${id}`, patch);
      toast.success('Updated');
      load();
    } catch (e: any) {
      mutate(() => prev);
      toast.error(e.message);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/admin/staff', form);
      toast.success(`${form.name} can now sign in`);
      setForm({ name: '', email: '', password: '', role: 'STAFF' });
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass rounded-2xl p-5 shadow-card" aria-label="Staff management">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
        <Users className="h-4 w-4" /> Staff &amp; roles
      </h2>

      {error && !data ? (
        <ErrorState message={error.message} onRetry={load} className="mb-5 py-6" />
      ) : !staff ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : staff.length === 0 ? (
        <EmptyState title="No staff accounts" message="Create accounts for your employees." className="py-6" />
      ) : (
        <ul className="mb-5 divide-y divide-border rounded-xl border border-border">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  {s.name} {s.active ? '' : <span className="text-xs font-bold text-danger">(disabled)</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {s.email} · joined {formatDateTime(s.created_at)}
                </p>
              </div>
              <select
                value={s.role}
                onChange={(e) => update(s.id, { role: e.target.value as Profile['role'] })}
                className="input-base w-auto py-1.5 text-xs"
                aria-label={`Role for ${s.name}`}
              >
                <option value="STAFF">Staff</option>
                <option value="MANAGER">Manager</option>
                <option value="ADMIN">Admin</option>
              </select>
              <button
                onClick={() => update(s.id, { active: !s.active })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                  s.active ? 'border-danger/40 text-danger hover:bg-danger/10' : 'border-success/40 text-success hover:bg-success/10'
                }`}
              >
                {s.active ? 'Disable' : 'Enable'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Password" hint="Min 8 characters"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="STAFF">Staff — sessions, bookings, billing</option>
            <option value="MANAGER">Manager — + reports</option>
            <option value="ADMIN">Admin — full access</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" loading={busy}>Create account</Button>
        </div>
      </form>
    </section>
  );
}
