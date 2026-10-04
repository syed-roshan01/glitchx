'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { PageHeader, EmptyState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/billing/format';
import type { CafeSettings, MenuItem } from '@/types';
import { CupSoda, Plus, Pencil, Trash2 } from 'lucide-react';

const CATEGORIES = ['DRINK', 'SNACK', 'FOOD', 'OTHER'] as const;

export default function ItemsPage() {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [settings, setSettings] = useState<CafeSettings | null>(null);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        api.get<{ items: MenuItem[] }>('/api/admin/items'),
        api.get<{ settings: CafeSettings }>('/api/admin/dashboard'),
      ]);
      setItems(i.items);
      setSettings(s.settings);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    if (!deleteId) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/items/${deleteId}`);
      toast.success('Item deleted');
      setDeleteId(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const sym = settings?.currency_symbol || 'â‚¹';
  const grouped = CATEGORIES.map((c) => ({
    category: c,
    items: (items ?? []).filter((i) => i.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Items â€” Food & Drinks"
        subtitle="Menu prices are snapshotted onto each bill, so old invoices never change"
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
        }
      />

      {!items ? (
        <ListSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CupSoda className="h-10 w-10" />}
          title="No items added yet"
          message="Add drinks and snacks staff can attach to running sessions."
          action={<Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Item</Button>}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, items: catItems }) => (
            <section key={category} aria-label={category}>
              <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wider text-muted">
                {category === 'DRINK' ? 'Drinks' : category === 'SNACK' ? 'Snacks' : category === 'FOOD' ? 'Food' : 'Other'}
              </h2>
              <ul className="glass divide-y divide-border rounded-2xl shadow-card">
                {catItems.map((item) => (
                  <li key={item.id} className={`flex items-center gap-3 px-4 py-3 ${!item.active ? 'opacity-50' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{item.name}</p>
                      <p className="text-xs text-muted">
                        {item.track_inventory && item.stock !== null
                          ? `Stock: ${item.stock}${item.stock <= 5 ? ' âš  low' : ''}`
                          : 'No inventory tracking'}
                      </p>
                    </div>
                    <span className="font-bold tabular-nums text-secondary">{formatMoney(item.price, sym)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setEditItem(item)} aria-label={`Edit ${item.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteId(item.id)} aria-label={`Delete ${item.name}`}>
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ItemModal
        open={addOpen || !!editItem}
        item={editItem}
        onClose={() => {
          setAddOpen(false);
          setEditItem(null);
        }}
        onSaved={() => {
          load();
          setAddOpen(false);
          setEditItem(null);
        }}
      />
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Delete item?"
        message="Old invoices keep their snapshotted prices. This only removes the item from new orders."
        confirmLabel="Delete"
        danger
        loading={busy}
      />
    </div>
  );
}

function ItemModal({
  open, item, onClose, onSaved,
}: {
  open: boolean;
  item: MenuItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '', category: 'DRINK', price: 40, costPrice: '', stock: '',
    trackInventory: false, active: true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name,
        category: item.category,
        price: item.price,
        costPrice: item.cost_price?.toString() ?? '',
        stock: item.stock?.toString() ?? '',
        trackInventory: item.track_inventory,
        active: item.active,
      });
    } else {
      setForm({ name: '', category: 'DRINK', price: 40, costPrice: '', stock: '', trackInventory: false, active: true });
    }
  }, [item, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        category: form.category,
        price: Number(form.price),
        costPrice: form.costPrice ? Number(form.costPrice) : null,
        stock: form.stock ? Number(form.stock) : form.trackInventory ? 0 : null,
        trackInventory: form.trackInventory,
        active: form.active,
      };
      if (item) await api.patch(`/api/admin/items/${item.id}`, body);
      else await api.post('/api/admin/items', body);
      toast.success(item ? 'Item updated' : 'Item added');
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={item ? `Edit ${item.name}` : 'Add item'} size="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Coke" />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as any })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Selling price (â‚¹)" required>
            <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required />
          </Field>
          <Field label="Cost price (optional)">
            <Input type="number" min={0} step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} placeholder="For margin reports" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.trackInventory} onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })} className="h-4 w-4 accent-primary" />
          Track inventory (decrement stock on every order)
        </label>
        {form.trackInventory && (
          <Field label="Current stock">
            <Input type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="0" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
          Available for ordering
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{item ? 'Save changes' : 'Add item'}</Button>
        </div>
      </form>
    </Modal>
  );
}
