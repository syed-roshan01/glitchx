import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapSessionItem } from '@/lib/mappers';
import { addSessionItemSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** POST /api/admin/sessions/[id]/items — add an item or service.
 *  Prices are snapshotted server-side from the catalog; the client
 *  never sends a price. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = addSessionItemSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid item');

  const { itemType, catalogId, quantity } = parsed.data;

  const { data: line, error } = await admin.rpc('admin_add_session_item', {
    p_session_id: params.id,
    p_item_type: itemType,
    p_catalog_id: catalogId,
    p_quantity: quantity,
    p_acting_user: userId,
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'session.item_added', 'session', params.id, {
    itemType,
    catalogId,
    quantity,
    name: line?.name,
  });

  // return the full refreshed list for the session
  const { data: items } = await admin
    .from('session_items')
    .select('*')
    .eq('session_id', params.id)
    .order('created_at');

  return NextResponse.json({ line, items: (items ?? []).map(mapSessionItem) });
}
