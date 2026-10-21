import { createBrowserClient } from '@supabase/ssr';
import { noStoreFetch } from './no-store-fetch';

/** Browser (anon) Supabase client — used by the public booking page
 *  and for realtime subscriptions. RLS applies. */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: noStoreFetch } }
  );
}
