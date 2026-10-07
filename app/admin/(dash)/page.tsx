'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useApi, invalidate } from '@/lib/use-api';
import { useSettings } from '@/components/admin/admin-context';
import { getZonedDayStart } from '@/lib/utils/time';
import { useRealtime, useDebouncedCallback } from '@/hooks/use-realtime';
import { StatCard, EmptyState, PageHeader } from '@/components/ui/misc';
import { StatsSkeleton, CardGridSkeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { SessionCard } from '@/components/admin/session-card';
import { formatMoney, formatClock, formatDate } from '@/lib/billing/format';
import { customerLabel } from '@/components/admin/pricing-display';
import type {
  Booking, CafeSettings, DashboardStats, PricingRule, Resource,
  Session, SessionItem, WaitlistEntry,
} from '@/types';
import {
  IndianRupee, Activity, Users, CalendarCheck, Hourglass, Receipt,
  Plus, CalendarPlus, UserPlus, CupSoda, Gamepad2, MonitorPlay, ListOrdered, TrendingUp,
} from 'lucide-react';

interface DashboardData {
  settings: CafeSettings;
  stats: DashboardStats;
  resources: Resource[];
  sessions: Session[];
  sessionItems: SessionItem[];
  waitlist: WaitlistEntry[];
  bookings: Booking[];
  rules: PricingRule[];
}

export default function DashboardPage() {
  const settings = useSettings();
  const { data, error, reload } = useApi<DashboardData>('/api/admin/dashboard');

  const refetch = useDebouncedCallback(reload, 500);

  // realtime: any change to live tables refreshes the dashboard
  useRealtime('sessions', refetch);
  useRealtime('session_items', refetch);
  useRealtime('bookings', refetch);
  useRealtime('waitlist', refetch);
  useRealtime('resources', refetch);

  const onSessionChanged = useCallback(() => {
    reload();
    invalidate('/api/admin/sessions');
  }, [reload]);

  if (error && !data) {
    return (
      <EmptyState
        title="Could not load the dashboard"
        message={error.message}
        className="mt-10"
        action={
          <button onClick={() => reload()} className="text-sm font-bold text-primary hover:underline">
            Retry
          </button>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <StatsSkeleton />
        <CardGridSkeleton cards={3} />
      </div>
    );
  }

  const { stats, resources, sessions, sessionItems, waitlist, bookings, rules } = data;
  const sym = settings.currency_symbol || '₹';

  // Utilization = busy minutes today / (active resources × minutes elapsed
  // since local midnight in the cafe timezone), capped at 100%.
  const activeResourceCount = Math.max(resources.filter((r) => r.active).length, 1);
  const busyMinutes = stats.utilization.reduce((s, u) => s + u.minutes, 0);
  const elapsedMinutes = Math.max(
    (Date.now() - getZonedDayStart(settings.timezone || 'Asia/Kolkata').getTime()) / 60000,
    1
  );
  const utilizationPct = Math.min(100, Math.round((busyMinutes / (activeResourceCount * elapsedMinutes)) * 100));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${formatDate(new Date(), settings.timezone)} · live view`}
        actions={
          <>
            <Link
              href="/admin/sessions/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-glow-sm transition-transform hover:scale-[1.02]"
            >
              <Plus className="h-4 w-4" /> New Session
            </Link>
            <Link
              href="/admin/bookings?new=1"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-secondary/40 bg-secondary/10 px-4 text-sm font-bold text-secondary"
            >
              <CalendarPlus className="h-4 w-4" /> New Booking
            </Link>
          </>
        }
      />

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Today's Revenue" value={formatMoney(stats.todayRevenue, sym)} tone="success" icon={<IndianRupee className="h-4 w-4" />} />
        <StatCard label="Active Sessions" value={stats.activeSessions} tone="primary" icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Today's Sessions" value={stats.todaySessions} icon={<Gamepad2 className="h-4 w-4" />} />
        <StatCard label="Today's Customers" value={stats.todayCustomers} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Pending Bookings" value={stats.pendingBookings} tone="warning" icon={<CalendarCheck className="h-4 w-4" />} />
        <StatCard label="Waitlist" value={stats.waitlistCount} tone="warning" icon={<Hourglass className="h-4 w-4" />} />
      </div>

      {/* live resources */}
      <section aria-label="Live resources">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Live resources</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {resources.filter((r) => r.active).map((r) => (
            <ResourceMiniCard
              key={r.id}
              resource={r}
              liveSession={sessions.find((s) => s.resource_id === r.id) ?? null}
            />
          ))}
        </div>
      </section>

      {/* active sessions */}
      <section aria-label="Active sessions">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Active sessions</h2>
          <Link href="/admin/sessions" className="text-xs font-bold text-secondary hover:underline">
            View all →
          </Link>
        </div>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MonitorPlay className="h-10 w-10" />}
            title="No active sessions"
            message="Start a walk-in session or check in a booking."
            action={
              <Link href="/admin/sessions/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white">
                <Plus className="h-4 w-4" /> New Session
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                items={sessionItems}
                settings={settings}
                rules={rules}
                onChanged={onSessionChanged}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* waitlist */}
        <section aria-label="Waitlist" className="xl:col-span-1">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Queue / waitlist</h2>
          <div className="glass rounded-2xl p-4 shadow-card">
            {waitlist.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">The queue is empty</p>
            ) : (
              <ul className="space-y-2">
                {waitlist.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/15 text-xs font-extrabold text-warning">
                      {w.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{w.customer_name || 'Walk-in'}</p>
                      <p className="truncate text-xs text-muted">
                        {w.resource_name ?? w.resource_type?.replace(/_/g, ' ') ?? 'Any resource'}
                        {w.requested_duration_minutes ? ` · ${w.requested_duration_minutes} min` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/bookings" className="mt-3 block text-center text-xs font-bold text-secondary hover:underline">
              Manage queue →
            </Link>
          </div>
        </section>

        {/* recent bookings */}
        <section aria-label="Recent bookings" className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Bookings</h2>
            <Link href="/admin/bookings" className="text-xs font-bold text-secondary hover:underline">
              View all →
            </Link>
          </div>
          <div className="glass overflow-hidden rounded-2xl shadow-card">
            {bookings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No bookings today</p>
            ) : (
              <ul className="divide-y divide-border">
                {bookings.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {b.customer_name || 'Walk-in'}{' '}
                        <span className="font-normal text-muted">· {b.resource_name}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {b.booking_code} · {formatClock(b.start_time, settings.timezone)} – {formatClock(b.end_time, settings.timezone)}
                        {b.estimated_amount ? ` · est. ${formatMoney(b.estimated_amount, sym)}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* revenue breakdown */}
      <section aria-label="Today's revenue">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">Today's revenue</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Gaming" value={formatMoney(stats.gamingRevenue, sym)} icon={<Gamepad2 className="h-4 w-4" />} />
          <StatCard label="Food & Drinks" value={formatMoney(stats.foodRevenue, sym)} icon={<CupSoda className="h-4 w-4" />} />
          <StatCard label="Services" value={formatMoney(stats.serviceRevenue, sym)} icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="Total" value={formatMoney(stats.todayRevenue, sym)} tone="success" icon={<Receipt className="h-4 w-4" />} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Avg session" value={`${stats.avgSessionMinutes} min`} />
          <StatCard label="Avg bill" value={formatMoney(stats.avgBillValue, sym)} />
          <StatCard
            label="Resource utilization"
            value={`${utilizationPct}%`}
            sub="of time since midnight, all stations"
          />
          <Link href="/admin/reports" className="glass flex items-center justify-between rounded-2xl p-4 shadow-card transition-colors hover:border-secondary/40">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Reports</span>
            <ListOrdered className="h-5 w-5 text-secondary" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function ResourceMiniCard({ resource, liveSession }: { resource: Resource; liveSession: Session | null }) {
  const tone =
    resource.current_status === 'AVAILABLE'
      ? 'border-success/30'
      : resource.current_status === 'BUSY'
        ? 'border-danger/30'
        : resource.current_status === 'RESERVED'
          ? 'border-warning/30'
          : 'border-border';
  const free =
    resource.status === 'ACTIVE' && !liveSession &&
    resource.current_status !== 'BUSY' && resource.current_status !== 'MAINTENANCE';
  const href = liveSession
    ? `/admin/sessions/${liveSession.id}`
    : free
      ? `/admin/sessions/new?resourceId=${resource.id}`
      : null;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-extrabold">{resource.name}</p>
        <StatusBadge status={resource.current_status} />
      </div>
      <p className="mt-1 text-xs text-muted">{resource.type.replace(/_/g, ' ')}</p>
      {resource.status === 'MAINTENANCE' && (
        <p className="mt-2 text-xs font-semibold text-warning">Under maintenance</p>
      )}
      {liveSession ? (
        <p className="mt-2 truncate text-xs font-bold text-secondary">{customerLabel(liveSession)} · open timer →</p>
      ) : free ? (
        <p className="mt-2 text-xs font-bold text-primary">Start timer →</p>
      ) : null}
    </>
  );
  const cls = `glass block rounded-2xl border-l-4 p-4 shadow-card ${tone}`;
  return href ? (
    <Link href={href} className={`${cls} transition-shadow hover:shadow-glow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
