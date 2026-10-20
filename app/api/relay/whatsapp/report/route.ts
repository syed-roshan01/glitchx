import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isRelayAuthorized, RELAY_UNAUTHORIZED } from '@/lib/whatsapp/relay-auth';

export const dynamic = 'force-dynamic';

/** POST /api/relay/whatsapp/report — delivery result for one message. */
export async function POST(req: NextRequest) {
  if (!isRelayAuthorized(req)) return NextResponse.json(RELAY_UNAUTHORIZED, { status: 401 });
  const admin = createAdminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const id = String(body?.id ?? '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const ok = body?.ok === true;

  const { data: row } = await admin
    .from('whatsapp_messages')
    .select('attempts')
    .eq('id', id)
    .single();
  if (!row) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const patch: Record<string, unknown> = ok
    ? {
        status: 'SENT',
        sent_at: new Date().toISOString(),
        attempts: (row.attempts ?? 0) + 1,
        wa_message_id: body?.wa_message_id ? String(body.wa_message_id).slice(0, 120) : null,
        last_error: null,
      }
    : {
        status: 'FAILED',
        attempts: (row.attempts ?? 0) + 1,
        last_error: body?.error ? String(body.error).slice(0, 500) : 'send failed',
      };

  const { error } = await admin.from('whatsapp_messages').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
