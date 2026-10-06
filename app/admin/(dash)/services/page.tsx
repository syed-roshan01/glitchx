'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { useSettings } from '@/components/admin/admin-context';
import { PageHeader, EmptyState, ErrorState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input, Field, Select, Textarea } from '@/components/ui/input';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/billing/format';
import type { ServiceItem } from '@/types';
import { Sparkles, Plus, Pencil, Trash2 } from 'lucide-react';

export default function ServicesPage() {
  const toast = useToast();
  const settings = useSettings();
  const { data, error, reload } = useApi<{ services: ServiceItem[] }>('/api/admin/services');
  const services = data?.services ?? null;
  const [editService, setEditService] = useState<ServiceItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = reload;

  async function remove() {
    if (!deleteId) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/services/${deleteId}`);
      toast.success('Service deleted');
      setDeleteId(null);
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
        title="Games & Services"
        subtitle="Extra controllers, tournaments, premium games — anything billable per session"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Service
          </Button>
        }
      />

      {error && !data ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : !services ? (
        <ListSkeleton rows={5} />
      ) : services.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-10 w-10" />}
          title="No services added yet"
          message="Add services staff can attach to running sessions."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Service</Button>}
        />
      ) : (
        <ul className="glass divide-y divide-border rounded-2xl shadow-card">
          {services.map((s) => (
            <li key={s.id} className={`flex items-center gap-3 px-4 py-3 ${!s.active ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{s.name}</p>
                {s.description && <p className="truncate text-xs text-muted">{s.description}</p>}
              </div>
              <span className="font-bold tabular-nums text-secondary">{formatMoney(s.price, sym)}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditService(s)} aria-label={`Edit ${s.name}`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)} aria-label={`Delete ${s.name}`}>
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ServiceModal
        open={addOpen || !!editService}
        service={editService}
        onClose={() => {
          setAddOpen(false);
          setEditService(null);
        }}
        onSaved={() => {
          load();
          setAddOpen(false);
          setEditService(null);
        }}
      />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete service?"
        message="Old invoices keep their snapshotted prices."
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </div>
  );
}

function ServiceModal({
  open, service, onClose, onSaved,
}: {
  open: boolean;
  service: ServiceItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', price: 50, billingType: 'FIXED', active: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (service) {
      setForm({
        name: service.name,
        description: service.description ?? '',
        price: service.price,
        billingType: service.billing_type,
        active: service.active,
      });
    } else {
      setForm({ name: '', description: '', price: 50, billingType: 'FIXED', active: true });
    }
  }, [service, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        billingType: form.billingType,
        active: form.active,
      };
      if (service) await api.patch(`/api/admin/services/${service.id}`, body);
      else await api.post('/api/admin/services', body);
      toast.success(service ? 'Service updated' : 'Service added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={service ? `Edit ${service.name}` : 'Add service'} size="md">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Extra Controller" />
        </Field>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price (₹)" required>
            <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required />
          </Field>
          <Field label="Billing type">
            <Select value={form.billingType} onChange={(e) => setForm({ ...form, billingType: e.target.value })}>
              <option value="FIXED">Fixed (per session)</option>
              <option value="PER_SESSION">Per session</option>
              <option value="HOURLY">Hourly</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{service ? 'Save changes' : 'Add service'}</Button>
        </div>
      </form>
    </Modal>
  );
}
