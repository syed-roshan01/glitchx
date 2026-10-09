import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { setDiscountSchema, sessionPriceSchema, sessionCustomerSchema } from '@/lib/validations/schemas';
import { mapSession, mapSessionItem, mapSettings, mapPricingRule } from '@/lib/mappers';
import { calculateSessionBreakdown } from '@/lib/billing/engine';

export const dynamic = 'force-dynamic';

async function loadSession(admin: any, id: string) {
  const { data, error } = await admin
    .from('sessions')
    .select('*, customers(name, mobile), resources(name, type)')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return mapSession({
    ...data,
    customer_name: data.customers?.name,
    customer_mobile: data.customers?.mobile,
    resource_name: data.resources?.name,
    resource_type: data.resources?.type,
  });
}

/** GET /api/admin/sessions/[id] — session + items + live breakdown */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  let session = await loadSession(admin, params.id);
  if (!session) return jsonError('Session not found', 404);

  // A scheduled session whose start time has arrived must be ACTIVE —
  // activate it now rather than waiting for some other page load.
  if (
    session.status === 'SCHEDULED' &&
    session.scheduled_start_time &&
    new Date(session.scheduled_start_time).getTime() <= Date.now()
  ) {
    await admin.rpc('activate_due_sessions');
    session = (await loadSession(admin, params.id)) ?? session;
  }

  const [itemsRes, settingsRes, rulesRes, invoiceRes] = await Promise.all([
    admin.from('session_items').select('*').eq('session_id', session.id).order('created_at'),
    admin.from('settings').select('*').eq('id', 'default').single(),
    admin.from('pricing_rules').select('*').eq('active', true),
    admin
      .from('invoices')
      .select('id, invoice_number')
      .eq('session_id', session.id)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const invoice = invoiceRes.data
    ? { id: invoiceRes.data.id as string, invoice_number: invoiceRes.data.invoice_number as string }
    : null;

  const items = (itemsRes.data ?? []).map(mapSessionItem);
  const settings = mapSettings(settingsRes.data ?? {});
  const rules = (rulesRes.data ?? []).map(mapPricingRule);

  let breakdown = null;
  if ((session.status === 'ACTIVE' || session.status === 'PAUSED') && session.actual_start_time) {
    const itemAmount = items
      .filter((i) => ['FOOD', 'DRINK', 'OTHER'].includes(i.item_type))
      .reduce((s, i) => s + i.total_price, 0);
    const serviceAmount = items
      .filter((i) => ['SERVICE', 'GAME'].includes(i.item_type))
      .reduce((s, i) => s + i.total_price, 0);
    breakdown = calculateSessionBreakdown({
      plan: session.pricing_plan_snapshot,
      rules,
      billingMode: settings.billing_mode,
      minBillingMinutes: settings.min_billing_minutes,
      timeZone: settings.timezone,
      resourceId: session.resource_id,
      resourceType: session.resource_type ?? '',
      timing: {
        actual_start_time: session.actual_start_time!,
        paused_at: session.paused_at,
        total_paused_seconds: session.total_paused_seconds,
      },
      itemAmount,
      serviceAmount,
      discount:
        session.discount_type && session.discount_value
          ? { type: session.discount_type, value: session.discount_value }
          : null,
      tax: { enabled: settings.tax_enabled, name: settings.tax_name, rate: settings.tax_rate },
    });
  }

  return NextResponse.json({ session, items, settings, rules, breakdown, invoice });
}

/** PATCH /api/admin/sessions/[id] — { action: pause | resume | discount | notes } */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const action: string = body?.action;

  try {
    if (action === 'pause') {
      const { error } = await admin.rpc('admin_pause_session', { p_session_id: params.id });
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.paused', 'session', params.id);
    } else if (action === 'resume') {
      const { error } = await admin.rpc('admin_resume_session', { p_session_id: params.id });
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.resumed', 'session', params.id);
    } else if (action === 'discount') {
      const parsed = setDiscountSchema.safeParse({
        discountType: body.discountType ?? null,
        discountValue: Number(body.discountValue ?? 0),
      });
      if (!parsed.success) return jsonError('Invalid discount');
      const type = parsed.data.discountType;
      const value = parsed.data.discountValue;
      if (type === 'PERCENT' && value > 100) return jsonError('A percentage discount cannot exceed 100%');
      const { error } = await admin.rpc('admin_set_session_discount', {
        p_session_id: params.id,
        p_discount_type: type,
        p_discount_value: type ? value : 0,
      });
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.discount_set', 'session', params.id, {
        discountType: type,
        discountValue: type ? value : 0,
      });
    } else if (action === 'rate' || action === 'price') {
      const parsed = sessionPriceSchema.safeParse({ price: Number(body.price) });
      if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid price');
      const { error } = await admin.rpc('admin_set_session_price', {
        p_session_id: params.id,
        p_price: parsed.data.price,
      });
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.price_changed', 'session', params.id, { price: parsed.data.price });
    } else if (action === 'customer') {
      const parsed = sessionCustomerSchema.safeParse({ name: body.name ?? null, mobile: body.mobile ?? null });
      if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid customer details');
      const { error } = await admin.rpc('admin_set_session_customer', {
        p_session_id: params.id,
        p_name: parsed.data.name,
        p_mobile: parsed.data.mobile,
        p_acting_user: userId,
      });
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.customer_set', 'session', params.id, {
        name: parsed.data.name,
        hasMobile: !!parsed.data.mobile,
      });
    } else if (action === 'notes') {
      const notes = String(body.notes ?? '').slice(0, 500);
      const { error } = await admin
        .from('sessions')
        .update({ notes })
        .eq('id', params.id)
        .in('status', ['SCHEDULED', 'ACTIVE', 'PAUSED']);
      if (error) return jsonError(friendlyError(error), 400);
      await audit(admin, userId, 'session.notes_updated', 'session', params.id);
    } else {
      return jsonError('Unknown action');
    }
  } catch (err) {
    return jsonError('Could not update the session', 500);
  }

  const session = await loadSession(admin, params.id);
  return NextResponse.json({ session });
}
