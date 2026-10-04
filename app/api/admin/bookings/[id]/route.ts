import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { mapBooking } from '@/lib/mappers';
import { bookingStatusSchema, rescheduleSchema } from '@/lib/validations/schemas';
import { toIsoOrNull } from '@/lib/utils/misc';

export const dynamic = 'force-dynamic';

const ACTIONS: Record<string, string> = {
  confirm: 'CONFIRMED',
  cancel: 'CANCELLED',
  'no-show': 'NO_SHOW',
};

/** PATCH /api/admin/bookings/[id] — { action: confirm|cancel|no-show|reschedule|check-in } */
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

  if (action === 'check-in') {
    const { data: sessionId, error } = await admin.rpc('admin_check_in_booking', {
      p_booking_id: params.id,
      p_acting_user: userId,
    });
    if (error) return jsonError(friendlyError(error), 400);
    await audit(admin, userId, 'booking.checked_in', 'booking', params.id, { sessionId });
    return NextResponse.json({ sessionId });
  }

  if (action === 'reschedule') {
    const parsed = rescheduleSchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid reschedule');
    const startTime = toIsoOrNull(parsed.data.startTime);
    if (!startTime) return jsonError('Invalid start time');
    const { error } = await admin.rpc('admin_reschedule_booking', {
      p_booking_id: params.id,
      p_new_start: startTime,
      p_duration_minutes: parsed.data.durationMinutes ?? null,
    });
    if (error) return jsonError(friendlyError(error), 400);
    await audit(admin, userId, 'booking.rescheduled', 'booking', params.id, {
      startTime,
      durationMinutes: parsed.data.durationMinutes,
    });
  } else {
    const status = ACTIONS[action];
    if (!status) return jsonError('Unknown action');
    const parsed = bookingStatusSchema.safeParse({ status });
    if (!parsed.success) return jsonError('Invalid status');
    const { error } = await admin.rpc('admin_update_booking_status', {
      p_booking_id: params.id,
      p_status: status,
    });
    if (error) return jsonError(friendlyError(error), 400);
    await audit(admin, userId, 'booking.status_changed', 'booking', params.id, { status });
  }

  const { data } = await admin
    .from('bookings')
    .select('*, resources(name, type)')
    .eq('id', params.id)
    .single();
  return NextResponse.json({
    booking: mapBooking({
      ...(data ?? {}),
      resource_name: data?.resources?.name,
      resource_type: data?.resources?.type,
    }),
  });
}
