// ============================================================
// Next.js patches global fetch and CACHES GET responses in the
// data cache. Supabase-js calls that global fetch without a
// cache option, so query results inside API routes silently
// froze at their first execution (frozen queues, "timer doesn't
// run", stale sessions). Every Supabase client must therefore use
// this fetch wrapper: same fetch, but never cached.
// ============================================================

export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });
