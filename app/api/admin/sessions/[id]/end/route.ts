import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapSession, mapSessionItem, mapSettings, mapPricingRule } from '@/lib/mappers';
import { calculateSessionBreakdown } from '@/lib/billing/engine';
import { endSessionSchema } from '@/lib/validations/schemas';
import { num } from '@/lib/billing/format';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sessions/[id]/end — end the session and create the
 * invoice atomically.
 *
 * The billing engine (server-side) computes the gaming charge from DB
 * timestamps + the session's plan snapshot + active pricing rules.
 * The SQL function locks the session, recomputes the authoritative
 * duration, and performs the whole write in one transaction.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = endSessionSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid input');
  const input = parsed.data;

  // ---- load everything needed for the final bill ----
  const { data: raw, error: serr } = await admin
    .from('sessions')
    .select('*, customers(name, mobile), resources(name, type)')
    .eq('id', params.id)
    .single();
  if (serr || !raw) return jsonError('Session not found', 404);

  const session = mapSession({
    ...raw,
    customer_name: raw.customers?.name,
    customer_mobile: raw.customers?.mobile,
    resource_name: raw.resources?.name,
    resource_type: raw.resources?.type,
  });

  if (session.status !== 'ACTIVE' && session.status !== 'PAUSED') {
    return jsonError('This session is not active', 409);
  }
  if (!session.actual_start_time) {
    return jsonError('Session has no start time', 409);
  }

  const [itemsRes, settingsRes, rulesRes] = await Promise.all([
    admin.from('session_items').select('*').eq('session_id', session.id),
    admin.from('settings').select('*').eq('id', 'default').single(),
    admin.from('pricing_rules').select('*').eq('active', true),
  ]);
  const items = (itemsRes.data ?? []).map(mapSessionItem);
  const settings = mapSettings(settingsRes.data ?? {});
  const rules = (rulesRes.data ?? []).map(mapPricingRule);

  // ---- billing engine: final breakdown ----
  const itemAmount = items
    .filter((i) => ['FOOD', 'DRINK', 'OTHER'].includes(i.item_type))
    .reduce((s, i) => s + i.total_price, 0);
  const serviceAmount = items
    .filter((i) => ['SERVICE', 'GAME'].includes(i.item_type))
    .reduce((s, i) => s + i.total_price, 0);

  const discount =
    input.discountType && (input.discountValue ?? 0) > 0
      ? { type: input.discountType, value: Number(input.discountValue) }
      : null;

  const breakdown = calculateSessionBreakdown({
    plan: session.pricing_plan_snapshot,
    rules,
    billingMode: settings.billing_mode,
    minBillingMinutes: settings.min_billing_minutes,
    timeZone: settings.timezone,
    resourceId: session.resource_id,
    resourceType: session.resource_type ?? '',
    timing: {
      actual_start_time: session.actual_start_time,
      paused_at: session.paused_at,
      total_paused_seconds: session.total_paused_seconds,
    },
    endAt: new Date(),
    itemAmount,
    serviceAmount,
    discount,
    tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
  });

  // ---- atomic end-session transaction ----
  const { data: result, error } = await admin.rpc('admin_end_session_and_invoice', {
    p_session_id: session.id,
    p_billing: {
      duration_seconds: Math.floor(breakdown.elapsedSeconds),
      gaming_amount: breakdown.gamingAmount,
    },
    p_discount_type: input.discountType ?? null,
    p_discount_value: input.discountType ? Number(input.discountValue ?? 0) : 0,
    p_payment_method: input.paymentMethod ?? null,
    p_payment_reference: input.paymentReference ?? null,
    p_acting_user: userId,
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'session.ended', 'session', session.id, {
    invoiceNumber: result?.invoice_number,
    total: num(result?.total_amount),
    paymentMethod: input.paymentMethod ?? null,
  });

  return NextResponse.json({
    invoiceId: result?.invoice_id,
    invoiceNumber: result?.invoice_number,
    breakdown,
  });
}
