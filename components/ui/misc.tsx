import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/misc';

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong/60 px-6 py-12 text-center',
        className
      )}
    >
      {icon && <div className="mb-3 text-muted/60">{icon}</div>}
      <h3 className="text-sm font-bold text-content">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary' | 'secondary';
}) {
  const tones = {
    default: 'text-content',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    primary: 'text-primary',
    secondary: 'text-secondary',
  };
  return (
    <div className="glass rounded-2xl p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        {icon && <span className="text-muted/70">{icon}</span>}
      </div>
      <p className={cn('mt-1.5 truncate text-xl font-extrabold tabular-nums sm:text-2xl', tones[tone])}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary',
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-danger/40 px-6 py-10 text-center',
        className
      )}
      role="alert"
    >
      <h3 className="text-sm font-bold text-danger">Couldn’t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{message || 'Something went wrong.'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 h-9 rounded-xl border border-border-strong px-4 text-sm font-semibold text-content hover:bg-surface-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}
