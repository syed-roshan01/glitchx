import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyIdentity, IDENTITY_HEADER } from '@/lib/auth/signed-identity';
import { mapProfile } from '@/lib/mappers';
import { getCachedSettings } from '@/lib/supabase/settings-cache';
import { AdminShell } from '@/components/admin/admin-shell';
import type { Profile } from '@/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Fast path: identity already verified+signed by the middleware — no auth
  // round-trips here, just the (cached-friendly) settings read.
  const claims = await verifyIdentity(headers().get(IDENTITY_HEADER));

  let profile: Profile | null = null;
  if (claims) {
    profile = {
      id: claims.sub,
      name: claims.name,
      email: null,
      role: claims.role,
      active: true,
      created_at: null,
    } as unknown as Profile;
  } else {
    // Fallback for requests that bypassed the middleware
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect('/admin/login');

    const admin = createAdminClient();
    const { data: row } = await admin.from('profiles').select('*').eq('id', user.id).single();
    if (!row || !row.active) redirect('/admin/login');
    profile = mapProfile(row);
  }

  // 30s per-instance cache — no DB round-trip on most navigations
  const settings = await getCachedSettings(createAdminClient());

  return (
    <AdminShell profile={profile} settings={settings}>
      {children}
    </AdminShell>
  );
}
