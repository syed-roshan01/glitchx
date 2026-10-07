import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, dbErrorStatus } from '@/lib/supabase/api';
import { mapInvoice, mapInvoiceItem, mapPayment, mapSettings } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/** GET /api/admin/invoices/[id] — invoice + items + payments + settings */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data: invoice, error } = await admin
    .from('invoices')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !invoice) return jsonError('Invoice not found', 404);

  const [itemsRes, paymentsRes, settingsRes] = await Promise.all([
    admin.from('invoice_items').select('*').eq('invoice_id', params.id).order('sort_order'),
    admin.from('payments').select('*').eq('invoice_id', params.id).order('created_at'),
    admin.from('settings').select('*').eq('id', 'default').single(),
  ]);

  return NextResponse.json({
    invoice: mapInvoice(invoice),
    items: (itemsRes.data ?? []).map(mapInvoiceItem),
    payments: (paymentsRes.data ?? []).map(mapPayment),
    settings: mapSettings(settingsRes.data ?? {}),
  });
}

/** DELETE /api/admin/invoices/[id] — permanently delete an invoice, its lines
 *  and payments (ADMIN only). The session record itself is kept. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { data: inv } = await admin
    .from('invoices')
    .select('id, invoice_number, total_amount, customer_name, session_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!inv) return jsonError('Invoice not found', 404);

  // invoice_items + payments cascade with the invoice
  const { error } = await admin.from('invoices').delete().eq('id', params.id);
  if (error) return jsonError(friendlyError(error), dbErrorStatus(error));

  if (inv.session_id) {
    await admin.from('sessions').update({ payment_status: 'PENDING' }).eq('id', inv.session_id);
  }

  await audit(admin, userId, 'invoice.deleted', 'invoice', params.id, {
    invoiceNumber: inv.invoice_number,
    total: Number(inv.total_amount),
    customer: inv.customer_name,
  });
  return NextResponse.json({ ok: true });
}
