import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { mapPricingPlan } from '@/lib/mappers';
import { pricingPlanSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = pricingPlanSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid plan');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.resourceType !== undefined) update.resource_type = input.resourceType.toUpperCase().replace(/\s+/g, '_');
  if (input.name !== undefined) update.name = input.name;
  if (input.billingType !== undefined) update.billing_type = input.billingType;
  if (input.price !== undefined) update.price = input.price;
  if (input.durationMinutes !== undefined) update.duration_minutes = input.durationMinutes ?? null;
  if (input.active !== undefined) update.active = input.active;

  const { data: before } = await admin
    .from('pricing_plans')
    .select('price, billing_type, duration_minutes')
    .eq('id', params.id)
    .single();
  if (!before) return jsonError('Plan not found', 404);

  // validate against the RESULTING plan, not just the patch
  const nextType = input.billingType ?? before.billing_type;
  const nextDuration =
    input.durationMinutes !== undefined ? input.durationMinutes ?? null : before.duration_minutes;
  if (nextType === 'PACKAGE' && !nextDuration) {
    return jsonError('Package plans need a duration');
  }
  const { data, error } = await admin
    .from('pricing_plans')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  if (input.price !== undefined && before && Number(before.price) !== input.price) {
    await audit(admin, userId, 'pricing.plan_price_changed', 'pricing_plan', params.id, {
      from: Number(before.price),
      to: input.price,
      name: input.name ?? data?.name,
    });
  } else {
    await audit(admin, userId, 'pricing.plan_updated', 'pricing_plan', params.id, update);
  }
  return NextResponse.json({ plan: mapPricingPlan(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { error } = await admin.from('pricing_plans').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));
  await audit(admin, userId, 'pricing.plan_deleted', 'pricing_plan', params.id);
  return NextResponse.json({ ok: true });
}
