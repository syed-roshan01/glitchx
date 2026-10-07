import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { ledgerEntrySchema } from '@/lib/validations/schemas';
import { mapLedgerEntry } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/** PATCH /api/admin/ledger/[id] — edit an entry */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }
  const parsed = ledgerEntrySchema
    .partial()
    .safeParse({ ...body, ...(body?.amount !== undefined ? { amount: Number(body.amount) } : {}) });
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid entry');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.entryType !== undefined) update.entry_type = input.entryType;
  if (input.category !== undefined) update.category = input.category;
  if (input.amount !== undefined) update.amount = input.amount;
  if (input.entryDate !== undefined) update.entry_date = input.entryDate;
  if (input.paymentMethod !== undefined) update.payment_method = input.paymentMethod ?? null;
  if (input.description !== undefined) update.description = input.description || null;
  if (Object.keys(update).length === 0) return jsonError('Nothing to update');

  const { data, error } = await admin
    .from('ledger_entries')
    .update(update)
    .eq('id', params.id)
    .select('*, profiles(name)')
    .single();
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));

  await audit(admin, userId, 'ledger.updated', 'ledger_entry', params.id, update);
  return NextResponse.json({ entry: mapLedgerEntry({ ...data, created_by_name: data.profiles?.name ?? null }) });
}

/** DELETE /api/admin/ledger/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { data: before } = await admin
    .from('ledger_entries')
    .select('entry_type, category, amount, entry_date')
    .eq('id', params.id)
    .maybeSingle();
  if (!before) return jsonError('Entry not found', 404);

  const { error } = await admin.from('ledger_entries').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));

  await audit(admin, userId, 'ledger.deleted', 'ledger_entry', params.id, before);
  return NextResponse.json({ ok: true });
}
