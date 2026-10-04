import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapPayment } from '@/lib/mappers';
import { paymentSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/admin/payments?limit=&offset= */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Number(params.get('limit') ?? 50), 200);
  const offset = Number(params.get('offset') ?? 0);

  const { data, error, count } = await admin
    .from('payments')
    .select('*, invoices(invoice_number), profiles(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return jsonError(friendlyError(error), 400);

  const payments = (data ?? []).map((r: any) =>
    mapPayment({
      ...r,
      received_by_name: r.profiles?.name ?? null,
      invoice_number: r.invoices?.invoice_number ?? null,
    })
  );
  return NextResponse.json({ payments, total: count ?? 0 });
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

  const { data: invoice, error: ierr } = await admin
    .from('invoices')
    .select('id, total_amount, status, session_id')
    .eq('id', input.invoiceId)
    .single();
  if (ierr || !invoice) return jsonError('Invoice not found', 404);
  if (invoice.status === 'PAID') return jsonError('This invoice is already paid', 409);
  if (invoice.status === 'VOID') return jsonError('This invoice is void', 409);

  const total = Number(invoice.total_amount);

  // existing payments
  const { data: existing } = await admin
    .from('payments')
    .select('amount, payment_status')
    .eq('invoice_id', input.invoiceId);
  const alreadyPaid = (existing ?? [])
    .filter((p: any) => p.payment_status === 'PAID')
    .reduce((s: number, p: any) => s + Number(p.amount), 0);
  const remaining = Math.max(total - alreadyPaid, 0);

  if (input.amount > remaining + 0.01) {
    return jsonError(`Payment exceeds the remaining balance (${remaining.toFixed(2)})`, 400);
  }

  const { data: payment, error } = await admin
    .from('payments')
    .insert({
      invoice_id: input.invoiceId,
      amount: input.amount,
      payment_method: input.paymentMethod,
      payment_status: 'PAID',
      transaction_reference: input.transactionReference ?? null,
      paid_at: new Date().toISOString(),
      received_by: userId,
    })
    .select()
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  const newStatus = alreadyPaid + input.amount >= total - 0.01 ? 'PAID' : 'PARTIAL';
  await admin.from('invoices').update({ status: newStatus }).eq('id', input.invoiceId);
  if (invoice.session_id) {
    await admin
      .from('sessions')
      .update({ payment_status: newStatus === 'PAID' ? 'PAID' : 'PARTIAL' })
      .eq('id', invoice.session_id);
  }

  await audit(admin, userId, 'payment.recorded', 'invoice', input.invoiceId, {
    amount: input.amount,
    method: input.paymentMethod,
    status: newStatus,
  });

  return NextResponse.json({ payment: mapPayment(payment), invoiceStatus: newStatus });
}
