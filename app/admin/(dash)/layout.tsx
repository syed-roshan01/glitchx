import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapSettings, mapProfile } from '@/lib/mappers';
import { AdminShell } from '@/components/admin/admin-shell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/admin/login');

  const admin = createAdminClient();
  const [{ data: profile }, { data: settings }] = await Promise.all([
    admin.from('profiles').select('*').eq('id', user.id).single(),
    admin.from('settings').select('*').eq('id', 'default').single(),
  ]);

  if (!profile || !profile.active) redirect('/admin/login');

  return (
    <AdminShell profile={mapProfile(profile)} settings={mapSettings(settings ?? {})}>
      {children}
    </AdminShell>
  );
}
