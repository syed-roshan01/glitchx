import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, jsonError, friendlyError, audit } from '@/lib/supabase/api';
import { getCachedSettings } from '@/lib/supabase/settings-cache';
import { getZonedDayStart, zonedDateKey } from '@/lib/utils/time';
import { ledgerEntrySchema } from '@/lib/validations/schemas';
import { mapLedgerEntry } from '@/lib/mappers';
import type { LedgerSummary } from '@/types';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** GET /api/admin/ledger?from=YYYY-MM-DD&to=YYYY-MM-DD (cafe-local, inclusive; default this month) */
export async function GET(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const { admin } = ctx;

  const { timezone } = await getCachedSettings(admin);
  const today = zonedDateKey(new Date(), timezone);
  const qs = req.nextUrl.searchParams;
  let from = isDate(qs.get('from')) ? qs.get('from')! : `${today.slice(0, 8)}01`;
  let to = isDate(qs.get('to')) ? qs.get('to')! : today;
  if (from > to) [from, to] = [to, from];

  // UTC instants for the cafe-local day boundaries
  const startUtc = getZonedDayStart(timezone, new Date(`${from}T12:00:00Z`));
  const endUtc = new Date(getZonedDayStart(timezone, new Date(`${to}T12:00:00Z`)).getTime() + DAY_MS);

  const [entriesRes, paymentsRes] = await Promise.all([
    admin
      .from('ledger_entries')
      .select('*, profiles(name)')
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false }),
    admin
      .from('payments')
      .select('amount, paid_at')
      .eq('payment_status', 'PAID')
      .gte('paid_at', startUtc.toISOString())
      .lt('paid_at', endUtc.toISOString()),
  ]);
  if (entriesRes.error) return jsonError(friendlyError(entriesRes.error), 400);
  if (paymentsRes.error) return jsonError(friendlyError(paymentsRes.error), 400);

  const entries = (entriesRes.data ?? []).map((r: any) =>
    mapLedgerEntry({ ...r, created_by_name: r.profiles?.name ?? null })
  );

  // daily series (every day in range, even empty ones)
  const daily = new Map<string, { date: string; income: number; expense: number }>();
  for (let t = startUtc.getTime() + 12 * 3600_000; t < endUtc.getTime(); t += DAY_MS) {
    const k = zonedDateKey(new Date(t), timezone);
    if (!daily.has(k)) daily.set(k, { date: k, income: 0, expense: 0 });
  }
  const bump = (date: string, field: 'income' | 'expense', amt: number) => {
    const d = daily.get(date) ?? { date, income: 0, expense: 0 };
    d[field] += amt;
    daily.set(date, d);
  };

  let sessionIncome = 0;
  for (const p of paymentsRes.data ?? []) {
    const amt = Number(p.amount);
    sessionIncome += amt;
    bump(zonedDateKey(new Date(p.paid_at), timezone), 'income', amt);
  }

  let otherIncome = 0;
  let expenses = 0;
  const cats = new Map<string, { entry_type: 'INCOME' | 'EXPENSE'; category: string; amount: number }>();
  for (const e of entries) {
    if (e.entry_type === 'INCOME') otherIncome += e.amount;
    else expenses += e.amount;
    bump(e.entry_date, e.entry_type === 'INCOME' ? 'income' : 'expense', e.amount);
    const key = `${e.entry_type}:${e.category}`;
    const c = cats.get(key) ?? { entry_type: e.entry_type, category: e.category, amount: 0 };
    c.amount += e.amount;
    cats.set(key, c);
  }

  const summary: LedgerSummary = {
    sessionIncome: r2(sessionIncome),
    otherIncome: r2(otherIncome),
    totalIncome: r2(sessionIncome + otherIncome),
    expenses: r2(expenses),
    net: r2(sessionIncome + otherIncome - expenses),
    byCategory: Array.from(cats.values())
      .map((c) => ({ ...c, amount: r2(c.amount) }))
      .sort((a, b) => b.amount - a.amount),
    daily: Array.from(daily.values())
      .map((d) => ({ ...d, income: r2(d.income), expense: r2(d.expense) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };

  return NextResponse.json({ entries, summary, from, to });
}

/** POST /api/admin/ledger — add an income or expense entry */
export async function POST(req: NextRequest) {
  const { ctx, response } = await requireAuth(['ADMIN', 'MANAGER']);
  if (!ctx) return response!;
  const { admin, userId } = ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request body');
  }
  const parsed = ledgerEntrySchema.safeParse({ ...body, amount: Number(body?.amount) });
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Invalid entry');
  const input = parsed.data;

  const { data, error } = await admin
    .from('ledger_entries')
    .insert({
      entry_type: input.entryType,
      category: input.category,
      amount: input.amount,
      entry_date: input.entryDate,
      payment_method: input.paymentMethod ?? null,
      description: input.description || null,
      created_by: userId,
    })
    .select('*, profiles(name)')
    .single();
  if (error) return jsonError(friendlyError(error), 400);

  await audit(admin, userId, `ledger.${input.entryType.toLowerCase()}_added`, 'ledger_entry', data.id, {
    category: input.category,
    amount: input.amount,
  });
  return NextResponse.json({ entry: mapLedgerEntry({ ...data, created_by_name: data.profiles?.name ?? null }) });
}
