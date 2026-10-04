import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapWaitlist } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/** GET /api/admin/waitlist */
export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin
    .from('waitlist')
    .select('*, resources(name)')
    .in('status', ['WAITING', 'NOTIFIED'])
    .order('position');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ waitlist: (data ?? []).map(mapWaitlist) });
}

/** PATCH /api/admin/waitlist — { id, action: 'assign' | 'cancel' } */
export async function PATCH(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const id: string | undefined = body?.id;
  const action: string | undefined = body?.action;
  if (!id || (action !== 'assign' && action !== 'cancel')) {
    return jsonError('Unknown action');
  }

  const { data: entry, error: gerr } = await admin
    .from('waitlist')
    .select('*')
    .eq('id', id)
    .single();
  if (gerr || !entry) return jsonError('Waitlist entry not found', 404);
  if (entry.status !== 'WAITING' && entry.status !== 'NOTIFIED') {
    return jsonError('This entry is no longer waiting', 409);
  }

  if (action === 'cancel') {
    const { error } = await admin.from('waitlist').update({ status: 'CANCELLED' }).eq('id', id);
    if (error) return jsonError(friendlyError(error), 400);
    await audit(admin, userId, 'waitlist.cancelled', 'waitlist', id);
    return NextResponse.json({ ok: true });
  }

  // assign: find-or-create the customer so the admin can start a session instantly
  const { data: customerId, error: cerr } = await admin.rpc('admin_find_or_create_customer', {
    p_name: entry.customer_name,
    p_mobile: entry.customer_mobile,
    p_acting_user: userId,
  });
  if (cerr) return jsonError(friendlyError(cerr), 400);

  const { error } = await admin.from('waitlist').update({ status: 'ASSIGNED' }).eq('id', id);
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'waitlist.assigned', 'waitlist', id, { customerId });
  return NextResponse.json({
    ok: true,
    customerId,
    name: entry.customer_name,
    mobile: entry.customer_mobile,
    resourceId: entry.resource_id,
    resourceType: entry.resource_type,
    requestedDurationMinutes: entry.requested_duration_minutes,
  });
}
