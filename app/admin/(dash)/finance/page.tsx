'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { api } from '@/lib/api-client';
import { useApi, invalidate } from '@/lib/use-api';
import { useAdmin } from '@/components/admin/admin-context';
import { PageHeader, StatCard, EmptyState, ErrorState } from '@/components/ui/misc';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Field, Select } from '@/components/ui/input';
import { Modal, ConfirmDialog } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/billing/format';
import { zonedDateKey } from '@/lib/utils/time';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES,
  type LedgerEntry, type LedgerEntryType, type LedgerSummary, type PaymentMethod,
} from '@/types';
import {
  Wallet, TrendingUp, TrendingDown, Plus, Minus, Pencil, Trash2, Gamepad2, PiggyBank, ShieldAlert,
} from 'lucide-react';

interface LedgerResponse {
  entries: LedgerEntry[];
  summary: LedgerSummary;
}

type RangeId = 'today' | 'week' | 'month' | 'last_month' | 'custom';

const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
  { id: 'OTHER', label: 'Other' },
];

// ---- date-key helpers (pure YYYY-MM-DD arithmetic in UTC, no tz drift) ----
const keyToDate = (k: string) => new Date(`${k}T00:00:00Z`);
const dateToKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (k: string, n: number) => dateToKey(new Date(keyToDate(k).getTime() + n * 86_400_000));

function rangeFor(id: RangeId, today: string): { from: string; to: string } {
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dow = keyToDate(today).getUTCDay(); // 0 = Sun
      return { from: addDays(today, -((dow + 6) % 7)), to: today }; // week starts Monday
    }
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    case 'month':
    default:
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

function fmtDay(k: string, withYear = true): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(keyToDate(k));
  } catch {
    return k;
  }
}

export default function FinancePage() {
  const { settings, profile } = useAdmin();
  const toast = useToast();
  const tz = settings.timezone;
  const sym = settings.currency_symbol || '₹';
  const today = zonedDateKey(new Date(), tz);
  const allowed = profile.role === 'ADMIN' || profile.role === 'MANAGER';

  const [rangeId, setRangeId] = useState<RangeId>('month');
  const [custom, setCustom] = useState(() => rangeFor('month', today));
  const { from, to } = rangeId === 'custom' ? custom : rangeFor(rangeId, today);
  const key = allowed ? `/api/admin/ledger?from=${from}&to=${to}` : null;
  const { data, error, reload, mutate } = useApi<LedgerResponse>(key);

  const [modal, setModal] = useState<{ type: LedgerEntryType; entry?: LedgerEntry } | null>(null);
  const [toDelete, setToDelete] = useState<LedgerEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-10 w-10" />}
        title="Managers only"
        message="Income & expenses are visible to admins and managers."
        className="mt-10"
      />
    );
  }

  const summary = data?.summary;
  const entries = data?.entries ?? null;

  const inRange = (d: string) => d >= from && d <= to;

  /** Optimistically apply a change to the cached list + headline totals. */
  function applyLocal(remove: LedgerEntry | null, add: LedgerEntry | null) {
    mutate((prev) => {
      if (!prev) return prev;
      let list = prev.entries;
      const s = { ...prev.summary };
      const adj = (e: LedgerEntry, sign: 1 | -1) => {
        if (!inRange(e.entry_date)) return;
        if (e.entry_type === 'INCOME') s.otherIncome += sign * e.amount;
        else s.expenses += sign * e.amount;
      };
      if (remove) {
        list = list.filter((e) => e.id !== remove.id);
        adj(remove, -1);
      }
      if (add && inRange(add.entry_date)) {
        list = [add, ...list].sort((a, b) =>
          a.entry_date === b.entry_date ? b.created_at.localeCompare(a.created_at) : b.entry_date.localeCompare(a.entry_date)
        );
        adj(add, 1);
      }
      s.totalIncome = s.sessionIncome + s.otherIncome;
      s.net = s.totalIncome - s.expenses;
      return { entries: list, summary: s };
    });
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const entry = toDelete;
    setDeleting(true);
    try {
      await api.delete(`/api/admin/ledger/${entry.id}`);
      applyLocal(entry, null);
      invalidate('/api/admin/ledger');
      toast.success('Entry deleted');
      setToDelete(null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete entry');
    } finally {
      setDeleting(false);
    }
  }

  const expenseCats = (summary?.byCategory ?? [])
    .filter((c) => c.entry_type === 'EXPENSE' && c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const incomeCats = (summary?.byCategory ?? [])
    .filter((c) => c.entry_type === 'INCOME' && c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return (
    <div>
      <PageHeader
        title="Income & Expenses"
        subtitle={from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`}
        actions={
          <>
            <Button variant="success" onClick={() => setModal({ type: 'INCOME' })}>
              <Plus className="h-4 w-4" /> Add income
            </Button>
            <Button variant="danger" onClick={() => setModal({ type: 'EXPENSE' })}>
              <Minus className="h-4 w-4" /> Add expense
            </Button>
          </>
        }
      />

      {/* range picker */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex overflow-x-auto rounded-xl border border-border bg-surface-2 p-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                if (r.id === 'custom' && rangeId !== 'custom') setCustom({ from, to });
                setRangeId(r.id);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${
                rangeId === r.id ? 'bg-primary text-white' : 'text-muted hover:text-content'
              }`}
              aria-pressed={rangeId === r.id}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeId === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
              aria-label="From date"
              className="h-9 w-auto py-1 text-sm"
            />
            <span className="text-sm text-muted">to</span>
            <Input
              type="date"
              value={custom.to}
              min={custom.from}
              onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
              aria-label="To date"
              className="h-9 w-auto py-1 text-sm"
            />
          </div>
        )}
      </div>

      {error && !data ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : !data || !summary || !entries ? (
        <ListSkeleton rows={8} />
      ) : (
        <div className="space-y-6">
          {/* summary tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Session income" value={formatMoney(summary.sessionIncome, sym)} icon={<Gamepad2 className="h-4 w-4" />} sub="Payments received" />
            <StatCard label="Other income" value={formatMoney(summary.otherIncome, sym)} icon={<PiggyBank className="h-4 w-4" />} sub="Manual entries" />
            <StatCard label="Total income" value={formatMoney(summary.totalIncome, sym)} tone="success" icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard label="Expenses" value={formatMoney(summary.expenses, sym)} tone="danger" icon={<TrendingDown className="h-4 w-4" />} />
            <div className="col-span-2 lg:col-span-1">
              <StatCard
                label="Net profit"
                value={`${summary.net < 0 ? '−' : ''}${formatMoney(Math.abs(summary.net), sym)}`}
                tone={summary.net >= 0 ? 'success' : 'danger'}
                icon={<Wallet className="h-4 w-4" />}
                sub={summary.net >= 0 ? 'Profit' : 'Loss'}
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* chart */}
            <section className="glass rounded-2xl p-5 shadow-card lg:col-span-2" aria-label="Income vs expenses chart">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted">Income vs expenses by day</h2>
              {summary.daily.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">No data for this period</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={summary.daily.map((d) => ({ ...d, label: fmtDay(d.date, false) }))}
                      margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                      <XAxis dataKey="label" stroke="#A1A1AA" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                      <YAxis stroke="#A1A1AA" fontSize={11} tickLine={false} width={48} />
                      <Tooltip
                        contentStyle={{ background: '#18181B', border: '1px solid #3F3F46', borderRadius: 12, color: '#FAFAFA' }}
                        formatter={(v: number, name: string) => [formatMoney(v, sym), name === 'income' ? 'Income' : 'Expenses']}
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      />
                      <Legend
                        formatter={(v: string) => (v === 'income' ? 'Income' : 'Expenses')}
                        wrapperStyle={{ fontSize: 12, color: '#A1A1AA' }}
                      />
                      <Bar dataKey="income" fill="#22C55E" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* category breakdown */}
            <section className="glass rounded-2xl p-5 shadow-card" aria-label="Expenses by category">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Expenses by category</h2>
              {expenseCats.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">No expenses in this period</p>
              ) : (
                <ul className="space-y-3">
                  {expenseCats.map((c) => (
                    <li key={c.category}>
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate font-semibold">{c.category}</span>
                        <span className="font-bold tabular-nums">{formatMoney(c.amount, sym)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-danger/80"
                          style={{ width: `${summary.expenses > 0 ? Math.max((c.amount / summary.expenses) * 100, 2) : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {incomeCats.length > 0 && (
                <>
                  <h2 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wider text-muted">Other income</h2>
                  <ul className="space-y-2">
                    {incomeCats.map((c) => (
                      <li key={c.category} className="flex justify-between gap-2 text-sm">
                        <span className="truncate font-semibold">{c.category}</span>
                        <span className="font-bold tabular-nums text-success">{formatMoney(c.amount, sym)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          {/* entries */}
          <section aria-label="Entries">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">
              Entries <span className="font-semibold normal-case tracking-normal">({entries.length})</span>
            </h2>
            {entries.length === 0 ? (
              <EmptyState
                icon={<Wallet className="h-10 w-10" />}
                title="No entries yet"
                message="Add expenses like rent, electricity or stock, and income like tournaments. Session payments are counted automatically."
                action={
                  <Button size="sm" variant="danger" onClick={() => setModal({ type: 'EXPENSE' })}>
                    <Minus className="h-4 w-4" /> Add expense
                  </Button>
                }
              />
            ) : (
              <ul className="glass divide-y divide-border rounded-2xl shadow-card">
                {entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:flex-nowrap">
                    <div className="w-[88px] shrink-0 text-xs text-muted">{fmtDay(e.entry_date)}</div>
                    <Badge tone={e.entry_type === 'INCOME' ? 'green' : 'red'}>
                      {e.entry_type === 'INCOME' ? 'Income' : 'Expense'}
                    </Badge>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate font-semibold">{e.category}</p>
                      <p className="truncate text-xs text-muted">
                        {[e.description, e.payment_method, e.created_by_name ? `by ${e.created_by_name}` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                    </div>
                    <span
                      className={`ml-auto font-bold tabular-nums ${e.entry_type === 'INCOME' ? 'text-success' : 'text-danger'}`}
                    >
                      {e.entry_type === 'INCOME' ? '+' : '−'}
                      {formatMoney(e.amount, sym)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => setModal({ type: e.entry_type, entry: e })}
                        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-content"
                        aria-label={`Edit ${e.category} entry`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setToDelete(e)}
                        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label={`Delete ${e.category} entry`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <EntryModal
        state={modal}
        today={today}
        sym={sym}
        profileName={profile.name}
        onClose={() => setModal(null)}
        onSaved={(prev, next) => {
          applyLocal(prev, next);
          invalidate('/api/admin/ledger');
        }}
        onFailed={() => invalidate('/api/admin/ledger')}
      />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete entry"
        message={
          toDelete
            ? `Delete this ${toDelete.entry_type === 'INCOME' ? 'income' : 'expense'} of ${formatMoney(toDelete.amount, sym)} (${toDelete.category})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </div>
  );
}

const OTHER = '__other__';

function EntryModal({
  state, today, sym, profileName, onClose, onSaved, onFailed,
}: {
  state: { type: LedgerEntryType; entry?: LedgerEntry } | null;
  today: string;
  sym: string;
  profileName: string;
  onClose: () => void;
  /** prev = entry being replaced (edit) or temp entry (add); next = saved/optimistic entry */
  onSaved: (prev: LedgerEntry | null, next: LedgerEntry | null) => void;
  onFailed: () => void;
}) {
  const toast = useToast();
  const type = state?.type ?? 'EXPENSE';
  const editing = state?.entry;
  const presets = useMemo(
    () => (type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).filter((c) => c !== 'Other') as string[],
    [type]
  );

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state) return;
    const e = state.entry;
    setErr(null);
    if (e) {
      setAmount(String(e.amount));
      if (presets.includes(e.category)) {
        setCategory(e.category);
        setCustomCategory('');
      } else {
        setCategory(OTHER);
        setCustomCategory(e.category === 'Other' ? '' : e.category);
      }
      setDate(e.entry_date);
      setMethod(e.payment_method ?? 'CASH');
      setNote(e.description ?? '');
    } else {
      setAmount('');
      setCategory(presets[0] ?? OTHER);
      setCustomCategory('');
      setDate(today);
      setMethod('CASH');
      setNote('');
    }
    // autofocus after the portal mounts
    const t = setTimeout(() => amountRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [state, presets, today, type]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Enter an amount greater than 0');
      amountRef.current?.focus();
      return;
    }
    const cat = (category === OTHER ? customCategory.trim() || 'Other' : category).slice(0, 60);
    const body = {
      entryType: type,
      category: cat,
      amount: Math.round(amt * 100) / 100,
      entryDate: date || today,
      paymentMethod: method,
      description: note.trim() || null,
    };
    setBusy(true);
    try {
      if (editing) {
        const res = await api.patch<{ entry: LedgerEntry }>(`/api/admin/ledger/${editing.id}`, body);
        onSaved(editing, res.entry);
        toast.success('Entry updated');
        onClose();
      } else {
        // optimistic: show it immediately, swap for the real row when saved
        const temp: LedgerEntry = {
          id: `temp-${Date.now()}`,
          entry_type: type,
          category: body.category,
          amount: body.amount,
          entry_date: body.entryDate,
          payment_method: body.paymentMethod,
          description: body.description,
          created_by: null,
          created_by_name: profileName,
          created_at: new Date().toISOString(),
        };
        onSaved(null, temp);
        onClose();
        try {
          const res = await api.post<{ entry: LedgerEntry }>('/api/admin/ledger', body);
          onSaved(temp, res.entry);
          toast.success(type === 'INCOME' ? 'Income added' : 'Expense added');
        } catch (e: any) {
          onSaved(temp, null);
          onFailed();
          toast.error(e?.message || 'Could not save entry');
        }
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not save entry');
    } finally {
      setBusy(false);
    }
  }

  const isIncome = type === 'INCOME';
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} ${isIncome ? 'income' : 'expense'}`}
      size="sm"
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label={`Amount (${sym})`} required error={err}>
          <Input
            ref={amountRef}
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setErr(null);
            }}
            placeholder="0"
            className="text-lg font-bold"
            invalid={!!err}
            autoFocus
            required
          />
        </Field>
        <Field label="Category" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {presets.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </Select>
        </Field>
        {category === OTHER && (
          <Field label="Other category">
            <Input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder={isIncome ? 'e.g. Sponsorship' : 'e.g. Cleaning'}
              maxLength={60}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Note (optional)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isIncome ? 'e.g. FIFA tournament entry fees' : 'e.g. October electricity bill'}
            maxLength={500}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={isIncome ? 'success' : 'danger'} loading={busy}>
            {editing ? 'Save changes' : isIncome ? 'Add income' : 'Add expense'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
