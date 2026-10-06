'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Gamepad2, LoaderCircle, Target, X } from 'lucide-react';

/* ------------------------------------------------------------ meta */

export const TYPE_LABEL: Record<string, string> = {
  PLAYSTATION: 'PS5 Console',
  XBOX: 'Xbox Console',
  PC: 'Gaming PC',
  POOL: 'Pool Table',
  VR: 'VR Station',
  SNOOKER: 'Snooker',
  TABLE_TENNIS: 'Table Tennis',
};

export function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StationIcon({ type, className = 'h-6 w-6' }: { type: string; className?: string }) {
  return type === 'POOL' || type === 'SNOOKER' ? (
    <Target className={className} aria-hidden />
  ) : (
    <Gamepad2 className={className} aria-hidden />
  );
}

export type Tone = 'success' | 'danger' | 'warning' | 'muted' | 'primary';

const TONE_CHIP: Record<Tone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  muted: 'border-muted/40 bg-muted/10 text-muted',
  primary: 'border-primary/40 bg-primary/10 text-primary',
};
const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  muted: 'bg-muted',
  primary: 'bg-primary',
};

export function StatusPill({ tone, children, pulse }: { tone: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 font-hud text-[10px] font-bold uppercase tracking-widest ${TONE_CHIP[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse ? 'animate-pulse-dot' : ''}`} aria-hidden />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ buttons */

export function PrimaryButton({
  children,
  className = '',
  busy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`btn-shine inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-primary px-5 font-hud text-sm font-bold uppercase tracking-widest text-white shadow-glow-sm transition-[transform,opacity] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${className}`}
    >
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function GhostButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-2/60 px-4 font-hud text-xs font-bold uppercase tracking-widest text-content transition-colors hover:border-secondary/50 hover:text-secondary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** Toggle chip (aria-pressed). */
export function Chip({
  pressed,
  onClick,
  children,
  disabled,
  className = '',
  ariaLabel,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] rounded-lg border font-hud font-bold uppercase tracking-wider transition-[background-color,border-color,color,transform] active:scale-[0.97] ${
        pressed
          ? 'border-primary bg-primary text-white shadow-glow-sm'
          : disabled
            ? 'cursor-not-allowed border-border/60 bg-surface/40 text-muted/40'
            : 'border-border-strong bg-surface-2/70 text-content hover:border-primary/60'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ step header */

export function StepHeader({
  index,
  total,
  kicker,
  title,
  subtitle,
  onBack,
}: {
  index: number;
  total: number;
  kicker: string;
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="mb-5">
      <div className="mb-4 flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex h-11 min-w-[44px] items-center gap-1.5 rounded-lg px-2 font-hud text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-content"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        ) : null}
        <div
          className="ml-auto flex flex-1 items-center justify-end gap-1.5"
          role="progressbar"
          aria-label="Booking progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index}
          aria-valuetext={`Step ${index} of ${total}`}
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i + 1 < index ? 'w-6 bg-primary/70' : i + 1 === index ? 'w-10 bg-secondary' : 'w-6 bg-surface-3'
              }`}
            />
          ))}
        </div>
      </div>
      <p className="font-hud text-[11px] font-bold uppercase tracking-[0.3em] text-primary">{kicker}</p>
      <h1 className="mt-1.5 font-display text-[2.6rem] uppercase leading-[0.95] tracking-tight sm:text-5xl">{title}</h1>
      {subtitle ? <div className="mt-2 text-sm text-muted">{subtitle}</div> : null}
    </div>
  );
}

export function SectionLabel({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 id={id} className="font-hud text-xs font-bold uppercase tracking-[0.25em] text-muted">
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------ form field */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  optional,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between font-hud text-xs font-bold uppercase tracking-[0.2em] text-muted">
        {label}
        {optional && <span className="text-[10px] tracking-widest text-muted/60">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'w-full min-h-[48px] rounded-lg border border-border-strong bg-surface-2/80 px-3.5 text-base text-content placeholder:text-muted/50 transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/25 aria-[invalid=true]:border-danger';

/* ------------------------------------------------------------ sheet / dialog */

function useDialogBehaviour(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLDivElement>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [href]');
      el?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && panelRef.current) {
        const f = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, [href]')
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open, panelRef]);
}

/** Bottom sheet on mobile, centered card on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  role = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehaviour(open, onClose, panelRef);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          />
          <motion.div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            className="glass hud relative z-10 max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-lg"
            initial={reduce ? { opacity: 0 } : { y: 48, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 48, opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id={titleId} className="font-display text-2xl uppercase leading-none tracking-tight">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 -mt-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-content"
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Keep it',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} onClose={busy ? () => {} : onCancel} title={title} role="alertdialog">
      <div className="text-sm leading-relaxed text-muted">{body}</div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <GhostButton onClick={onCancel} disabled={busy} data-autofocus>
          {cancelLabel}
        </GhostButton>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-danger px-4 font-hud text-xs font-bold uppercase tracking-widest text-white transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------ skeleton */

export function CardSkeleton() {
  return (
    <div className="glass rounded-lg p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-md bg-surface-3" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-3" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-3/70" />
        </div>
      </div>
      <div className="mt-4 h-12 animate-pulse rounded-lg bg-surface-3/70" />
    </div>
  );
}
