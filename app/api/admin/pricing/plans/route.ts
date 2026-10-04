import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapPricingPlan } from '@/lib/mappers';
import { pricingPlanSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin
    .from('pricing_plans')
    .select('*')
    .order('resource_type')
    .order('price');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ plans: (data ?? []).map(mapPricingPlan) });
}

/** Core pricing — admin only. */
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

  const parsed = pricingPlanSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid plan');
  const input = parsed.data;

  if (input.billingType === 'PACKAGE' && !input.durationMinutes) {
    return jsonError('Package plans need a duration');
  }

  const { data, error } = await admin
    .from('pricing_plans')
    .insert({
      resource_type: input.resourceType.toUpperCase().replace(/\s+/g, '_'),
      name: input.name,
      billing_type: input.billingType,
      price: input.price,
      duration_minutes: input.durationMinutes ?? null,
      active: input.active,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'pricing.plan_created', 'pricing_plan', data.id, {
    name: input.name,
    price: input.price,
  });
  return NextResponse.json({ plan: mapPricingPlan(data) });
}
