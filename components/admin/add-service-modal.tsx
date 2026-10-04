'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatMoney } from '@/lib/billing/format';
import type { ServiceItem, SessionItem } from '@/types';
import { Plus, Sparkles } from 'lucide-react';

/** Add additional games/services to an active session. */
export function AddServiceModal({
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
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<{ services: ServiceItem[] }>('/api/admin/services')
      .then((r) => setServices(r.services.filter((s) => s.active)))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(service: ServiceItem) {
    setBusyId(service.id);
    try {
      const res = await api.post<{ items: SessionItem[] }>(`/api/admin/sessions/${sessionId}/items`, {
        itemType: 'SERVICE',
        catalogId: service.id,
        quantity: 1,
      });
      toast.success(`${service.name} added`);
      onAdded(res.items);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add game / service" size="md">
      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading services…</p>
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
          <Sparkles className="h-8 w-8 text-muted/50" aria-hidden />
          No services configured yet. Add them under Games &amp; Services.
        </div>
      ) : (
        <ul className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{s.name}</p>
                {s.description && <p className="truncate text-xs text-muted">{s.description}</p>}
                <p className="text-xs font-semibold text-secondary">{formatMoney(s.price)}</p>
              </div>
              <Button size="sm" variant="secondary" loading={busyId === s.id} onClick={() => add(s)} aria-label={`Add ${s.name}`}>
                <Plus className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
