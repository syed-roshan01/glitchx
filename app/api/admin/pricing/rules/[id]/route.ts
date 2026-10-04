import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapPricingRule } from '@/lib/mappers';
import { pricingRuleSchema } from '@/lib/validations/schemas';

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

  const parsed = pricingRuleSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid rule');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.resourceId !== undefined) update.resource_id = input.resourceId ?? null;
  if (input.resourceType !== undefined)
    update.resource_type = input.resourceType ? input.resourceType.toUpperCase().replace(/\s+/g, '_') : null;
  if (input.daysOfWeek !== undefined) update.days_of_week = input.daysOfWeek;
  if (input.startTime !== undefined)
    update.start_time = input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime;
  if (input.endTime !== undefined)
    update.end_time = input.endTime.length === 5 ? `${input.endTime}:00` : input.endTime;
  if (input.price !== undefined) update.price = input.price;
  if (input.priority !== undefined) update.priority = input.priority;
  if (input.active !== undefined) update.active = input.active;

  const { data, error } = await admin
    .from('pricing_rules')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'pricing.rule_updated', 'pricing_rule', params.id, update);
  return NextResponse.json({ rule: mapPricingRule(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { error } = await admin.from('pricing_rules').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), 400);
  await audit(admin, userId, 'pricing.rule_deleted', 'pricing_rule', params.id);
  return NextResponse.json({ ok: true });
}
