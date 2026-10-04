'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { CardGridSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import type { PricingPlan, Resource } from '@/types';
import { Monitor, Plus, Pencil, Trash2, Wrench } from 'lucide-react';

const TYPES = ['PLAYSTATION', 'PC', 'POOL', 'VR', 'SNOOKER', 'AIR_HOCKEY', 'XBOX', 'OTHER'];

export default function ResourcesPage() {
  const toast = useToast();
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [editResource, setEditResource] = useState<Resource | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        api.get<{ resources: Resource[] }>('/api/admin/resources'),
        api.get<{ plans: PricingPlan[] }>('/api/admin/pricing/plans'),
      ]);
      setResources(r.resources);
      setPlans(p.plans);
    } catch {
      setResources([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useDebouncedCallback(load, 400);
  useRealtime('resources', refetch);
  useRealtime('sessions', refetch);

  async function setMaintenance(r: Resource, status: 'ACTIVE' | 'MAINTENANCE') {
    setBusy(true);
    try {
      await api.patch(`/api/admin/resources/${r.id}`, { status });
      toast.success(status === 'MAINTENANCE' ? `${r.name} set to maintenance` : `${r.name} is back online`);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteId) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/resources/${deleteId}`);
      toast.success('Resource deleted');
      setDeleteId(null);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Stations customers can book â€” add more anytime"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Resource
          </Button>
        }
      />

      {!resources ? (
        <CardGridSkeleton cards={3} />
      ) : resources.length === 0 ? (
        <EmptyState
          icon={<Monitor className="h-10 w-10" />}
          title="No resources yet"
          message="Add your PS5s, pool tables, PCs or any other station."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Resource</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {resources.map((r) => {
            const plan = plans.find((p) => p.id === r.default_pricing_plan_id);
            return (
              <div key={r.id} className={`glass rounded-2xl p-5 shadow-card ${!r.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-extrabold">{r.name}</h3>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">{r.type.replace(/_/g, ' ')}</p>
                  </div>
                  <StatusBadge status={r.current_status} />
                </div>
                {r.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{r.description}</p>}
                <p className="mt-2 text-xs text-muted">
                  Default plan: <span className="font-semibold text-content">{plan ? `${plan.name}` : 'none set'}</span>
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditResource(r)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {r.status === 'MAINTENANCE' ? (
                    <Button size="sm" variant="success" loading={busy} onClick={() => setMaintenance(r, 'ACTIVE')}>
                      Back online
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" loading={busy} onClick={() => setMaintenance(r, 'MAINTENANCE')}>
                      <Wrench className="h-3.5 w-3.5" /> Maintenance
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDeleteId(r.id)} aria-label={`Delete ${r.name}`}>
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ResourceModal
        open={addOpen || !!editResource}
        resource={editResource}
        plans={plans}
        onClose={() => {
          setAddOpen(false);
          setEditResource(null);
        }}
        onSaved={() => {
          refetch();
          setAddOpen(false);
          setEditResource(null);
        }}
      />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete resource?"
        message="Resources with session history cannot be deleted â€” disable them instead."
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </div>
  );
}

function ResourceModal({
  open, resource, plans, onClose, onSaved,
}: {
  open: boolean;
  resource: Resource | null;
  plans: PricingPlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '', type: 'PLAYSTATION', description: '', status: 'ACTIVE',
    defaultPricingPlanId: '', active: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (resource) {
      setForm({
        name: resource.name,
        type: TYPES.includes(resource.type) ? resource.type : 'OTHER',
        description: resource.description ?? '',
        status: resource.status,
        defaultPricingPlanId: resource.default_pricing_plan_id ?? '',
        active: resource.active,
      });
    } else {
      setForm({ name: '', type: 'PLAYSTATION', description: '', status: 'ACTIVE', defaultPricingPlanId: '', active: true });
    }
  }, [resource, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        type: form.type,
        description: form.description || null,
        status: form.status,
        defaultPricingPlanId: form.defaultPricingPlanId || null,
        active: form.active,
      };
      if (resource) await api.patch(`/api/admin/resources/${resource.id}`, body);
      else await api.post('/api/admin/resources', body);
      toast.success(resource ? 'Resource updated' : 'Resource added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const typePlans = plans.filter((p) => p.active && p.resource_type === form.type);

  return (
    <Modal open={open} onClose={onClose} title={resource ? `Edit ${resource.name}` : 'Add resource'} size="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="PS5 03" />
          </Field>
          <Field label="Type" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, defaultPricingPlanId: '' })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional details" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="INACTIVE">Inactive (hidden)</option>
            </Select>
          </Field>
          <Field label="Default pricing plan" hint={typePlans.length === 0 ? 'No plans for this type yet' : undefined}>
            <Select value={form.defaultPricingPlanId} onChange={(e) => setForm({ ...form, defaultPricingPlanId: e.target.value })}>
              <option value="">Cheapest plan for type</option>
              {typePlans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} Â· â‚¹{p.price}</option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
          Visible / bookable
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{resource ? 'Save changes' : 'Add resource'}</Button>
        </div>
      </form>
    </Modal>
  );
}
