import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** GET /api/admin/whatsapp — relay state + recent message log. */
export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const admin = createAdminClient();

  const [state, messages] = await Promise.all([
    admin.from('whatsapp_state').select('*').eq('id', 'default').single(),
    admin
      .from('whatsapp_messages')
      .select('id, invoice_id, to_mobile, caption, status, attempts, last_error, wa_message_id, created_at, sent_at, invoices(invoice_number, total_amount)')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  return NextResponse.json({ state: state.data ?? null, messages: messages.data ?? [] });
}

/** PUT /api/admin/whatsapp — update config. */
export async function PUT(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const admin = createAdminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.auto_send === 'boolean') patch.auto_send = body.auto_send;
  if (body.send_delay_ms != null) {
    const d = Number(body.send_delay_ms);
    if (!Number.isFinite(d) || d < 0 || d > 60000) return jsonError('Delay must be 0–60000 ms');
    patch.send_delay_ms = Math.round(d);
  }
  if (Object.keys(patch).length === 0) return jsonError('Nothing to update');

  const { error } = await admin.from('whatsapp_state').update(patch).eq('id', 'default');
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}
