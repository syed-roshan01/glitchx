import type { SupabaseClient } from '@supabase/supabase-js';
import { mapSettings } from '@/lib/mappers';
import type { CafeSettings } from '@/types';

/**
 * Per-instance settings cache. Settings are read on nearly every admin page
 * (currency, timezone, tax …) but change rarely — caching them removes a
 * network round-trip from every dashboard/report load.
 *
 * `invalidateCachedSettings()` is called by the settings PUT route so changes
 * apply immediately. Warm serverless instances share the cache across
 * requests.
 */

interface CacheEntry {
  settings: CafeSettings;
  exp: number;
}

let cache: CacheEntry | null = null;
const TTL_MS = 30_000;

export async function getCachedSettings(admin: SupabaseClient): Promise<CafeSettings> {
  if (cache && cache.exp > Date.now()) return cache.settings;
  const { data } = await admin.from('settings').select('*').eq('id', 'default').single();
  const settings = mapSettings(data ?? {});
  cache = { settings, exp: Date.now() + TTL_MS };
  return settings;
}

export function invalidateCachedSettings() {
  cache = null;
}
