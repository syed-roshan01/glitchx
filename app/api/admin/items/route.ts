import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapMenuItem } from '@/lib/mappers';
import { itemSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin
    .from('items')
    .select('*')
    .order('category', { ascending: true })
    .order('name');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ items: (data ?? []).map(mapMenuItem) });
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

  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid item');

  const { data, error } = await admin
    .from('items')
    .insert({
      name: parsed.data.name,
      category: parsed.data.category,
      price: parsed.data.price,
      cost_price: parsed.data.costPrice ?? null,
      stock: parsed.data.stock ?? null,
      track_inventory: parsed.data.trackInventory,
      active: parsed.data.active,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'item.created', 'item', data.id, { name: data.name, price: data.price });
  return NextResponse.json({ item: mapMenuItem(data) });
}
