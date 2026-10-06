import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, pageParams } from '@/lib/supabase/api';
import { getCachedSettings } from '@/lib/supabase/settings-cache';
import { getZonedDayStart } from '@/lib/utils/time';
import { mapPayment } from '@/lib/mappers';
import { paymentSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/admin/payments?limit=&offset= */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { limit, offset } = pageParams(req, 50, 200);
  const settings = await getCachedSettings(admin);
  const dayStart = getZonedDayStart(settings.timezone).toISOString();

  const [list, today] = await Promise.all([
    admin
      .from('payments')
      .select('*, invoices(invoice_number), profiles(name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    admin.from('payments').select('amount').eq('payment_status', 'PAID').gte('paid_at', dayStart),
  ]);
  const { data, error, count } = list;
  if (error) return jsonError(friendlyError(error), 400);
  const todayTotal =
    Math.round((today.data ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0) * 100) / 100;

  const payments = (data ?? []).map((r: any) =>
    mapPayment({
      ...r,
      received_by_name: r.profiles?.name ?? null,
      invoice_number: r.invoices?.invoice_number ?? null,
    })
  );
  return NextResponse.json({ payments, total: count ?? 0, todayTotal });
}

/** POST /api/admin/payments — record a payment against an invoice */
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid payment');
  const input = parsed.data;

  // atomic: locks the invoice, checks the balance, inserts the payment and
  // updates invoice + session status in one transaction
  const { data: result, error } = await admin.rpc('admin_record_payment', {
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_method: input.paymentMethod,
    p_reference: input.transactionReference ?? null,
    p_acting_user: userId,
  });
  if (error) {
    const raw = error.message ?? '';
    const status = /INVOICE_NOT_FOUND/.test(raw) ? 404 : /EXCEEDS|VOID/.test(raw) ? 409 : 400;
    return jsonError(friendlyError(error), status);
  }
  const newStatus = result?.invoice_status as string;
  const { data: payment } = await admin.from('payments').select('*').eq('id', result?.payment_id).single();

  await audit(admin, userId, 'payment.recorded', 'invoice', input.invoiceId, {
    amount: input.amount,
    method: input.paymentMethod,
    status: newStatus,
  });

  return NextResponse.json({ payment: mapPayment(payment), invoiceStatus: newStatus });
}
