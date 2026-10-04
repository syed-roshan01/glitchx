import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
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
