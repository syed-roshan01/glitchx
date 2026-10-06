import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, pageParams } from '@/lib/supabase/api';
import { mapSession } from '@/lib/mappers';
import { startSessionSchema, quickCustomerSchema } from '@/lib/validations/schemas';
import { toIsoOrNull } from '@/lib/utils/misc';

export const dynamic = 'force-dynamic';

/** GET /api/admin/sessions?status=&limit=&offset=&customerId= */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const { limit, offset } = pageParams(req, 50, 200);
  const customerId = params.get('customerId');

  let query = admin
    .from('sessions')
    .select('*, customers(name, mobile), resources(name, type)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status === 'live') query = query.in('status', ['ACTIVE', 'PAUSED']);
  else if (status === 'scheduled') query = query.eq('status', 'SCHEDULED');
  else if (status === 'completed') query = query.eq('status', 'COMPLETED');
  else if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);

  const { data, error, count } = await query;
  if (error) return jsonError(friendlyError(error), 400);

  const sessions = (data ?? []).map((r: any) =>
    mapSession({
      ...r,
      customer_name: r.customers?.name,
      customer_mobile: r.customers?.mobile,
      resource_name: r.resources?.name,
      resource_type: r.resources?.type,
    })
  );

  // items for live sessions (bill preview)
  const liveIds = sessions.filter((s) => s.status === 'ACTIVE' || s.status === 'PAUSED').map((s) => s.id);
  const itemsRes = liveIds.length
    ? await admin.from('session_items').select('*').in('session_id', liveIds).order('created_at')
    : { data: [] };

  return NextResponse.json({
    sessions,
    items: itemsRes.data ?? [],
    total: count ?? 0,
  });
}

/** POST /api/admin/sessions — start a session (walk-in or scheduled).
 *  Body: { customerId } OR { newCustomer: {name, mobile, email?} },
 *        resourceId, pricingPlanId, startTime?, expectedMinutes?, bookingId?, notes? */
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  let customerId: string | null = body?.customerId ?? null;

  // quick walk-in customer creation (same request for a <15s flow)
  if (!customerId && body?.newCustomer) {
    const parsed = quickCustomerSchema.safeParse(body.newCustomer);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? 'Invalid customer details');
    }
    const { data: cid, error: cerr } = await admin.rpc('admin_find_or_create_customer', {
      p_name: parsed.data.name,
      p_mobile: parsed.data.mobile,
      p_email: parsed.data.email || null,
      p_acting_user: userId,
    });
    if (cerr) return jsonError(friendlyError(cerr), 400);
    customerId = cid;
  }

  const parsedInput = startSessionSchema.safeParse({ ...body, customerId });
  if (!parsedInput.success) {
    return jsonError(parsedInput.error.issues[0]?.message ?? 'Invalid session details');
  }
  const input = parsedInput.data;

  const startTime =
    input.startTime && input.startTime !== 'now'
      ? toIsoOrNull(input.startTime) ?? new Date().toISOString()
      : new Date().toISOString();

  const { data: sessionId, error } = await admin.rpc('admin_start_session', {
    p_customer_id: input.customerId,
    p_resource_id: input.resourceId,
    p_pricing_plan_id: input.pricingPlanId,
    p_start_time: startTime,
    p_expected_minutes: input.expectedMinutes ?? null,
    p_booking_id: input.bookingId ?? null,
    p_notes: input.notes ?? null,
    p_acting_user: userId,
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'session.started', 'session', sessionId, {
    resourceId: input.resourceId,
    via: body?.newCustomer ? 'quick-create' : 'existing-customer',
    scheduled: new Date(startTime) > new Date(Date.now() + 60_000),
  });

  return NextResponse.json({ id: sessionId });
}
