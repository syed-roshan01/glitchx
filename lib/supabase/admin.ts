import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * SERVICE-ROLE client — bypasses RLS. SERVER ONLY.
 * Must never be imported into a client component; the key is read
 * from a non-public environment variable.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL environment variables'
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
  });
}
