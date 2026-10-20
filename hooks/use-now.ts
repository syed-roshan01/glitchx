'use client';

import { useEffect, useState } from 'react';
import { serverNow } from '@/lib/api-client';

/** Ticking clock anchored to the SERVER clock (via the API `Date`
 *  headers), so the live timer is correct even if the PC clock is
 *  wrong. Returns null on the server/first paint to avoid hydration
 *  mismatches; DB timestamps remain the source of truth. */
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(serverNow());
    tick();
    const id = setInterval(tick, intervalMs);
    // background tabs throttle intervals — snap correct the moment the
    // tab is visible again instead of appearing frozen
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [intervalMs]);
  return now;
}
