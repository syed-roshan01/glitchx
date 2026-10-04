'use client';

import { useEffect, useRef, useState } from 'react';

/** Ticking clock. Returns null on the server/first paint to avoid
 *  hydration mismatches; DB timestamps remain the source of truth. */
export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
