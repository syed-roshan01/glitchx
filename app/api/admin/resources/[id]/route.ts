import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapResource } from '@/lib/mappers';
import { resourceSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = resourceSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid resource');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.type !== undefined) update.type = input.type.toUpperCase().replace(/\s+/g, '_');
  if (input.description !== undefined) update.description = input.description ?? null;
  if (input.status !== undefined) update.status = input.status;
  if (input.defaultPricingPlanId !== undefined) update.default_pricing_plan_id = input.defaultPricingPlanId ?? null;
  if (input.active !== undefined) update.active = input.active;

  // safety: a resource with a live session cannot go to maintenance
  if (input.status === 'MAINTENANCE') {
    const { count } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('resource_id', params.id)
      .in('status', ['ACTIVE', 'PAUSED']);
    if ((count ?? 0) > 0) {
      return jsonError('End the active session before setting maintenance.', 409);
    }
  }

  const { data, error } = await admin
    .from('resources')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'resource.updated', 'resource', params.id, update);
  return NextResponse.json({ resource: mapResource(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { count } = await admin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('resource_id', params.id);
  if ((count ?? 0) > 0) {
    return jsonError(
      'This resource has session history — disable it instead of deleting.',
      409
    );
  }

  const { error } = await admin.from('resources').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'resource.deleted', 'resource', params.id);
  return NextResponse.json({ ok: true });
}
