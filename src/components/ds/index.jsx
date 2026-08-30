import React from 'react';
import {
  BadgeCheck,
  CircleDashed,
  AlertTriangle,
  Search,
  RotateCw,
  ArrowRight,
} from 'lucide-react';

/* =============================================================
   Design-system primitives for Sehat Sathi.

   Everything here exists to serve one rule from the brief: the
   product only shows what it can prove. Provenance is a
   component, not a footnote.
   ============================================================= */

const TONES = {
  neutral: { text: 'text-ink-faint', rail: 'var(--color-rule)' },
  seal: { text: 'text-seal', rail: 'var(--color-seal)' },
  asha: { text: 'text-asha', rail: 'var(--color-asha)' },
  siren: { text: 'text-siren', rail: 'var(--color-siren)' },
  amber: { text: 'text-amber', rail: 'var(--color-amber)' },
};

/* -------------------------------------------------------------
   THE SIGNATURE ELEMENT — verification stamp

   Three states, visually distinct at a glance:
     verified  solid, sealed, carries its source
     inferred  dashed and hollow: AI-assisted, never a guarantee
     none      dotted: we looked and found nothing
   ------------------------------------------------------------- */

export function Stamp({ kind = 'verified', label, source, className = '' }) {
  const preset = {
    verified: { cls: 'stamp-verified', icon: BadgeCheck, text: 'Verified' },
    inferred: { cls: 'stamp-inferred', icon: CircleDashed, text: 'Not confirmed' },
    none: { cls: 'stamp-none', icon: Search, text: 'None found' },
    urgent: { cls: 'stamp-urgent', icon: AlertTriangle, text: 'Urgent' },
  }[kind] || { cls: 'stamp-none', icon: Search, text: 'Unknown' };

  const Icon = preset.icon;

  return (
    <span className={`stamp ${preset.cls} ${className}`}>
      <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
      <span>{label || preset.text}</span>
      {source ? <span className="opacity-60">· {source}</span> : null}
    </span>
  );
}

/**
 * The line that sits under any AI-derived statement. The brief is
 * explicit that eligibility is never presented as guaranteed.
 */
export function InferenceNote({ children, className = '' }) {
  return (
    <p className={`flex gap-2 text-sm leading-relaxed text-amber ${className}`}>
      <CircleDashed size={15} className="mt-0.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* -------------------------------------------------------------
   Structure
   ------------------------------------------------------------- */

export function Eyebrow({ children, className = '' }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

/**
 * A section divider carrying its register row number. The numbers
 * are not decoration — the register is the organising metaphor of
 * the whole interface, and these are its rows.
 */
export function RegRule({ index, label, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <div className="reg-rule" />
      {(index || label) && (
        <div className="flex items-baseline gap-3 pt-3">
          {index ? <span className="reg-index">{index}</span> : null}
          {label ? <Eyebrow>{label}</Eyebrow> : null}
        </div>
      )}
    </div>
  );
}

export function SectionHead({ index, eyebrow, title, sub, action, className = '' }) {
  return (
    <header className={className}>
      <div className="reg-rule" />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-5">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            {index ? <span className="reg-index">{index}</span> : null}
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          </div>
          {title ? <h2 className="display-md mt-3 max-w-3xl">{title}</h2> : null}
          {sub ? <p className="lede mt-4">{sub}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

/* -------------------------------------------------------------
   Cards
   ------------------------------------------------------------- */

export function Card({
  as: Tag = 'div',
  tone,
  lift = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const rail = tone ? (TONES[tone] || TONES.neutral).rail : null;

  return (
    <Tag
      className={`card ${rail ? 'card-rail' : ''} ${lift ? 'card-lift' : ''} ${className}`}
      style={rail ? { ...style, '--rail': rail } : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A single register count. Large tabular figure, quiet label —
 * the dashboard has to answer "what needs me today" at a glance.
 */
export function Figure({ value, label, tone = 'neutral', hint, className = '' }) {
  const t = TONES[tone] || TONES.neutral;

  return (
    <Card tone={tone} className={`p-4 sm:p-5 ${className}`}>
      <Eyebrow>{label}</Eyebrow>
      <p className={`figure mt-2 text-4xl sm:text-5xl ${t.text}`}>{value}</p>
      {hint ? <p className="mt-1.5 text-sm text-ink-faint">{hint}</p> : null}
    </Card>
  );
}

export function Pill({ tone = 'neutral', children, className = '' }) {
  const t = TONES[tone] || TONES.neutral;
  return <span className={`pill ${t.text} ${className}`}>{children}</span>;
}

/* -------------------------------------------------------------
   Controls
   ------------------------------------------------------------- */

export function Btn({
  variant = 'primary',
  size = 'md',
  as: Tag = 'button',
  className = '',
  children,
  ...rest
}) {
  const variants = {
    primary: 'btn-primary',
    asha: 'btn-asha',
    outline: 'btn-outline',
    siren: 'btn-siren',
  };

  return (
    <Tag
      className={`btn ${variants[variant] || variants.primary} ${
        size === 'lg' ? 'btn-lg' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------
   The three states every screen needs.

   Written to direct rather than apologise: an error says what
   happened and how to fix it, an empty screen invites an action.
   ------------------------------------------------------------- */

export function LoadingState({ label = 'Loading', rows = 3, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="card animate-pulse p-5"
          style={{ animationDelay: `${i * 120}ms` }}
          aria-hidden="true"
        >
          <div className="h-3 w-28 rounded-full bg-rule" />
          <div className="mt-4 h-5 w-2/3 rounded-full bg-rule-soft" />
          <div className="mt-2.5 h-3 w-1/3 rounded-full bg-rule-soft" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, stamp = true, className = '' }) {
  return (
    <div className={`card px-6 py-12 text-center ${className}`}>
      {stamp ? (
        <div className="mb-6 flex justify-center">
          <Stamp kind="none" label="Nothing to show" />
        </div>
      ) : null}
      <h3 className="display-md text-2xl">{title}</h3>
      {body ? <p className="lede mx-auto mt-3">{body}</p> : null}
      {action ? <div className="mt-7 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "We couldn't load this",
  body = 'The connection dropped before the data arrived. Try again.',
  onRetry,
  retryLabel = 'Try again',
  className = '',
}) {
  return (
    <div className={`card card-rail px-6 py-10 text-center ${className}`} style={{ '--rail': 'var(--color-siren)' }} role="alert">
      <div className="mb-5 flex justify-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-siren-soft text-siren">
          <AlertTriangle size={22} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
      <h3 className="display-md text-2xl">{title}</h3>
      <p className="lede mx-auto mt-3">{body}</p>
      {onRetry ? (
        <div className="mt-7 flex justify-center">
          <Btn variant="outline" onClick={onRetry}>
            <RotateCw size={17} aria-hidden="true" />
            {retryLabel}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------
   Voice waveform. The product is voice-first, so the mark of the
   product is a voice, not a heartbeat icon.
   ------------------------------------------------------------- */

export function Waveform({ bars = 28, active = true, className = '' }) {
  return (
    <div
      className={`flex h-12 items-center gap-[3px] ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, i) => {
        // A fixed pseudo-random profile, so the shape reads as a
        // spoken phrase rather than an even equaliser.
        const seed = Math.sin(i * 1.7) * 0.5 + 0.5;
        const height = 18 + seed * 82;

        return (
          <span
            key={i}
            className={`${active ? 'wave-bar' : ''} w-[3px] rounded-full bg-current`}
            style={{
              height: `${height}%`,
              animationDelay: `${(i % 9) * 90}ms`,
              animationDuration: `${1000 + (i % 5) * 160}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

export { ArrowRight };
