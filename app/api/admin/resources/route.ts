import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapResource } from '@/lib/mappers';
import { resourceSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin.from('resources').select('*').order('name');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ resources: (data ?? []).map(mapResource) });
}

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

  const parsed = resourceSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid resource');

  const { data, error } = await admin
    .from('resources')
    .insert({
      name: parsed.data.name,
      type: parsed.data.type.toUpperCase().replace(/\s+/g, '_'),
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      default_pricing_plan_id: parsed.data.defaultPricingPlanId ?? null,
      active: parsed.data.active,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'resource.created', 'resource', data.id, { name: data.name });
  return NextResponse.json({ resource: mapResource(data) });
}
