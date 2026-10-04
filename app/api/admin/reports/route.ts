import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
import { mapSettings } from '@/lib/mappers';
import { getZonedDayStart, getZonedDayStartNDaysAgo, zonedDateKey, zonedHour } from '@/lib/utils/time';
import { num } from '@/lib/billing/format';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/reports?range=day|week|month
 * Aggregates revenue, categories, resources, items, payment methods,
 * session stats and peak hours over the range (cafe timezone).
 */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const range = req.nextUrl.searchParams.get('range') ?? 'day';
  const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;

  const settingsRow = (await admin.from('settings').select('*').eq('id', 'default').single()).data;
  const settings = mapSettings(settingsRow ?? {});
  const tz = settings.timezone || 'Asia/Kolkata';
  const start =
    days === 1
      ? getZonedDayStart(tz)
      : getZonedDayStartNDaysAgo(days - 1, tz);
  const startIso = start.toISOString();

  const [invoicesRes, itemsRes, paymentsRes, sessionsRes] = await Promise.all([
    admin
      .from('invoices')
      .select('id, issued_at, status, gaming_amount, items_amount, services_amount, total_amount, session_id')
      .gte('issued_at', startIso)
      .neq('status', 'VOID'),
    admin
      .from('invoice_items')
      .select('invoice_id, item_type, name_snapshot, quantity, total_price')
      .in(
        'invoice_id',
        ((await admin.from('invoices').select('id').gte('issued_at', startIso).neq('status', 'VOID')).data ?? []).map(
          (r: any) => r.id
        )
      ),
    admin
      .from('payments')
      .select('amount, payment_method, payment_status, created_at')
      .gte('created_at', startIso)
      .eq('payment_status', 'PAID'),
    admin
      .from('sessions')
      .select('id, customer_id, resource_id, duration_seconds, actual_start_time, status, resources(name)')
      .gte('actual_start_time', startIso),
  ]);

  const invoices = invoicesRes.data ?? [];
  const invItems = itemsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];

  const round = (n: number) => Math.round(n * 100) / 100;

  // ---- revenue series (by day; by hour for the single-day view) ----
  const seriesMap = new Map<string, { revenue: number; sessions: number }>();
  const isDayView = days === 1;
  if (isDayView) {
    for (let h = 0; h < 24; h++) seriesMap.set(`h${h}`, { revenue: 0, sessions: 0 });
  } else {
    for (let d = days - 1; d >= 0; d--) {
      seriesMap.set(zonedDateKey(new Date(Date.now() - d * 86400000), tz), { revenue: 0, sessions: 0 });
    }
  }
  const keyFor = (dateStr: string) =>
    isDayView ? `h${zonedHour(new Date(dateStr), tz)}` : zonedDateKey(new Date(dateStr), tz);

  for (const inv of invoices) {
    const key = keyFor(inv.issued_at);
    const entry = seriesMap.get(key);
    if (entry) entry.revenue += num(inv.total_amount);
  }
  for (const s of sessions) {
    const key = keyFor(s.actual_start_time);
    const entry = seriesMap.get(key);
    if (entry) entry.sessions += 1;
  }

  const revenueSeries = Array.from(seriesMap.entries()).map(([key, v]) => ({
    label: isDayView ? `${key.slice(1).padStart(2, '0')}:00` : key.slice(5),
    revenue: round(v.revenue),
    sessions: v.sessions,
  }));

  // ---- categories ----
  const categoryTotals = {
    gaming: round(invoices.reduce((s, i) => s + num(i.gaming_amount), 0)),
    food: round(invoices.reduce((s, i) => s + num(i.items_amount), 0)),
    services: round(invoices.reduce((s, i) => s + num(i.services_amount), 0)),
    total: round(invoices.reduce((s, i) => s + num(i.total_amount), 0)),
  };

  // ---- by resource ----
  const byResourceMap = new Map<string, { name: string; revenue: number; sessions: number; minutes: number }>();
  const invoiceSessionIds = new Set(invoices.map((i) => i.session_id));
  for (const s of sessions as any[]) {
    const key = s.resource_id;
    const entry = byResourceMap.get(key) ?? {
      name: s.resources?.name ?? 'Unknown',
      revenue: 0,
      sessions: 0,
      minutes: 0,
    };
    entry.sessions += 1;
    if (s.status === 'COMPLETED') entry.minutes += (s.duration_seconds ?? 0) / 60;
    else if (s.actual_start_time)
      entry.minutes += (Date.now() - new Date(s.actual_start_time).getTime()) / 60000;
    byResourceMap.set(key, entry);
  }
  // revenue per resource: sessions link to invoices via session_id
  for (const inv of invoices) {
    if (!inv.session_id) continue;
    const s = (sessions as any[]).find((x) => x.id === inv.session_id);
    if (s) {
      const entry = byResourceMap.get(s.resource_id);
      if (entry) entry.revenue += num(inv.total_amount);
    }
  }

  // ---- by item (food/drinks/other lines) ----
  const byItemMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const it of invItems) {
    if (['GAMING', 'DISCOUNT'].includes(it.item_type)) continue;
    const entry = byItemMap.get(it.name_snapshot) ?? {
      name: it.name_snapshot,
      quantity: 0,
      revenue: 0,
    };
    entry.quantity += it.quantity ?? 1;
    entry.revenue += num(it.total_price);
    byItemMap.set(it.name_snapshot, entry);
  }

  // ---- payment methods ----
  const byMethodMap = new Map<string, { method: string; amount: number; count: number }>();
  for (const p of payments) {
    const entry = byMethodMap.get(p.payment_method) ?? {
      method: p.payment_method,
      amount: 0,
      count: 0,
    };
    entry.amount += num(p.amount);
    entry.count += 1;
    byMethodMap.set(p.payment_method, entry);
  }

  // ---- session stats ----
  const completed = sessions.filter((s: any) => s.status === 'COMPLETED');
  const totalRevenue = categoryTotals.total;
  const sessionStats = {
    count: sessions.length,
    avgMinutes:
      completed.length > 0
        ? Math.round(
            completed.reduce((s: number, x: any) => s + (x.duration_seconds ?? 0), 0) /
              completed.length /
              60
          )
        : 0,
    avgBillValue: invoices.length > 0 ? round(totalRevenue / invoices.length) : 0,
    totalCustomers: new Set(sessions.map((s: any) => s.customer_id)).size,
  };

  return NextResponse.json({
    range,
    days,
    settings,
    revenueSeries,
    categoryTotals,
    byResource: Array.from(byResourceMap.values()).map((r) => ({
      ...r,
      revenue: round(r.revenue),
      minutes: Math.round(r.minutes),
    })),
    byItem: Array.from(byItemMap.values())
      .map((r) => ({ ...r, revenue: round(r.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    byPaymentMethod: Array.from(byMethodMap.values())
      .map((r) => ({ ...r, amount: round(r.amount) }))
      .sort((a, b) => b.amount - a.amount),
    sessionStats,
  });
}
