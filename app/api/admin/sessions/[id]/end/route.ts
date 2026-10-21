import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapSession, mapSessionItem, mapSettings, mapPricingRule } from '@/lib/mappers';
import { calculateSessionBreakdown, calculateGroupBreakdown, gamingForTargetTotal } from '@/lib/billing/engine';
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

  // ---- optional customer details typed on the end-session screen ----
  if (body && ('customerName' in body || 'customerMobile' in body)) {
    const { error: cerr } = await admin.rpc('admin_set_session_customer', {
      p_session_id: params.id,
      p_name: input.customerName,
      p_mobile: input.customerMobile,
      p_acting_user: userId,
    });
    if (cerr) return jsonError(friendlyError(cerr), 400);
  }

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

  const taxRate = settings.tax_enabled ? settings.tax_rate ?? 0 : 0;
  const totalRounding = settings.total_rounding ?? 0;
  // a hand-set total follows the money step too (typed 122 → bills 125)
  const targetTotal =
    input.finalTotal != null && totalRounding > 0
      ? Math.ceil(input.finalTotal / totalRounding) * totalRounding
      : (input.finalTotal ?? 0);
  let gamingOverride: number | null = null;
  if (input.finalTotal != null) {
    gamingOverride = gamingForTargetTotal({
      targetTotal,
      itemAmount,
      serviceAmount,
      discount,
      taxRate,
      totalRounding,
    });
    if (gamingOverride === null) {
      return jsonError('The total cannot be less than the food, drinks and services on this bill.', 400);
    }
  }

  // ---- frozen billable end (captured at the "End session" click) ----
  const parsedEnd = input.endAt ? new Date(input.endAt) : null;
  const frozenEnd = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : new Date();

  // the whole bill: the lead session + every companion station added to it
  const { data: groupRows } = await admin
    .from('sessions')
    .select('*')
    .or(`id.eq.${session.id},parent_id.eq.${session.id},id.eq.${session.parent_id ?? '00000000-0000-0000-0000-000000000000'}`)
    .in('status', ['ACTIVE', 'PAUSED']);
  const seen = new Map<string, any>();
  for (const row of [session as any, ...(groupRows ?? [])]) {
    if (!seen.has(row.id)) seen.set(row.id, row);
  }
  const group = [...seen.values()];
  const groupIds = group.map((s) => s.id);
  const { data: groupItems } = await admin
    .from('session_items')
    .select('*')
    .in('session_id', groupIds);

  const groupBreakdown = calculateGroupBreakdown({
    gamingOverride,
    members: group.map((s) => {
      const its = (groupItems ?? []).filter((i: any) => i.session_id === s.id);
      return {
        id: s.id,
        plan: s.pricing_plan_snapshot,
        resourceId: s.resource_id,
        resourceType: s.resource_type ?? '',
        timing: {
          actual_start_time: s.actual_start_time,
          paused_at: s.paused_at,
          total_paused_seconds: s.total_paused_seconds,
        },
        itemAmount: its
          .filter((i: any) => ['FOOD', 'DRINK', 'OTHER'].includes(i.item_type))
          .reduce((sum: number, i: any) => sum + i.total_price, 0),
        serviceAmount: its
          .filter((i: any) => ['SERVICE', 'GAME'].includes(i.item_type))
          .reduce((sum: number, i: any) => sum + i.total_price, 0),
      };
    }),
    rules,
    billingMode: settings.billing_mode,
    minBillingMinutes: settings.min_billing_minutes,
    timeZone: settings.timezone,
    endAt: frozenEnd,
    discount,
    tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
    totalRounding,
  });

  const breakdown = groupBreakdown;

  // ---- atomic end-session transaction ----
  const { data: result, error } = await admin.rpc('admin_end_session_and_invoice', {
    p_session_id: session.id,
    p_billing: {
      duration_seconds: Math.floor(breakdown.elapsedSeconds),
      gaming_amount: breakdown.gamingAmount,
      rounding_amount: breakdown.roundingAmount,
      // one charge per station — the invoice shows a line each
      gaming_lines: groupBreakdown.perMember
        .filter((m) => m.gamingAmount > 0)
        .map((m) => ({ session_id: m.id, amount: m.gamingAmount })),
    },
    p_discount_type: input.discountType ?? null,
    p_discount_value: input.discountType ? Number(input.discountValue ?? 0) : 0,
    p_payment_method: input.paymentMethod ?? null,
    p_payment_reference: input.paymentReference ?? null,
    p_acting_user: userId,
    // the DB bills the SAME frozen moment as the confirmation screen
    p_end_at: frozenEnd.toISOString(),
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'session.ended', 'session', session.id, {
    invoiceNumber: result?.invoice_number,
    total: num(result?.total_amount),
    paymentMethod: input.paymentMethod ?? null,
    ...(breakdown.gamingAdjusted
      ? {
          amountEdited: true,
          timerGamingAmount: breakdown.computedGamingAmount,
          finalGamingAmount: breakdown.gamingAmount,
          requestedTotal: input.finalTotal,
        }
      : {}),
  });

  return NextResponse.json({
    invoiceId: result?.invoice_id,
    invoiceNumber: result?.invoice_number,
    breakdown,
  });
}
