'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Hourglass, Users } from 'lucide-react';
import type { AvailabilityRow } from '@/types';
import { errorMessage, getSupabase, validateMobile, validateName } from './api';
import { Chip, Field, PrimaryButton, SectionLabel, Sheet, inputClass } from './primitives';
import { DURATIONS } from './when-step';
import type { Contact } from './types';

export function WaitlistSheet({
  open,
  onClose,
  rows,
  defaultResourceId,
  defaultDuration,
  contact,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  rows: AvailabilityRow[];
  defaultResourceId: string | null;
  defaultDuration: number;
  contact: Contact | null;
  onJoined: (c: Contact) => void;
}) {
  const reduce = useReducedMotion();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [preferred, setPreferred] = useState<string | null>(null);
  const [duration, setDuration] = useState(60);
  const [errors, setErrors] = useState<{ name?: string | null; mobile?: string | null; form?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  // (re)seed the form each time the sheet opens
  useEffect(() => {
    if (!open) return;
    setName((n) => n || contact?.name || '');
    setMobile((m) => m || contact?.mobile || '');
    setPreferred(defaultResourceId);
    setDuration(defaultDuration);
    setErrors({});
    setPosition(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(e?: React.FormEvent) {
    e?.preventDefault();
    const next = { name: validateName(name), mobile: validateMobile(mobile) };
    setErrors(next);
    if (next.name || next.mobile) return;
    setBusy(true);
    try {
      const { data, error } = await getSupabase().rpc('public_join_waitlist', {
        p_name: name.trim(),
        p_mobile: mobile.trim(),
        p_resource_id: preferred,
        p_resource_type: null,
        p_duration_minutes: duration,
      });
      if (error) {
        setErrors({ form: errorMessage(error) });
        return;
      }
      setPosition((data as { position?: number } | null)?.position ?? 0);
      onJoined({ name: name.trim(), mobile: mobile.trim() });
    } catch {
      setErrors({ form: errorMessage({ message: 'Failed to fetch' }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={position !== null ? 'You’re on the list' : 'Join the waitlist'}>
      {position !== null ? (
        <div className="py-4 text-center">
          <motion.div
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-success/40 bg-success/15"
          >
            <Users className="h-8 w-8 text-success" aria-hidden />
          </motion.div>
          {position > 0 && (
            <>
              <p className="mt-5 font-hud text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Your position</p>
              <p className="font-display text-7xl leading-none text-success">#{position}</p>
            </>
          )}
          <p className="mx-auto mt-4 max-w-xs text-sm text-muted">
            We&apos;ll call <span className="font-semibold text-content">{mobile.trim()}</span> as soon as a station frees up. Stay close!
          </p>
          <PrimaryButton onClick={onClose} className="mt-6 w-full" data-autofocus>
            Got it
          </PrimaryButton>
        </div>
      ) : (
        <form onSubmit={join} noValidate className="space-y-4">
          <p className="-mt-1 text-sm text-muted">Everything taken? Drop your details and we&apos;ll call you the moment a station opens.</p>
          <Field label="Your name" htmlFor="wl-name" error={errors.name}>
            <input
              id="wl-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Arjun"
              autoComplete="name"
              maxLength={120}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'wl-name-error' : undefined}
            />
          </Field>
          <Field label="Mobile number" htmlFor="wl-mobile" error={errors.mobile}>
            <input
              id="wl-mobile"
              type="tel"
              inputMode="tel"
              className={inputClass}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="98765 43210"
              autoComplete="tel"
              maxLength={16}
              aria-invalid={!!errors.mobile}
              aria-describedby={errors.mobile ? 'wl-mobile-error' : undefined}
            />
          </Field>
          {rows.length > 0 && (
            <div>
              <SectionLabel>Preferred station</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Chip pressed={preferred === null} onClick={() => setPreferred(null)} className="px-3 text-xs">
                  Any
                </Chip>
                {rows.map((r) => (
                  <Chip
                    key={r.resource_id}
                    pressed={preferred === r.resource_id}
                    onClick={() => setPreferred(r.resource_id)}
                    className="px-3 text-xs"
                  >
                    {r.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div>
            <SectionLabel>How long?</SectionLabel>
            <div className="grid grid-cols-5 gap-2">
              {DURATIONS.map((d) => (
                <Chip key={d.min} pressed={duration === d.min} onClick={() => setDuration(d.min)} ariaLabel={`${d.min} minutes`} className="text-sm">
                  {d.label}
                </Chip>
              ))}
            </div>
          </div>
          {errors.form && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm font-semibold text-danger">
              {errors.form}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-warning font-hud text-sm font-bold uppercase tracking-widest text-black transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            <Hourglass className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'Joining…' : 'Join waitlist'}
          </button>
        </form>
      )}
    </Sheet>
  );
}
