import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';

export const dynamic = 'force-dynamic';

/** POST /api/admin/sessions/[id]/add-station — add another station
 *  (pool, PS5 …) to this running bill. The new station gets its own
 *  timer and plan; checkout creates ONE invoice for all of them. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }
  const resourceId = String(body?.resourceId ?? '');
  if (!resourceId) return jsonError('resourceId required');

  const { data, error } = await admin.rpc('admin_add_station', {
    p_parent_id: params.id,
    p_resource_id: resourceId,
    p_pricing_plan_id: body?.pricingPlanId ?? null,
    p_expected_minutes: body?.expectedMinutes ?? null,
    p_custom_price: body?.customPrice ?? null,
    p_acting_user: userId,
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'session.station_added', 'session', params.id, {
    newSessionId: data,
    resourceId,
  });
  return NextResponse.json({ ok: true, sessionId: data });
}
