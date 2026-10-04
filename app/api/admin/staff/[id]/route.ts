import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, audit } from '@/lib/supabase/api';
import { mapProfile } from '@/lib/mappers';
import { staffUpdateSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** PATCH /api/admin/staff/[id] — change role / active / name */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId, profile } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = staffUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid update');
  const input = parsed.data;

  // safety: never deactivate or demote yourself or the last admin
  if (params.id === userId) {
    if (input.active === false || (input.role && input.role !== 'ADMIN')) {
      return jsonError('You cannot demote or deactivate your own account.', 409);
    }
  }

  const target = (await admin.from('profiles').select('*').eq('id', params.id).single()).data;
  if (!target) return jsonError('Staff member not found', 404);

  if (target.role === 'ADMIN' && (input.role !== undefined && input.role !== 'ADMIN' || input.active === false)) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
      .eq('active', true);
    if ((count ?? 0) <= 1) {
      return jsonError('Cannot remove the last active admin.', 409);
    }
  }

  const update: Record<string, unknown> = {};
  if (input.role !== undefined) update.role = input.role;
  if (input.active !== undefined) update.active = input.active;
  if (input.name !== undefined) update.name = input.name;

  const { data, error } = await admin
    .from('profiles')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError('Could not update the staff member', 400);

  await audit(admin, userId, 'staff.updated', 'profile', params.id, update);
  return NextResponse.json({ profile: mapProfile(data) });
}
