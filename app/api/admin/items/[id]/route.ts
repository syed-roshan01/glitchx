import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { mapMenuItem } from '@/lib/mappers';
import { itemSchema } from '@/lib/validations/schemas';

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

  const parsed = itemSchema.partial().safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid item');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.category !== undefined) update.category = input.category;
  if (input.price !== undefined) update.price = input.price;
  if (input.costPrice !== undefined) update.cost_price = input.costPrice ?? null;
  if (input.stock !== undefined) update.stock = input.stock ?? null;
  if (input.trackInventory !== undefined) update.track_inventory = input.trackInventory;
  if (input.active !== undefined) update.active = input.active;

  const { data: before } = await admin.from('items').select('price').eq('id', params.id).single();
  const { data, error } = await admin
    .from('items')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  if (input.price !== undefined && before && Number(before.price) !== input.price) {
    await audit(admin, userId, 'item.price_changed', 'item', params.id, {
      from: Number(before.price),
      to: input.price,
    });
  } else {
    await audit(admin, userId, 'item.updated', 'item', params.id, update);
  }
  return NextResponse.json({ item: mapMenuItem(data) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { error } = await admin.from('items').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));
  await audit(admin, userId, 'item.deleted', 'item', params.id);
  return NextResponse.json({ ok: true });
}
