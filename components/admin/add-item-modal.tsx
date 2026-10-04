'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatMoney } from '@/lib/billing/format';
import type { MenuItem, SessionItem } from '@/types';
import { Search, Minus, Plus, PackageX } from 'lucide-react';

/** Searchable item picker with a quantity cart — prices come from
 *  the server, never the client. */
export function AddItemModal({
  sessionId,
  open,
  onClose,
  onAdded,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (items: SessionItem[]) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<{ items: MenuItem[] }>('/api/admin/items')
      .then((r) => setItems(r.items.filter((i) => i.active)))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const cartCount = Object.values(cart).reduce((s, n) => s + n, 0);
  const cartTotal = Object.entries(cart).reduce((s, [id, qty]) => {
    const item = items.find((i) => i.id === id);
    return s + (item ? item.price * qty : 0);
  }, 0);

  function bump(id: string, delta: number) {
    setCart((c) => {
      const next = Math.max(0, (c[id] ?? 0) + delta);
      const copy = { ...c };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  async function addAll() {
    setBusy(true);
    try {
      let latest: SessionItem[] = [];
      for (const [itemId, quantity] of Object.entries(cart)) {
        const src = items.find((i) => i.id === itemId);
        const itemType =
          src?.category === 'DRINK' ? 'DRINK' : src?.category === 'SNACK' || src?.category === 'FOOD' ? 'FOOD' : 'OTHER';
        const res = await api.post<{ items: SessionItem[] }>(`/api/admin/sessions/${sessionId}/items`, {
          itemType,
          catalogId: itemId,
          quantity,
        });
        latest = res.items;
      }
      toast.success(`${cartCount} item(s) added`);
      setCart({});
      onAdded(latest);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add food & drinks" size="lg">
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items…"
          className="pl-9"
          autoFocus
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading items…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
          <PackageX className="h-8 w-8 text-muted/50" aria-hidden />
          No items found. Add items under Items.
        </div>
      ) : (
        <ul className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2" role="listbox" aria-label="Items">
          {filtered.map((item) => {
            const inCart = cart[item.id] ?? 0;
            const out = item.track_inventory && item.stock !== null && item.stock <= 0;
            return (
              <li
                key={item.id}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                  inCart > 0 ? 'border-primary/50 bg-primary/10' : 'border-border bg-surface-2'
                } ${out ? 'opacity-40' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.name}</p>
                  <p className="text-xs text-muted">
                    {formatMoney(item.price)}
                    {item.track_inventory && item.stock !== null && ` · stock: ${item.stock}`}
                    {out && ' · out of stock'}
                  </p>
                </div>
                {out ? (
                  <span className="text-xs font-bold text-danger">OUT</span>
                ) : inCart > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => bump(item.id, -1)} className="rounded-lg bg-surface-3 p-1.5 hover:bg-border-strong" aria-label={`Remove one ${item.name}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-extrabold tabular-nums">{inCart}</span>
                    <button onClick={() => bump(item.id, 1)} className="rounded-lg bg-primary p-1.5 text-white hover:bg-primary/90" aria-label={`Add one ${item.name}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => bump(item.id, 1)} className="rounded-lg bg-primary/20 p-1.5 text-primary hover:bg-primary/30" aria-label={`Add ${item.name}`}>
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cartCount > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
          <span className="text-sm font-bold">
            {cartCount} item{cartCount > 1 ? 's' : ''} · {formatMoney(cartTotal)}
          </span>
          <Button onClick={addAll} loading={busy} size="sm">
            Add to session
          </Button>
        </div>
      )}
    </Modal>
  );
}
