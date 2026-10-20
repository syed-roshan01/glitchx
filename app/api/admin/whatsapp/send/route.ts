import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** POST /api/admin/whatsapp/send — manually queue one invoice for
 *  WhatsApp delivery (same queue the auto-send trigger fills). */
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const admin = createAdminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }
  const invoiceId = String(body?.invoiceId ?? '');
  if (!invoiceId) return jsonError('invoiceId required');

  const { data: invoice, error } = await admin
    .from('invoices')
    .select('id, invoice_number, total_amount, status, customer_id, session_id, customers(mobile), sessions(guest_mobile)')
    .eq('id', invoiceId)
    .single();
  if (error || !invoice) return jsonError('Invoice not found', 404);

  const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
  const rawMobile =
    digits((invoice.customers as any)?.mobile) || digits((invoice.sessions as any)?.guest_mobile);
  const to_mobile = rawMobile.slice(-10);
  if (to_mobile.length < 7) {
    return jsonError('This invoice has no customer mobile number to send to', 400);
  }

  const { data: settingsRow } = await admin.from('settings').select('cafe_name').eq('id', 'default').single();
  const caption =
    `Thank you for visiting ${settingsRow?.cafe_name ?? 'the cafe'}!\n\n` +
    `Receipt *${invoice.invoice_number}* · Total ${Number(invoice.total_amount ?? 0).toFixed(2)}` +
    (invoice.status === 'PAID' ? '\nPaid in full ✓' : '');

  const { data: msg, error: merr } = await admin
    .from('whatsapp_messages')
    .insert({ invoice_id: invoiceId, to_mobile, caption, status: 'PENDING' })
    .select('id')
    .single();
  if (merr) return jsonError(merr.message, 500);

  // is the relay around to actually deliver it soon?
  const { data: st } = await admin
    .from('whatsapp_state')
    .select('connected, last_seen')
    .eq('id', 'default')
    .single();
  const relayOnline =
    !!st?.connected && !!st?.last_seen && Date.now() - new Date(st.last_seen).getTime() < 30_000;

  return NextResponse.json({ ok: true, messageId: msg.id, relayOnline });
}
