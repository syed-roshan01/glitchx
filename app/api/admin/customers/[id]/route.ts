import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { customerUpdateSchema } from '@/lib/validations/schemas';
import { mapCustomer, mapSession, mapInvoice } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/** GET /api/admin/customers/[id] — profile + stats + history */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data: customer, error } = await admin
    .from('customers')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !customer) return jsonError('Customer not found', 404);

  const [sessionsRes, invoicesRes] = await Promise.all([
    admin
      .from('sessions')
      .select('*, resources(name, type)')
      .eq('customer_id', params.id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('invoices')
      .select('*')
      .eq('customer_id', params.id)
      .order('issued_at', { ascending: false })
      .limit(50),
  ]);

  const sessions = (sessionsRes.data ?? []).map((r: any) =>
    mapSession({ ...r, resource_name: r.resources?.name, resource_type: r.resources?.type })
  );
  const invoices = (invoicesRes.data ?? []).map(mapInvoice);

  const totalSpent = invoices
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + i.total_amount, 0);
  const completed = sessions.filter((s) => s.status === 'COMPLETED');
  const lastVisit = sessions.find((s) => s.actual_start_time)?.actual_start_time ?? null;

  // favorite resource = most frequently used
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const name = s.resource_name ?? 'Unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const favorite =
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return NextResponse.json({
    customer: mapCustomer(customer),
    stats: {
      total_sessions: sessions.length,
      total_spent: Math.round(totalSpent * 100) / 100,
      last_visit: lastVisit,
      favorite_resource: favorite,
    },
    sessions,
    invoices,
  });
}

/** PATCH /api/admin/customers/[id] */
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

  const parsed = customerUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid customer');
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.mobile !== undefined) update.mobile = input.mobile;
  if (input.email !== undefined) update.email = input.email || null;
  if (input.notes !== undefined) update.notes = input.notes || null;

  if (Object.keys(update).length === 0) return jsonError('Nothing to update');

  const { data, error } = await admin
    .from('customers')
    .update(update)
    .eq('id', params.id)
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));

  await audit(admin, userId, 'customer.updated', 'customer', params.id, update);
  return NextResponse.json({ customer: mapCustomer(data) });
}

/** DELETE /api/admin/customers/[id] — admin only */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  // check for sessions — customers with history cannot be deleted
  const { count } = await admin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', params.id);
  if ((count ?? 0) > 0) {
    return jsonError(
      'This customer has session history and cannot be deleted (records must be preserved).',
      409
    );
  }

  const { error } = await admin.from('customers').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));

  await audit(admin, userId, 'customer.deleted', 'customer', params.id);
  return NextResponse.json({ ok: true });
}
