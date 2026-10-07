'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { useNow } from '@/hooks/use-now';
import { cn } from '@/lib/utils/misc';
import { formatClock } from '@/lib/billing/format';
import { Logo } from '@/components/ui/logo';
import type { CafeSettings, Profile } from '@/types';
import { AdminProvider, useAdmin } from './admin-context';
import {
  LayoutDashboard, Gamepad2, CalendarCheck, Users, Monitor, CupSoda,
  Sparkles, Tag, Receipt, CreditCard, BarChart3, Settings, LogOut,
  Menu, X, UserCircle, Plus, Wallet,
} from 'lucide-react';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, admin: false },
  { href: '/admin/sessions', label: 'Live Sessions', icon: Gamepad2, admin: false },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck, admin: false },
  { href: '/admin/customers', label: 'Customers', icon: Users, admin: false },
  { href: '/admin/resources', label: 'Resources', icon: Monitor, admin: false },
  { href: '/admin/items', label: 'Items', icon: CupSoda, admin: false },
  { href: '/admin/services', label: 'Games & Services', icon: Sparkles, admin: false },
  { href: '/admin/pricing', label: 'Pricing', icon: Tag, admin: false },
  { href: '/admin/invoices', label: 'Invoices', icon: Receipt, admin: false },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard, admin: false },
  { href: '/admin/finance', label: 'Income & Expenses', icon: Wallet, admin: false, manager: true },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, admin: false, manager: true },
  { href: '/admin/settings', label: 'Settings', icon: Settings, admin: true },
];

const MOBILE_NAV = [
  { href: '/admin', label: 'Home', icon: LayoutDashboard },
  { href: '/admin/sessions', label: 'Sessions', icon: Gamepad2 },
  { href: '/admin/sessions/new', label: 'New', icon: Plus, highlight: true },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
];

export function AdminShell({
  profile,
  settings,
  children,
}: {
  profile: Profile;
  settings: CafeSettings;
  children: ReactNode;
}) {
  return (
    <AdminProvider settings={settings} profile={profile}>
      <ShellFrame>{children}</ShellFrame>
    </AdminProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { settings, profile } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();
  const now = useNow(1000);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = profile.role === 'ADMIN';

  const isManager = isAdmin || profile.role === 'MANAGER';
  const nav = NAV.filter((n) => (!n.admin || isAdmin) && (!('manager' in n) || isManager));
  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  async function logout() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <Logo className="h-11 w-auto shrink-0 shadow-glow-sm" alt={settings.cafe_name || 'Gaming Cafe'} />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold tracking-tight">{settings.cafe_name}</p>
          <p className="text-[11px] font-medium text-muted">Management Console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Admin navigation">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setDrawerOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
              isActive(item.href)
                ? 'bg-primary/15 text-primary shadow-glow-sm'
                : 'text-muted hover:bg-surface-2 hover:text-content'
            )}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            <item.icon className="h-[18px] w-[18px]" aria-hidden />
            {item.label}
          </Link>
        ))}
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
          Logout
        </button>
      </nav>

      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-3">
            <UserCircle className="h-5 w-5 text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{profile.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{profile.role}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface/60 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="glass absolute inset-y-0 left-0 w-72 animate-slide-up border-r border-border">
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-muted hover:bg-surface-2"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href="/admin/sessions/new"
            className="hidden items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-white shadow-glow-sm transition-transform hover:scale-[1.02] active:scale-95 sm:inline-flex"
          >
            <Plus className="h-4 w-4" aria-hidden /> New Session
          </Link>
          <div className="flex-1" />
          <div className="hidden items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 sm:flex" aria-live="off">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse-dot" aria-hidden />
            <span className="font-mono text-sm font-bold tabular-nums text-content">
              {now ? formatClock(now, settings.timezone) : '--:--'}
            </span>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
            {profile.role}
          </span>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 sm:pb-8 lg:px-8">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
        aria-label="Primary"
      >
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide',
              isActive(item.href) ? 'text-primary' : 'text-muted',
              item.highlight && 'text-primary'
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full',
                item.highlight && 'bg-primary text-white shadow-glow-sm'
              )}
            >
              <item.icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {item.label}
          </Link>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full">
            <Menu className="h-[18px] w-[18px]" aria-hidden />
          </span>
          More
        </button>
      </nav>
    </div>
  );
}
