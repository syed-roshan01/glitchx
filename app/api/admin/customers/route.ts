import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit, searchTerm, pageParams } from '@/lib/supabase/api';
import { mapCustomer } from '@/lib/mappers';
import { customerSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/admin/customers?q=&limit=&offset= — search by name/mobile */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth();
  if (!ctx) return response!;
  const { admin } = ctx;

  const q = searchTerm(req.nextUrl.searchParams.get('q'));
  const { limit, offset } = pageParams(req, 25, 100);

  let query = admin
    .from('customers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    // mobile is indexed; name search via ilike
    query = query.or(`name.ilike.%${q}%,mobile.ilike.%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) return jsonError(friendlyError(error), 400);
  return NextResponse.json({ customers: (data ?? []).map(mapCustomer), total: count ?? 0 });
}

/** POST /api/admin/customers — add a customer */
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

  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid customer');
  const input = parsed.data;

  // upsert by mobile to avoid duplicates
  const { data: existing } = await admin
    .from('customers')
    .select('id')
    .eq('mobile', input.mobile)
    .maybeSingle();

  if (existing) {
    return jsonError('A customer with this mobile number already exists', 409);
  }

  const { data, error } = await admin
    .from('customers')
    .insert({
      name: input.name,
      mobile: input.mobile,
      email: input.email || null,
      notes: input.notes ?? null,
      created_by: userId,
    })
    .select()
    .single();
  if (error) {
    if ((error.message ?? '').includes('customers_mobile_unique')) {
      return jsonError('A customer with this mobile number already exists', 409);
    }
    return jsonError(friendlyError(error), 400);
  }

  await audit(admin, userId, 'customer.created', 'customer', data.id, { name: input.name });
  return NextResponse.json({ customer: mapCustomer(data) });
}
