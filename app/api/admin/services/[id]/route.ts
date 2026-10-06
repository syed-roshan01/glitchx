import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { mapServiceItem } from '@/lib/mappers';
import { serviceSchema } from '@/lib/validations/schemas';

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

  const parsed = serviceSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid service');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description ?? null;
  if (input.price !== undefined) update.price = input.price;
  if (input.billingType !== undefined) update.billing_type = input.billingType;
  if (input.active !== undefined) update.active = input.active;

  const { data, error } = await admin
    .from('services')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'service.updated', 'service', params.id, update);
  return NextResponse.json({ service: mapServiceItem(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { error } = await admin.from('services').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));
  await audit(admin, userId, 'service.deleted', 'service', params.id);
  return NextResponse.json({ ok: true });
}
