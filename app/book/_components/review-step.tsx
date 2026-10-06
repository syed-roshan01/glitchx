'use client';

import type { ReactNode } from 'react';
import { LoaderCircle, Pencil } from 'lucide-react';
import type { AvailabilityRow } from '@/types';
import { formatClock, formatMoney } from '@/lib/billing/format';
import { durationLabel, instantDayLabel, MINUTE, type DayKey } from './tz';
import { StationIcon, StepHeader, typeLabel } from './primitives';
import type { Step } from './types';

function Row({ label, children, onEdit, editLabel }: { label: string; children: ReactNode; onEdit?: () => void; editLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0">
        <dt className="font-hud text-[10px] font-bold uppercase tracking-[0.22em] text-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-[15px] font-semibold">{children}</dd>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-content"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function ReviewStep({
  resource,
  tz,
  todayKey,
  start,
  startIsNow,
  duration,
  name,
  mobile,
  notes,
  estimate,
  estimating,
  sym,
  error,
  onEdit,
  onBack,
}: {
  resource: AvailabilityRow;
  tz: string;
  todayKey: DayKey;
  start: number;
  startIsNow: boolean;
  duration: number;
  name: string;
  mobile: string;
  notes: string;
  estimate: number | null;
  estimating: boolean;
  sym: string;
  error: string | null;
  onEdit: (s: Step) => void;
  onBack: () => void;
}) {
  const end = start + duration * MINUTE;
  return (
    <div>
      <StepHeader index={4} total={4} kicker="04 / Confirm" title="Ready, player?" subtitle="Check the details, then lock it in." onBack={onBack} />

      <div aria-live="assertive" className="empty:hidden">
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="glass hud rounded-lg p-4">
        <div className="mb-1 flex items-center gap-3 border-b border-border/60 pb-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/25 to-secondary/20 text-primary">
            <StationIcon type={resource.resource_type} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-hud text-base font-bold uppercase tracking-wider">{resource.name}</p>
            <p className="text-xs text-muted">
              {typeLabel(resource.resource_type)}
              {resource.rate_label ? ` · ${resource.rate_label}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEdit('station')}
            aria-label="Change station"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-content"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <dl>
          <Row label="When" onEdit={() => onEdit('when')} editLabel="Change date or time">
            {startIsNow ? 'Today, starting now' : instantDayLabel(start, tz, todayKey)}
            <span className="block text-sm font-normal text-muted">
              {formatClock(start, tz)} – {formatClock(end, tz)} · {durationLabel(duration)}
            </span>
          </Row>
          <Row label="Player" onEdit={() => onEdit('details')} editLabel="Edit your details">
            {name.trim()}
            <span className="block text-sm font-normal text-muted">{mobile.trim()}</span>
          </Row>
          {notes.trim() && (
            <Row label="Notes" onEdit={() => onEdit('details')} editLabel="Edit notes">
              <span className="font-normal">{notes.trim()}</span>
            </Row>
          )}
        </dl>
      </div>

      <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-hud text-xs font-bold uppercase tracking-[0.2em] text-content/90">Estimated total</span>
          <span className="font-display text-4xl leading-none tracking-tight text-content" aria-live="polite">
            {estimating && estimate === null ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-label="Calculating price" />
            ) : estimate !== null ? (
              formatMoney(estimate, sym)
            ) : (
              '—'
            )}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Nothing to pay now. You pay at the counter for the time you actually play — snacks go on the same tab.
        </p>
      </div>
    </div>
  );
}
