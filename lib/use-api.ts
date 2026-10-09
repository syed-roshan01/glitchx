'use client';

// ============================================================
// Tiny stale-while-revalidate cache for admin API GETs.
//
// Revisiting a page renders the last response instantly while a
// fresh copy loads in the background; identical in-flight requests
// are de-duplicated. Mutations call `invalidate()` (or `reload`) so
// every mounted consumer refetches.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';

interface Entry {
  data?: unknown;
  error?: Error;
  at: number;
  inflight?: Promise<unknown>;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function fetchKey(key: string): Promise<unknown> {
  const entry = cache.get(key) ?? { at: 0 };
  if (entry.inflight) return entry.inflight;
  const p = api
    .get<unknown>(key)
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
      notify(key);
      return data;
    })
    .catch((error: Error) => {
      cache.set(key, { data: entry.data, error, at: entry.at });
      notify(key);
      throw error;
    });
  cache.set(key, { ...entry, inflight: p });
  return p;
}

/** Warm the cache (e.g. on link hover / idle). Errors are ignored. */
export function prefetch(key: string, maxAgeMs = 15_000) {
  const e = cache.get(key);
  if (e && (e.inflight || Date.now() - e.at < maxAgeMs)) return;
  fetchKey(key).catch(() => {});
}

/** Seed the cache with a partial/optimistic value. The next `useApi`
 * mount still refetches, so this only removes the initial spinner. */
export function seed(key: string, data: unknown) {
  cache.set(key, { data, at: Date.now() });
  notify(key);
}

/** Refetch every cached key starting with `prefix` (default: all). */
export function invalidate(prefix = '/api/admin') {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) {
      if (listeners.get(key)?.size) fetchKey(key).catch(() => {});
      else cache.delete(key);
    }
  }
}

export interface UseApiResult<T> {
  data: T | undefined;
  error: Error | undefined;
  /** true only when there is no data yet (first load) */
  loading: boolean;
  /** true while any request for this key is running */
  validating: boolean;
  reload: () => Promise<void>;
  /** optimistic local update of the cached value */
  mutate: (updater: (prev: T | undefined) => T | undefined) => void;
}

/**
 * `useApi('/api/admin/bookings?…')` — pass `null` to skip.
 * Data from the cache is returned synchronously on mount.
 */
export function useApi<T>(key: string | null): UseApiResult<T> {
  const [, force] = useState(0);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!key) return;
    const rerender = () => force((n) => n + 1);
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(rerender);
    fetchKey(key).catch(() => {});
    return () => {
      set!.delete(rerender);
    };
  }, [key]);

  const entry = key ? cache.get(key) : undefined;

  const reload = useCallback(async () => {
    const k = keyRef.current;
    if (!k) return;
    try {
      await fetchKey(k);
    } catch {
      /* surfaced via `error` */
    }
  }, []);

  const mutate = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    const k = keyRef.current;
    if (!k) return;
    const e = cache.get(k) ?? { at: Date.now() };
    cache.set(k, { ...e, data: updater(e.data as T | undefined) });
    notify(k);
  }, []);

  return {
    data: entry?.data as T | undefined,
    error: entry?.data === undefined ? entry?.error : undefined,
    loading: !!key && entry?.data === undefined && !entry?.error,
    validating: !!entry?.inflight,
    reload,
    mutate,
  };
}
