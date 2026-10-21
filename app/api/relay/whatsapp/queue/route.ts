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
    _debug: {
      computedAt: new Date().toISOString(),
      msgsError: msgs.error ? { message: msgs.error.message, code: (msgs.error as any).code, details: (msgs.error as any).details } : null,
      stateError: state.error ? { message: state.error.message, code: (state.error as any).code, details: (state.error as any).details } : null,
      msgsData: msgs.data,
      stateData: state.data,
      supaUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      keyHead: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').slice(0, 8),
      rawCross: await (async () => {
        try {
          const r = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/whatsapp_messages?select=id&status=eq.PENDING&limit=5`,
            {
              headers: {
                apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
              },
              cache: 'no-store',
            }
          );
          return { status: r.status, body: (await r.text()).slice(0, 200) };
        } catch (e: any) {
          return { threw: String(e?.message || e) };
        }
      })(),
    },
  });
}
