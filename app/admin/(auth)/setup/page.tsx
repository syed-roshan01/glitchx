'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Logo } from '@/components/ui/logo';
import { formatMoney } from '@/lib/billing/format';
import type { Resource, PricingPlan, MenuItem } from '@/types';
import {
  Store, Monitor, Tag, CupSoda, Users, QrCode, Check,
  ChevronRight, ChevronLeft, PartyPopper,
} from 'lucide-react';

interface SetupStatus {
  needs_admin: boolean;
  has_resources: boolean;
  has_items: boolean;
  has_plans: boolean;
  setup_completed: boolean;
}

const STEPS = [
  { id: 'cafe', label: 'Cafe information', icon: Store },
  { id: 'resources', label: 'Resources', icon: Monitor },
  { id: 'pricing', label: 'Pricing', icon: Tag },
  { id: 'items', label: 'Items', icon: CupSoda },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'qr', label: 'Booking QR', icon: QrCode },
] as const;

export default function SetupPage() {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [step, setStep] = useState(0); // 0 = account, then 1..6
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const [{ data: s }, { data: { user } }] = await Promise.all([
      supabase.rpc('public_setup_status'),
      supabase.auth.getUser(),
    ]);
    setStatus(s as SetupStatus);
    setSignedIn(!!user);
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setIsAdmin(profile?.role === 'ADMIN');
    }
    return { s, user };
  }, []);

  useEffect(() => {
    (async () => {
      const { s, user } = await refresh();
      if (!s.needs_admin && !user) {
        // setup already done — go to login
        router.replace('/admin/login');
      }
    })();
  }, [refresh, router]);

  if (!status) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
      </div>
    );
  }

  const stepIndex = status.needs_admin ? step : Math.max(step, 1);
  const totalSteps = 7; // account + 6

  return (
    <div className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo className="h-16 w-auto rounded-2xl shadow-glow" alt="Gaming Cafe" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Welcome to your Gaming Cafe</h1>
          <p className="mt-1.5 text-sm text-muted">
            Set up your cafe in a few quick steps — you can change everything later in Settings.
          </p>
        </div>

        {/* progress */}
        <div className="mb-6 flex items-center justify-center gap-1.5" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i <= stepIndex ? 'w-8 bg-primary' : 'w-4 bg-surface-3'
              }`}
            />
          ))}
        </div>

        <div className="glass rounded-2xl p-6 shadow-card sm:p-8">
          {stepIndex === 0 && (
            <AccountStep
              busy={busy}
              setBusy={setBusy}
              onDone={async () => {
                await refresh();
                setStep(1);
              }}
            />
          )}
          {stepIndex >= 1 && stepIndex <= 6 && !status.needs_admin && signedIn && isAdmin && (
            <>
              {stepIndex === 1 && <CafeStep />}
              {stepIndex === 2 && <ResourcesStep />}
              {stepIndex === 3 && <PricingStep />}
              {stepIndex === 4 && <ItemsStep />}
              {stepIndex === 5 && <StaffStep />}
              {stepIndex === 6 && <FinishStep status={status} />}

              <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
                <Button
                  variant="ghost"
                  onClick={() => setStep(Math.max(1, stepIndex - 1))}
                  disabled={stepIndex <= 1}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                  {STEPS[stepIndex - 1]?.label}
                  <span className="text-muted/50">
                    {stepIndex}/{totalSteps - 1}
                  </span>
                </div>
                {stepIndex < 6 ? (
                  <Button onClick={() => setStep(stepIndex + 1)}>
                    Continue <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.post('/api/admin/settings');
                        toast.success('Your cafe is ready!');
                        router.push('/admin');
                        router.refresh();
                      } catch (e: any) {
                        toast.error(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <PartyPopper className="h-4 w-4" /> Finish setup
                  </Button>
                )}
              </div>
            </>
          )}
          {stepIndex >= 1 && (status.needs_admin || !signedIn) && (
            <p className="text-sm text-muted">
              Please create the admin account first, then reload this page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- steps ----------------

function AccountStep({
  busy, setBusy, onDone,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data.session) {
        setNeedsEmailConfirm(true);
        return;
      }
      const { data: claimed, error: cerr } = await supabase.rpc('claim_first_admin');
      if (cerr) {
        toast.error('Could not assign the admin role: ' + cerr.message);
        return;
      }
      if (claimed === false) {
        toast.info('An admin already exists — signing you in as staff.');
      } else {
        toast.success('Admin account created!');
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (needsEmailConfirm) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-bold">Confirm your email</h2>
        <p className="text-sm text-muted">
          We sent a confirmation link to <strong>{email}</strong>. Click it, then reload this page
          to continue setup. (You can disable email confirmation in Supabase → Authentication →
          Providers to skip this step.)
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          I&apos;ve confirmed — reload
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-bold">Create the owner account</h2>
      <p className="text-sm text-muted">
        This first account becomes the <strong>ADMIN</strong>. You can add staff accounts later.
      </p>
      <Field label="Your name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Cafe Owner" />
      </Field>
      <Field label="Email" required>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="owner@cafe.com" />
      </Field>
      <Field label="Password" required hint="At least 8 characters">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="••••••••" />
      </Field>
      <Button type="submit" loading={busy} className="w-full" size="lg">
        Create admin account
      </Button>
    </form>
  );
}

function CafeStep() {
  const toast = useToast();
  const [form, setForm] = useState({ cafe_name: '', phone: '', address: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ settings: any }>('/api/admin/settings').then(({ settings }) => {
      setForm({
        cafe_name: settings.cafe_name ?? '',
        phone: settings.phone ?? '',
        address: settings.address ?? '',
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const current = (await api.get<{ settings: any }>('/api/admin/settings')).settings;
      await api.put('/api/admin/settings', { ...current, ...form });
      toast.success('Cafe information saved');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <form onSubmit={save} className="space-y-4">
      <h2 className="text-lg font-bold">Cafe information</h2>
      <Field label="Cafe name" required>
        <Input value={form.cafe_name} onChange={(e) => setForm({ ...form, cafe_name: e.target.value })} required placeholder="GlitchX Gaming Cafe" />
      </Field>
      <Field label="Phone">
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
      </Field>
      <Field label="Address">
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="12 MG Road, City" />
      </Field>
      <Button type="submit" loading={busy} variant="secondary">Save</Button>
    </form>
  );
}

function ResourcesStep() {
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('PLAYSTATION');

  const load = () => api.get<{ resources: Resource[] }>('/api/admin/resources').then((r) => setResources(r.resources));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Your stations</h2>
        <p className="text-sm text-muted">We pre-loaded PS5 01, PS5 02 and a Pool Table. Add anything else you have.</p>
      </div>
      <ul className="space-y-2">
        {resources.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span className="font-semibold">{r.name}</span>
            <span className="text-xs font-bold uppercase tracking-wide text-muted">{r.type.replace(/_/g, ' ')}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try {
            await api.post('/api/admin/resources', { name, type, status: 'ACTIVE', active: true });
            setName('');
            toast.success('Resource added');
            load();
          } catch (err: any) {
            toast.error(err.message);
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PC 01" className="flex-1" />
        <select
          className="input-base sm:w-44"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Resource type"
        >
          {['PLAYSTATION', 'PC', 'POOL', 'VR', 'SNOOKER', 'AIR_HOCKEY', 'XBOX', 'OTHER'].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Add</Button>
      </form>
    </div>
  );
}

function PricingStep() {
  const toast = useToast();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [form, setForm] = useState({ resourceType: 'PLAYSTATION', name: '', price: 100, durationMinutes: 60 });

  const load = () => api.get<{ plans: PricingPlan[] }>('/api/admin/pricing/plans').then((r) => setPlans(r.plans));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Pricing</h2>
        <p className="text-sm text-muted">Starter rates are pre-loaded (PS5 ₹100/hr, Pool ₹300/hr). Adjust or add plans.</p>
      </div>
      <ul className="space-y-2">
        {plans.map((p) => (
          <li key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-muted">{p.resource_type.replace(/_/g, ' ')} · {p.billing_type}</p>
            </div>
            <span className="font-bold text-secondary">{formatMoney(p.price)}</span>
          </li>
        ))}
      </ul>
      <form
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/admin/pricing/plans', {
              resourceType: form.resourceType,
              name: form.name || `${form.resourceType} ${form.durationMinutes} min`,
              billingType: 'HOURLY',
              price: form.price,
            });
            toast.success('Plan added');
            load();
          } catch (err: any) {
            toast.error(err.message);
          }
        }}
      >
        <select className="input-base" value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })} aria-label="Resource type">
          {['PLAYSTATION', 'PC', 'POOL', 'VR', 'SNOOKER', 'AIR_HOCKEY', 'XBOX', 'OTHER'].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <Input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} placeholder="Price ₹" aria-label="Price" />
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Plan name (optional)" className="col-span-2" />
        <Button type="submit" variant="secondary" className="col-span-2 sm:col-span-4">Add hourly plan</Button>
      </form>
    </div>
  );
}

function ItemsStep() {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [form, setForm] = useState({ name: '', price: 40, category: 'DRINK' });

  const load = () => api.get<{ items: MenuItem[] }>('/api/admin/items').then((r) => setItems(r.items));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Food & drinks</h2>
        <p className="text-sm text-muted">Coke ₹40, Water ₹20 and Chips ₹30 are pre-loaded. Add your menu.</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3 py-2.5">
            <span className="truncate text-sm font-semibold">{i.name}</span>
            <span className="text-sm font-bold text-secondary">{formatMoney(i.price)}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name.trim()) return;
          try {
            await api.post('/api/admin/items', { ...form, trackInventory: false, active: true });
            setForm({ name: '', price: 40, category: form.category });
            toast.success('Item added');
            load();
          } catch (err: any) {
            toast.error(err.message);
          }
        }}
      >
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Red Bull" className="flex-1" />
        <select className="input-base sm:w-32" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Category">
          {['DRINK', 'SNACK', 'FOOD', 'OTHER'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className="sm:w-28" aria-label="Price" />
        <Button type="submit" variant="secondary">Add</Button>
      </form>
    </div>
  );
}

function StaffStep() {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Add staff <span className="text-muted font-normal">(optional)</span></h2>
        <p className="text-sm text-muted">Staff can run sessions, bookings and billing but cannot change settings or pricing.</p>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/api/admin/staff', form);
            toast.success(`${form.name} can now sign in`);
            setForm({ name: '', email: '', password: '', role: 'STAFF' });
            setCreated(created + 1);
          } catch (err: any) {
            toast.error(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Password" hint="Min 8 characters"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></Field>
        <Field label="Role">
          <select className="input-base" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy} variant="secondary">Create staff account</Button>
          {created > 0 && <span className="ml-3 text-sm text-success">{created} account(s) created ✓</span>}
        </div>
      </form>
    </div>
  );
}

function FinishStep({ status }: { status: SetupStatus }) {
  const checks = [
    { ok: !status.needs_admin, label: 'Admin account' },
    { ok: status.has_resources, label: 'Resources added' },
    { ok: status.has_plans, label: 'Pricing configured' },
    { ok: status.has_items, label: 'Items added' },
  ];
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/15 text-success">
        <Check className="h-8 w-8" />
      </div>
      <div>
        <h2 className="text-lg font-bold">Almost done!</h2>
        <p className="mt-1 text-sm text-muted">
          Print the booking QR (Settings → Booking QR) and stick it on the counter. Customers scan it
          to see live availability and book.
        </p>
      </div>
      <ul className="mx-auto max-w-xs space-y-2 text-left">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-sm">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${c.ok ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
              {c.ok ? <Check className="h-3 w-3" /> : '!'}
            </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
