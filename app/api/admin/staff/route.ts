import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, audit } from '@/lib/supabase/api';
import { mapProfile } from '@/lib/mappers';
import { staffCreateSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/admin/staff — list users (admin only) */
export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return jsonError('Could not load staff', 400);
  return NextResponse.json({ staff: (data ?? []).map(mapProfile) });
}

/** POST /api/admin/staff — create a staff/admin account (admin only) */
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId, profile } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = staffCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid staff details');
  const input = parsed.data;

  // prevent demoting yourself into a lockout: last active admin safeguard
  if (input.role !== 'ADMIN' && profile.role === 'ADMIN') {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
      .eq('active', true);
    if ((count ?? 0) <= 1) {
      return jsonError('You need at least one other active admin before creating non-admin staff.', 409);
    }
  }

  const { data: authUser, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (createError) {
    const msg = createError.message ?? '';
    if (msg.toLowerCase().includes('already')) {
      return jsonError('A user with this email already exists', 409);
    }
    return jsonError(`Could not create the account: ${msg}`, 400);
  }

  // handle_new_user trigger creates the profile as STAFF; set the real role
  if (authUser.user) {
    const { error: roleError } = await admin
      .from('profiles')
      .update({ role: input.role, name: input.name, email: input.email })
      .eq('id', authUser.user.id);
    if (roleError) return jsonError('Account created but role assignment failed', 500);

    await audit(admin, userId, 'staff.created', 'profile', authUser.user.id, {
      email: input.email,
      role: input.role,
    });
  }

  return NextResponse.json({ id: authUser.user?.id });
}
