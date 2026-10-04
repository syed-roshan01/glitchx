import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapServiceItem } from '@/lib/mappers';
import { serviceSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin.from('services').select('*').order('name');
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ services: (data ?? []).map(mapServiceItem) });
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

  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid service');

  const { data, error } = await admin
    .from('services')
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      price: parsed.data.price,
      billing_type: parsed.data.billingType,
      active: parsed.data.active,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'service.created', 'service', data.id, { name: data.name });
  return NextResponse.json({ service: mapServiceItem(data) });
}
