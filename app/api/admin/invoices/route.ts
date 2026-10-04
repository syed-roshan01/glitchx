import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError } from '@/lib/supabase/api';
import { mapInvoice } from '@/lib/mappers';

export const dynamic = 'force-dynamic';

/** GET /api/admin/invoices?q=&status=&limit=&offset= */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const params = req.nextUrl.searchParams;
  const q = (params.get('q') ?? '').trim();
  const status = params.get('status');
  const limit = Math.min(Number(params.get('limit') ?? 25), 100);
  const offset = Number(params.get('offset') ?? 0);

  let query = admin
    .from('invoices')
    .select('*', { count: 'exact' })
    .order('issued_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (q) query = query.or(`invoice_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_mobile.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ invoices: (data ?? []).map(mapInvoice), total: count ?? 0 });
}
