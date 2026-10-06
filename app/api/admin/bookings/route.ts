import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, pageParams } from '@/lib/supabase/api';
import { getCachedSettings } from '@/lib/supabase/settings-cache';
import { getZonedDayStart } from '@/lib/utils/time';
import { mapBooking } from '@/lib/mappers';
import { adminBookingSchema } from '@/lib/validations/schemas';
import { toIsoOrNull } from '@/lib/utils/misc';

export const dynamic = 'force-dynamic';

/** GET /api/admin/bookings?status=&upcoming=1&date=YYYY-MM-DD&limit=&offset= */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const upcoming = params.get('upcoming');
  const date = params.get('date');
  const { limit, offset } = pageParams(req, 50, 200);

  let query = admin
    .from('bookings')
    .select('*, resources(name, type)', { count: 'exact' })
    .order('start_time', { ascending: upcoming === '1' || !!date })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (upcoming === '1') query = query.gte('start_time', new Date().toISOString());
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // whole local day in the cafe timezone
    const { timezone } = await getCachedSettings(admin);
    const dayStart = getZonedDayStart(timezone, new Date(`${date}T12:00:00Z`));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    query = query.gte('start_time', dayStart.toISOString()).lt('start_time', dayEnd.toISOString());
  }

  const { data, error, count } = await query;
  if (error) return jsonError(friendlyError(error), 400);

  const bookings = (data ?? []).map((r: any) =>
    mapBooking({
      ...r,
      resource_name: r.resources?.name,
      resource_type: r.resources?.type,
    })
  );
  return NextResponse.json({ bookings, total: count ?? 0 });
}

/** POST /api/admin/bookings — create a booking for a customer */
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

  const parsed = adminBookingSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid booking');
  const input = parsed.data;

  const startTime = toIsoOrNull(input.startTime);
  if (!startTime) return jsonError('Invalid start time');

  const { data: result, error } = await admin.rpc('admin_create_booking', {
    p_customer_id: input.customerId,
    p_resource_id: input.resourceId,
    p_start_time: startTime,
    p_duration_minutes: input.durationMinutes,
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_acting_user: userId,
  });
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, 'booking.created', 'booking', result?.id, {
    code: result?.booking_code,
    startTime,
    durationMinutes: input.durationMinutes,
  });

  return NextResponse.json(result);
}
