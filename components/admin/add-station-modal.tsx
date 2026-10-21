'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import type { CafeSettings, Resource, Session } from '@/types';
import { Plus, MonitorPlay } from 'lucide-react';

/** Add another station (pool, PS5 …) to this running bill — one invoice
 *  at the end, but every station keeps its own timer and rate. */
export function AddStationModal({
  session,
  settings,
  open,
  onClose,
  onAdded,
}: {
  session: Session;
  settings: CafeSettings;
  open: boolean;
  onClose: () => void;
  onAdded: (newSessionId: string) => void;
}) {
  const toast = useToast();
  const { data: resources, reload } = useApi<Resource[]>(open ? '/api/admin/resources' : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);

  const taken = useMemo(() => {
    const ids = new Set<string>();
    if (session.resource_id) ids.add(session.resource_id);
    return ids;
  }, [session.resource_id]);

  const available = (resources ?? []).filter((r) => r.active && r.current_status !== 'MAINTENANCE');
  const chosen = available.find((r) => r.id === selected) ?? null;
  const sym = settings.currency_symbol || '₹';

  async function add() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; sessionId: string }>(
        `/api/admin/sessions/${session.id}/add-station`,
        {
          resourceId: selected,
          ...(minutes.trim() ? { expectedMinutes: Number(minutes) } : {}),
        }
      );
      toast.success(`${chosen?.name ?? 'Station'} added to the bill`);
      onAdded(res.sessionId);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a station to this bill"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button className="h-10 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-surface-2" onClick={onClose}>
            Cancel
          </button>
          <Button variant="success" loading={busy} disabled={!selected} onClick={add}>
            <Plus className="h-4 w-4" /> Add to bill
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          A friend joins on another station? Add it here — each station keeps its own timer and rate,
          and everything lands on <strong>one invoice</strong> when you end the session.
        </p>

        {available.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No stations available right now</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {available.map((r) => {
              const isTaken = taken.has(r.id);
              const busyStation = r.current_status === 'BUSY';
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={busyStation || isTaken}
                  onClick={() => setSelected(r.id)}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                    selected === r.id
                      ? 'border-primary bg-primary/15'
                      : busyStation || isTaken
                        ? 'border-border bg-surface-2/40 opacity-50'
                        : 'border-border bg-surface-2 hover:border-primary/40'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <MonitorPlay className="h-4 w-4" /> {r.name}
                  </span>
                  <span className="text-xs text-muted">
                    {busyStation ? 'Occupied' : isTaken ? 'On this bill' : 'Available'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <Field label="Planned time (optional, minutes)">
          <Input
            type="number"
            min={5}
            max={1440}
            placeholder="e.g. 60"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
