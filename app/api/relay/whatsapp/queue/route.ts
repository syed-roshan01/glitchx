import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isRelayAuthorized, RELAY_UNAUTHORIZED } from '@/lib/whatsapp/relay-auth';

export const dynamic = 'force-dynamic';

/** GET /api/relay/whatsapp/queue — the next batch of pending messages
 *  with the pacing delay the relay should keep between sends. */
export async function GET(req: NextRequest) {
  if (!isRelayAuthorized(req)) return NextResponse.json(RELAY_UNAUTHORIZED, { status: 401 });
  const admin = createAdminClient();

  const [msgs, state] = await Promise.all([
    admin
      .from('whatsapp_messages')
      .select('id, invoice_id, to_mobile, caption, invoices(invoice_number)')
      .eq('status', 'PENDING')
      .order('created_at')
      .limit(5),
    admin.from('whatsapp_state').select('send_delay_ms, enabled').eq('id', 'default').single(),
  ]);

  return NextResponse.json({
    enabled: state.data?.enabled ?? false,
    send_delay_ms: state.data?.send_delay_ms ?? 2500,
    messages: (msgs.data ?? []).map((m: any) => ({
      id: m.id,
      invoice_id: m.invoice_id,
      to_mobile: m.to_mobile,
      caption: m.caption,
      filename: `${String(m.invoices?.invoice_number ?? 'receipt').replace(/[^\w.-]+/g, '_')}.pdf`,
    })),
  });
}
