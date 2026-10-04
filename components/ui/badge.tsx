import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/misc';

export type BadgeTone =
  | 'green' | 'red' | 'amber' | 'cyan' | 'violet' | 'zinc' | 'blue';

const tones: Record<BadgeTone, string> = {
  green: 'bg-success/15 text-success border-success/30',
  red: 'bg-danger/15 text-danger border-danger/30',
  amber: 'bg-warning/15 text-warning border-warning/30',
  cyan: 'bg-secondary/15 text-secondary border-secondary/30',
  violet: 'bg-primary/15 text-primary border-primary/30',
  zinc: 'bg-surface-3 text-muted border-border-strong',
  blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

export function Badge({
  tone = 'zinc',
  className,
  dot,
  pulse,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        tones[tone],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulse-dot')}
          aria-hidden
        />
      )}
      {props.children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  AVAILABLE: 'green',
  BUSY: 'red',
  RESERVED: 'amber',
  MAINTENANCE: 'zinc',
  ACTIVE: 'green',
  PAUSED: 'amber',
  SCHEDULED: 'cyan',
  COMPLETED: 'zinc',
  CANCELLED: 'red',
  PENDING: 'amber',
  CONFIRMED: 'cyan',
  CHECKED_IN: 'violet',
  NO_SHOW: 'red',
  WAITING: 'amber',
  NOTIFIED: 'cyan',
  ASSIGNED: 'violet',
  EXPIRED: 'zinc',
  PAID: 'green',
  ISSUED: 'amber',
  PARTIAL: 'amber',
  VOID: 'red',
  REFUNDED: 'zinc',
  PUBLIC: 'cyan',
  ADMIN: 'violet',
};

export function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const tone = STATUS_TONES[status] ?? 'zinc';
  return (
    <Badge tone={tone} dot pulse={pulse}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
