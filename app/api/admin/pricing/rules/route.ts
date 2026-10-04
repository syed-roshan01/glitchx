import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapPricingRule } from '@/lib/mappers';
import { pricingRuleSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin.from('pricing_rules').select('*').order('name');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ rules: (data ?? []).map(mapPricingRule) });
}

export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = pricingRuleSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid rule');
  const input = parsed.data;

  if (input.startTime >= input.endTime) {
    return jsonError('End time must be after start time');
  }

  const { data, error } = await admin
    .from('pricing_rules')
    .insert({
      name: input.name,
      resource_id: input.resourceId ?? null,
      resource_type: input.resourceType ? input.resourceType.toUpperCase().replace(/\s+/g, '_') : null,
      days_of_week: input.daysOfWeek,
      start_time: input.startTime.length === 5 ? `${input.startTime}:00` : input.startTime,
      end_time: input.endTime.length === 5 ? `${input.endTime}:00` : input.endTime,
      price: input.price,
      priority: input.priority,
      active: input.active,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'pricing.rule_created', 'pricing_rule', data.id, { name: input.name });
  return NextResponse.json({ rule: mapPricingRule(data) });
}
