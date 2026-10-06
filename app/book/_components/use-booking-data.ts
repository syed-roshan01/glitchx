'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import type { AvailabilityRow } from '@/types';
import type { BusySlot, PublicSettings } from './types';
import { errorCode, getSupabase } from './api';
import { DAY } from './tz';

const POLL_MS = 30_000;
const SETTINGS_COLUMNS =
  'cafe_name, phone, address, timezone, currency_symbol, allow_public_bookings, waitlist_enabled, booking_max_days_ahead';

export interface BookingData {
  settings: PublicSettings | null;
  rows: AvailabilityRow[] | null;
  /** null when the busy-slots RPC is unavailable (status-based fallback) */
  busy: BusySlot[] | null;
  busySupported: boolean;
  /** last load failed (and we may be showing stale data) */
  error: string | null;
  online: boolean;
  now: number;
  refreshing: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads settings + availability + busy intervals, polls every 30s while the
 * tab is visible, and refetches on `resources` realtime changes (the only
 * table anon realtime can see).
 */
export function useBookingData(): BookingData {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [busy, setBusy] = useState<BusySlot[] | null>(null);
  const [busySupported, setBusySupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const busyMissing = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      setRefreshing(true);
      const supabase = getSupabase();
      // lazy-activate due sessions so availability is accurate (fire-and-forget)
      void Promise.resolve(supabase.rpc('activate_due_sessions')).then(undefined, () => {});
      const t = Date.now();
      try {
        const [avail, settingsRes, busyRes] = await Promise.all([
          supabase.rpc('public_get_availability'),
          supabase.from('settings').select(SETTINGS_COLUMNS).eq('id', 'default').maybeSingle(),
          busyMissing.current
            ? Promise.resolve(null)
            : supabase.rpc('public_get_busy_slots', {
                p_from: new Date(t - 12 * 60 * 60 * 1000).toISOString(),
                p_to: new Date(t + 32 * DAY).toISOString(),
              }),
        ]);

        if (avail.error) {
          setError(errorCode(avail.error) === 'NETWORK' ? 'offline' : 'Could not load live availability.');
        } else {
          setRows(((avail.data as AvailabilityRow[] | null) ?? []).map((r) => ({
            ...r,
            hourly_rate: r.hourly_rate == null ? null : Number(r.hourly_rate),
          })));
          setError(null);
        }
        if (settingsRes.data) setSettings(settingsRes.data as unknown as PublicSettings);

        if (busyRes) {
          if (busyRes.error) {
            // RPC not deployed yet (or failing) → status-based fallback
            if (errorCode(busyRes.error) === 'NOT_AVAILABLE') busyMissing.current = true;
            setBusy(null);
            setBusySupported(false);
          } else {
            setBusy((busyRes.data as BusySlot[] | null) ?? []);
            setBusySupported(true);
          }
        } else {
          setBusy(null);
          setBusySupported(false);
        }
      } catch {
        setError('offline');
      } finally {
        setNow(Date.now());
        setRefreshing(false);
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // poll while visible; refresh on focus / reconnect; tick the clock
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const onOnline = () => {
      setOnline(true);
      void load();
    };
    const onOffline = () => setOnline(false);
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [load]);

  const debounced = useDebouncedCallback(() => void load(), 500);
  useRealtime('resources', debounced);

  return { settings, rows, busy, busySupported, error, online, now, refreshing, reload: load };
}
