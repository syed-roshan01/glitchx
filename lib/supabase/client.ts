import { createBrowserClient } from '@supabase/ssr';

/** Browser (anon) Supabase client — used by the public booking page
 *  and for realtime subscriptions. RLS applies. */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
