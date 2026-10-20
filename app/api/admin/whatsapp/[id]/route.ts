import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** POST /api/admin/whatsapp/[id] — { action: 'retry' | 'cancel' } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const admin = createAdminClient();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  if (body?.action === 'retry') {
    const { data: row, error } = await admin
      .from('whatsapp_messages')
      .update({ status: 'PENDING', last_error: null })
      .eq('id', params.id)
      .in('status', ['FAILED', 'SENT'])
      .select('id')
      .single();
    if (error || !row) return jsonError('Message not found (or still queued)', 404);
    return NextResponse.json({ ok: true });
  }

  if (body?.action === 'cancel') {
    const { data: row, error } = await admin
      .from('whatsapp_messages')
      .delete()
      .eq('id', params.id)
      .eq('status', 'PENDING')
      .select('id')
      .single();
    if (error || !row) return jsonError('Only queued messages can be cancelled', 404);
    return NextResponse.json({ ok: true });
  }

  return jsonError('Unknown action');
}
