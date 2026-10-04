import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, audit } from '@/lib/supabase/api';
import { invalidateCachedSettings } from '@/lib/supabase/settings-cache';
import { mapSettings } from '@/lib/mappers';
import { settingsSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const { data, error } = await admin.from('settings').select('*').eq('id', 'default').single();
  if (error || !data) return jsonError('Settings not found', 500);
  return NextResponse.json({ settings: mapSettings(data) });
}

/** PUT /api/admin/settings — admin only */
export async function PUT(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid settings');
  const s = parsed.data;

  const { data, error } = await admin
    .from('settings')
    .update({
      cafe_name: s.cafe_name,
      logo_url: s.logo_url || null,
      address: s.address || null,
      phone: s.phone || null,
      email: s.email || null,
      gstin: s.gstin || null,
      currency: s.currency,
      currency_symbol: s.currency_symbol,
      timezone: s.timezone,
      invoice_prefix: s.invoice_prefix.toUpperCase(),
      tax_enabled: s.tax_enabled,
      tax_name: s.tax_name || null,
      tax_rate: s.tax_rate ?? 0,
      billing_mode: s.billing_mode,
      min_billing_minutes: s.min_billing_minutes,
      pause_enabled: s.pause_enabled,
      allow_public_bookings: s.allow_public_bookings,
      waitlist_enabled: s.waitlist_enabled,
      booking_max_days_ahead: s.booking_max_days_ahead,
    })
    .eq('id', 'default')
    .select()
    .single();
  if (error) return jsonError('Could not save settings', 400);

  invalidateCachedSettings();
  await audit(admin, userId, 'settings.updated', 'settings', 'default', {
    billing_mode: s.billing_mode,
    tax_enabled: s.tax_enabled,
  });
  return NextResponse.json({ settings: mapSettings(data) });
}

/** POST /api/admin/settings — mark onboarding complete */
export async function POST(_req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  const { data, error } = await admin
    .from('settings')
    .update({ setup_completed_at: new Date().toISOString() })
    .eq('id', 'default')
    .select()
    .single();
  if (error) return jsonError('Could not update settings', 400);

  await audit(admin, userId, 'settings.setup_completed', 'settings', 'default');
  return NextResponse.json({ settings: mapSettings(data) });
}
