'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';

/** Sticky bottom summary + primary CTA (mobile-first). */
export function SummaryBar({
  title,
  detail,
  price,
  ctaLabel,
  ctaDisabled,
  busy,
  final,
  onCta,
  hint,
}: {
  title: string;
  detail: string;
  price: string | null;
  ctaLabel: string;
  ctaDisabled?: boolean;
  busy?: boolean;
  final?: boolean;
  onCta: () => void;
  hint?: string | null;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { y: 100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong/70 bg-background/85 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate font-hud text-xs font-bold uppercase tracking-wider text-content">{title}</p>
          <p className="truncate text-xs text-muted">
            {detail}
            {price ? (
              <>
                {' · '}
                <span className="font-semibold text-content">{price}</span>
              </>
            ) : null}
          </p>
          {hint ? <p className="truncate text-[11px] text-warning">{hint}</p> : null}
        </div>
        <button
          type="button"
          onClick={onCta}
          disabled={ctaDisabled || busy}
          aria-busy={busy || undefined}
          className={`btn-shine inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2 rounded-lg px-5 font-hud text-sm font-bold uppercase tracking-widest text-white transition-[transform,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
            final ? 'bg-gradient-to-r from-primary to-secondary shadow-glow' : 'bg-primary shadow-glow-sm'
          }`}
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : final ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : null}
          {ctaLabel}
          {!busy && !final && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </motion.div>
  );
}
