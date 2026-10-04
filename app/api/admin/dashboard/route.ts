import { NextResponse } from 'next/server';
import { requireAuth, jsonError } from '@/lib/supabase/api';
import { mapSettings, mapSession, mapSessionItem, mapBooking, mapWaitlist, mapResource, mapPricingRule } from '@/lib/mappers';
import { getZonedDayStart } from '@/lib/utils/time';
import { num } from '@/lib/billing/format';
import type { DashboardStats } from '@/types';

export const dynamic = 'force-dynamic';

/** Dashboard payload: stats + live state. Refetched on realtime events. */
export async function GET() {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  try {
    // lazy-activate any due SCHEDULED sessions first
    await admin.rpc('activate_due_sessions');

    const settingsRow = (await admin.from('settings').select('*').eq('id', 'default').single()).data;
    const settings = mapSettings(settingsRow ?? {});
    const dayStart = getZonedDayStart(settings.timezone || 'Asia/Kolkata');

    const [invoicesRes, activeRes, todaySessionsRes, pendingRes, waitlistRes,
      bookingsRes, resourcesRes, rulesRes] = await Promise.all([
      admin.from('invoices')
        .select('gaming_amount, items_amount, services_amount, total_amount, status, issued_at, session_id')
        .gte('issued_at', dayStart.toISOString())
        .neq('status', 'VOID'),
      admin.from('sessions')
        .select('*, customers(name, mobile), resources(name, type)')
        .in('status', ['ACTIVE', 'PAUSED'])
        .order('actual_start_time', { ascending: true }),
      admin.from('sessions')
        .select('id, customer_id, resource_id, duration_seconds, actual_start_time, status, resources(name)')
        .gte('actual_start_time', dayStart.toISOString()),
      admin.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      admin.from('waitlist').select('*, resources(name)').eq('status', 'WAITING').order('position'),
      admin.from('bookings')
        .select('*, resources(name, type)')
        .gte('start_time', dayStart.toISOString())
        .order('start_time', { ascending: true }).limit(12),
      admin.from('resources').select('*').order('name'),
      admin.from('pricing_rules').select('*').eq('active', true),
    ]);

    const invoices = invoicesRes.data ?? [];
    const activeSessions = (activeRes.data ?? []).map((r: any) => mapSession({
      ...r,
      customer_name: r.customers?.name,
      customer_mobile: r.customers?.mobile,
      resource_name: r.resources?.name,
      resource_type: r.resources?.type,
    }));
    const todaySessions = todaySessionsRes.data ?? [];
    const resources = (resourcesRes.data ?? []).map(mapResource);

    // session items for active sessions (live bill preview)
    const activeIds = activeSessions.map((s) => s.id);
    const itemsRes = activeIds.length
      ? await admin.from('session_items').select('*').in('session_id', activeIds).order('created_at')
      : { data: [] };
    const sessionItems = (itemsRes.data ?? []).map(mapSessionItem);

    // ---- stats ----
    const todayRevenue = invoices.reduce((s, i) => s + num(i.total_amount), 0);
    const gamingRevenue = invoices.reduce((s, i) => s + num(i.gaming_amount), 0);
    const foodRevenue = invoices.reduce((s, i) => s + num(i.items_amount), 0);
    const serviceRevenue = invoices.reduce((s, i) => s + num(i.services_amount), 0);

    const completedToday = todaySessions.filter((s: any) => s.status === 'COMPLETED');
    const avgSessionMinutes =
      completedToday.length > 0
        ? Math.round(
            completedToday.reduce((s: number, x: any) => s + (x.duration_seconds ?? 0), 0) /
              completedToday.length / 60
          )
        : 0;
    const avgBillValue = invoices.length > 0 ? todayRevenue / invoices.length : 0;

    // utilization: minutes per resource today
    const utilizationMap = new Map<string, { name: string; minutes: number; sessions: number }>();
    for (const s of todaySessions as any[]) {
      const rid = s.resource_id as string;
      const name = s.resources?.name ?? 'Unknown';
      const entry = utilizationMap.get(rid) ?? { name, minutes: 0, sessions: 0 };
      entry.sessions += 1;
      if (s.status === 'COMPLETED') entry.minutes += (s.duration_seconds ?? 0) / 60;
      else if (s.actual_start_time) {
        entry.minutes += (Date.now() - new Date(s.actual_start_time).getTime()) / 60000;
      }
      utilizationMap.set(rid, entry);
    }

    const stats: DashboardStats = {
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      gamingRevenue: Math.round(gamingRevenue * 100) / 100,
      foodRevenue: Math.round(foodRevenue * 100) / 100,
      serviceRevenue: Math.round(serviceRevenue * 100) / 100,
      activeSessions: activeSessions.length,
      todaySessions: todaySessions.length,
      todayCustomers: new Set(todaySessions.map((s: any) => s.customer_id)).size,
      pendingBookings: pendingRes.count ?? 0,
      waitlistCount: waitlistRes.data?.length ?? 0,
      avgSessionMinutes,
      avgBillValue: Math.round(avgBillValue * 100) / 100,
      utilization: Array.from(utilizationMap.entries()).map(([resourceId, v]) => ({
        resourceId,
        name: v.name,
        minutes: Math.round(v.minutes),
        sessions: v.sessions,
      })),
    };

    return NextResponse.json({
      settings,
      stats,
      resources,
      sessions: activeSessions,
      sessionItems,
      waitlist: (waitlistRes.data ?? []).map(mapWaitlist),
      bookings: (bookingsRes.data ?? []).map((r: any) => mapBooking({
        ...r,
        resource_name: r.resources?.name,
        resource_type: r.resources?.type,
      })),
      rules: (rulesRes.data ?? []).map(mapPricingRule),
    });
  } catch (err) {
    console.error('dashboard error', err);
    return jsonError('Could not load the dashboard. Please refresh.', 500);
  }
}
