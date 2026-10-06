'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { useSettings } from '@/components/admin/admin-context';
import { PageHeader, EmptyState, ErrorState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatMoney, formatTimeOfDay, dayName } from '@/lib/billing/format';
import type { PricingPlan, PricingRule, Resource } from '@/types';
import { Tag, Plus, Pencil, Trash2, Zap, Clock } from 'lucide-react';

export default function PricingPage() {
  const toast = useToast();
  const settings = useSettings();
  const { data: planData, error: planError, reload: reloadPlans } = useApi<{ plans: PricingPlan[] }>('/api/admin/pricing/plans');
  const { data: ruleData, reload: reloadRules } = useApi<{ rules: PricingRule[] }>('/api/admin/pricing/rules');
  const { data: resData } = useApi<{ resources: Resource[] }>('/api/admin/resources');
  const plans = planData?.plans ?? null;
  const rules = ruleData?.rules ?? [];
  const resources = resData?.resources ?? [];
  const [editPlan, setEditPlan] = useState<PricingPlan | null>(null);
  const [addPlanOpen, setAddPlanOpen] = useState(false);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'plan' | 'rule'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    reloadPlans();
    reloadRules();
  }, [reloadPlans, reloadRules]);

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/pricing/${deleteTarget.kind}s/${deleteTarget.id}`);
      toast.success('Deleted');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const sym = settings.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="Plans and peak-hour rules — active sessions keep their original rate"
      />

      {/* plans */}
      <section className="mb-8" aria-label="Pricing plans">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
            <Tag className="h-4 w-4" /> Plans
          </h2>
          <Button size="sm" onClick={() => setAddPlanOpen(true)}>
            <Plus className="h-4 w-4" /> Add Plan
          </Button>
        </div>

        {planError && !planData ? (
          <ErrorState message={planError.message} onRetry={load} />
        ) : !plans ? (
          <ListSkeleton rows={4} />
        ) : plans.length === 0 ? (
          <EmptyState title="No pricing plans" message="Add at least one plan per resource type." className="py-8" />
        ) : (
          <div className="glass overflow-x-auto rounded-2xl shadow-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-bold">Name</th>
                  <th className="px-4 py-3 font-bold">Type</th>
                  <th className="px-4 py-3 font-bold">Billing</th>
                  <th className="px-4 py-3 font-bold">Price</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plans.map((p) => (
                  <tr key={p.id} className={`transition-colors hover:bg-surface-2/50 ${!p.active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    <td className="px-4 py-3 text-muted">{p.resource_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-muted">
                      {p.billing_type.replace(/_/g, ' ')}
                      {p.duration_minutes ? ` · ${p.duration_minutes} min` : ''}
                    </td>
                    <td className="px-4 py-3 font-bold tabular-nums text-secondary">{formatMoney(p.price, sym)}</td>
                    <td className="px-4 py-3 text-xs font-bold uppercase text-muted">{p.active ? 'Active' : 'Inactive'}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => setEditPlan(p)} aria-label={`Edit ${p.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button className="rounded-lg p-1.5 text-danger hover:bg-danger/10" onClick={() => setDeleteTarget({ kind: 'plan', id: p.id })} aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* peak rules */}
      <section aria-label="Peak pricing rules">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted">
            <Zap className="h-4 w-4 text-warning" /> Peak-hour / weekend rules
          </h2>
          <Button size="sm" onClick={() => setAddRuleOpen(true)}>
            <Plus className="h-4 w-4" /> Add Rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-10 w-10" />}
            title="No peak pricing rules"
            message="Optionally charge a different hourly rate during peak hours (e.g. 6–11 PM)."
            className="py-8"
          />
        ) : (
          <ul className="glass divide-y divide-border rounded-2xl shadow-card">
            {rules.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${!r.active ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{r.name}</p>
                  <p className="text-xs text-muted">
                    {formatTimeOfDay(r.start_time)} – {formatTimeOfDay(r.end_time)} ·{' '}
                    {r.resource_id
                      ? resources.find((x) => x.id === r.resource_id)?.name ?? 'Specific resource'
                      : r.resource_type
                        ? r.resource_type.replace(/_/g, ' ')
                        : 'All resources'}{' '}
                    · {r.days_of_week.length === 7 ? 'Every day' : r.days_of_week.map(dayName).join(' ')}
                  </p>
                </div>
                <span className="font-bold tabular-nums text-warning">{formatMoney(r.price, sym)}/hr</span>
                <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => setEditRule(r)} aria-label={`Edit ${r.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button className="rounded-lg p-1.5 text-danger hover:bg-danger/10" onClick={() => setDeleteTarget({ kind: 'rule', id: r.id })} aria-label={`Delete ${r.name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlanModal
        open={addPlanOpen || !!editPlan}
        plan={editPlan}
        onClose={() => { setAddPlanOpen(false); setEditPlan(null); }}
        onSaved={() => { load(); setAddPlanOpen(false); setEditPlan(null); }}
      />
      <RuleModal
        open={addRuleOpen || !!editRule}
        rule={editRule}
        resources={resources}
        onClose={() => { setAddRuleOpen(false); setEditRule(null); }}
        onSaved={() => { load(); setAddRuleOpen(false); setEditRule(null); }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete?"
        message="Active sessions keep their snapshotted rates."
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </div>
  );
}

function PlanModal({
  open, plan, onClose, onSaved,
}: {
  open: boolean;
  plan: PricingPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    resourceType: 'PLAYSTATION', name: '', billingType: 'HOURLY',
    price: 100, durationMinutes: '', active: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (plan) {
      setForm({
        resourceType: plan.resource_type,
        name: plan.name,
        billingType: plan.billing_type,
        price: plan.price,
        durationMinutes: plan.duration_minutes?.toString() ?? '',
        active: plan.active,
      });
    } else {
      setForm({ resourceType: 'PLAYSTATION', name: '', billingType: 'HOURLY', price: 100, durationMinutes: '', active: true });
    }
  }, [plan, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.billingType === 'PACKAGE' && !form.durationMinutes) {
      toast.error('Package plans need a duration');
      return;
    }
    setBusy(true);
    try {
      const body = {
        resourceType: form.resourceType,
        name: form.name,
        billingType: form.billingType,
        price: Number(form.price),
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        active: form.active,
      };
      if (plan) await api.patch(`/api/admin/pricing/plans/${plan.id}`, body);
      else await api.post('/api/admin/pricing/plans', body);
      toast.success(plan ? 'Plan updated' : 'Plan added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={plan ? `Edit ${plan.name}` : 'Add pricing plan'} size="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Resource type" required>
            <Select value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })}>
              {['PLAYSTATION', 'PC', 'POOL', 'VR', 'SNOOKER', 'AIR_HOCKEY', 'XBOX', 'OTHER'].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </Field>
          <Field label="Plan name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="PS5 Hourly" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Billing type" required>
            <Select value={form.billingType} onChange={(e) => setForm({ ...form, billingType: e.target.value })}>
              <option value="HOURLY">Hourly (₹ per hour)</option>
              <option value="PER_MINUTE">Per minute</option>
              <option value="FIXED">Fixed (flat per session)</option>
              <option value="PACKAGE">Package (flat up to N minutes)</option>
            </Select>
          </Field>
          <Field label="Price (₹)" required>
            <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required />
          </Field>
        </div>
        {form.billingType === 'PACKAGE' && (
          <Field label="Package duration (minutes)" required>
            <Input type="number" min={5} max={1440} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} required placeholder="120" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{plan ? 'Save changes' : 'Add plan'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RuleModal({
  open, rule, resources, onClose, onSaved,
}: {
  open: boolean;
  rule: PricingRule | null;
  resources: Resource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '', scope: 'type', resourceType: 'PLAYSTATION', resourceId: '',
    days: [0, 1, 2, 3, 4, 5, 6] as number[], startTime: '18:00', endTime: '23:00',
    price: 150, priority: 0, active: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rule) {
      setForm({
        name: rule.name,
        scope: rule.resource_id ? 'resource' : rule.resource_type ? 'type' : 'global',
        resourceType: rule.resource_type ?? 'PLAYSTATION',
        resourceId: rule.resource_id ?? '',
        days: rule.days_of_week,
        startTime: rule.start_time.slice(0, 5),
        endTime: rule.end_time.slice(0, 5),
        price: rule.price,
        priority: rule.priority,
        active: rule.active,
      });
    } else {
      setForm({ name: '', scope: 'type', resourceType: 'PLAYSTATION', resourceId: '', days: [0, 1, 2, 3, 4, 5, 6], startTime: '18:00', endTime: '23:00', price: 150, priority: 0, active: true });
    }
  }, [rule, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.startTime >= form.endTime) {
      toast.error('End time must be after start time');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name,
        resourceId: form.scope === 'resource' ? form.resourceId : null,
        resourceType: form.scope === 'type' ? form.resourceType : null,
        daysOfWeek: form.days,
        startTime: form.startTime,
        endTime: form.endTime,
        price: Number(form.price),
        priority: Number(form.priority),
        active: form.active,
      };
      if (rule) await api.patch(`/api/admin/pricing/rules/${rule.id}`, body);
      else await api.post('/api/admin/pricing/rules', body);
      toast.success(rule ? 'Rule updated' : 'Rule added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort(),
    }));
  };

  return (
    <Modal open={open} onClose={onClose} title={rule ? `Edit ${rule.name}` : 'Add peak pricing rule'} size="md">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Rule name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Evening peak" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Applies to">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="global">All resources</option>
              <option value="type">Resource type</option>
              <option value="resource">Specific resource</option>
            </Select>
          </Field>
          {form.scope === 'type' && (
            <Field label="Resource type">
              <Select value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })}>
                {['PLAYSTATION', 'PC', 'POOL', 'VR', 'SNOOKER', 'AIR_HOCKEY', 'XBOX', 'OTHER'].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </Field>
          )}
          {form.scope === 'resource' && (
            <Field label="Resource">
              <Select value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
                <option value="">Select…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start time" required>
            <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
          </Field>
          <Field label="End time" required>
            <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
          </Field>
        </div>
        <div>
          <p className="label-base">Days</p>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`h-9 w-12 rounded-lg text-xs font-bold ${
                  form.days.includes(d) ? 'bg-primary text-white' : 'bg-surface-2 text-muted'
                }`}
                aria-pressed={form.days.includes(d)}
                aria-label={dayName(d)}
              >
                {dayName(d)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hourly rate during peak (₹)" required>
            <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required />
          </Field>
          <Field label="Priority" hint="Higher wins when multiple rules match">
            <Input type="number" min={0} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{rule ? 'Save changes' : 'Add rule'}</Button>
        </div>
      </form>
    </Modal>
  );
}
