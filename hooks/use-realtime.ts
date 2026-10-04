'use client';

import { useEffect, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/**
 * Subscribes to Postgres changes on a table and invokes `onChange`
 * (debounced) so pages can refetch. Subscriptions are always cleaned
 * up on unmount.
 */
export function useRealtime(
  table: string,
  onChange: () => void,
  opts?: { filter?: string; enabled?: boolean }
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const filter = opts?.filter;
  const enabled = opts?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const client = createBrowserSupabaseClient();
    const channel = client
      .channel(`rt-${table}-${filter ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => cbRef.current()
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}

/** Debounced callback (used to coalesce realtime refetch storms). */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs = 400) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (...args: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delayMs);
  };
}
