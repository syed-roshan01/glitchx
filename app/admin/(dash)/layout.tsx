import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyIdentity, IDENTITY_HEADER } from '@/lib/auth/signed-identity';
import { mapSettings, mapProfile } from '@/lib/mappers';
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

  const admin = createAdminClient();
  const { data: settings } = await admin.from('settings').select('*').eq('id', 'default').single();

  return (
    <AdminShell profile={profile} settings={mapSettings(settings ?? {})}>
      {children}
    </AdminShell>
  );
}
