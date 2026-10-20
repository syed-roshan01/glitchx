import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isRelayAuthorized, RELAY_UNAUTHORIZED } from '@/lib/whatsapp/relay-auth';

export const dynamic = 'force-dynamic';

/** POST /api/relay/whatsapp/state — relay heartbeat: connection state,
 *  linked phone number and the current QR payload (data URL). */
export async function POST(req: NextRequest) {
  if (!isRelayAuthorized(req)) return NextResponse.json(RELAY_UNAUTHORIZED, { status: 401 });
  const admin = createAdminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { last_seen: new Date().toISOString() };
  if (typeof body.connected === 'boolean') {
    patch.connected = body.connected;
    if (body.connected) patch.qr = null; // linked — the QR is gone
  }
  if (typeof body.phone === 'string') patch.phone = body.phone.slice(0, 30) || null;
  if (typeof body.qr === 'string' || body.qr === null) patch.qr = body.qr;
  if (typeof body.last_error === 'string' || body.last_error === null) {
    patch.last_error = body.last_error ? String(body.last_error).slice(0, 500) : null;
  }

  const { error } = await admin.from('whatsapp_state').update(patch).eq('id', 'default');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
