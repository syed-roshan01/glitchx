'use client';

import { Field, StepHeader, inputClass } from './primitives';

export interface DetailsErrors {
  name?: string | null;
  mobile?: string | null;
}

export function DetailsStep({
  name,
  mobile,
  notes,
  remember,
  errors,
  returning,
  onName,
  onMobile,
  onNotes,
  onRemember,
  onBlurField,
  onSubmit,
  onBack,
}: {
  name: string;
  mobile: string;
  notes: string;
  remember: boolean;
  errors: DetailsErrors;
  returning: string | null;
  onName: (v: string) => void;
  onMobile: (v: string) => void;
  onNotes: (v: string) => void;
  onRemember: (v: boolean) => void;
  onBlurField: (f: 'name' | 'mobile') => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader
        index={3}
        total={4}
        kicker="03 / Player"
        title="Who's playing?"
        subtitle={
          returning ? (
            <span>
              Welcome back, <span className="font-semibold text-content">{returning}</span> — we filled in your details.
            </span>
          ) : (
            'No account needed. We only use your number for this booking.'
          )
        }
        onBack={onBack}
      />

      <form
        id="details-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-5"
      >
        <Field label="Your name" htmlFor="bk-name" error={errors.name}>
          <input
            id="bk-name"
            name="name"
            className={inputClass}
            value={name}
            onChange={(e) => onName(e.target.value)}
            onBlur={() => onBlurField('name')}
            placeholder="e.g. Rahul"
            autoComplete="name"
            autoCapitalize="words"
            maxLength={120}
            enterKeyHint="next"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'bk-name-error' : undefined}
            required
          />
        </Field>

        <Field
          label="Mobile number"
          htmlFor="bk-mobile"
          error={errors.mobile}
          hint="Show your booking code at the counter — we may call this number if plans change."
        >
          <input
            id="bk-mobile"
            name="mobile"
            type="tel"
            inputMode="tel"
            className={inputClass}
            value={mobile}
            onChange={(e) => onMobile(e.target.value)}
            onBlur={() => onBlurField('mobile')}
            placeholder="98765 43210"
            autoComplete="tel"
            maxLength={16}
            enterKeyHint="next"
            aria-invalid={!!errors.mobile}
            aria-describedby={errors.mobile ? 'bk-mobile-error' : 'bk-mobile-hint'}
            required
          />
        </Field>

        <Field label="Notes" htmlFor="bk-notes" optional hint="Extra controller, game request, group size…">
          <textarea
            id="bk-notes"
            name="notes"
            rows={2}
            className={`${inputClass} min-h-[72px] resize-none py-3`}
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            maxLength={300}
            aria-describedby="bk-notes-hint"
          />
        </Field>

        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => onRemember(e.target.checked)}
            className="h-5 w-5 shrink-0 rounded border-border-strong bg-surface-2 accent-[rgb(124,58,237)]"
          />
          Remember my name &amp; number on this device
        </label>

        {/* lets the keyboard "Go" key submit */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Continue
        </button>
      </form>
    </div>
  );
}
