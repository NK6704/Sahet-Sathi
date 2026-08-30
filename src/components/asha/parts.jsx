import React from 'react';
import { Search } from 'lucide-react';
import { Pill, Eyebrow } from '@/components/ds';
import { statusMeta, severityMeta } from '@/services/asha';

/* =============================================================
   Small shared pieces for the portal.
   ============================================================= */

/**
 * "20 minutes ago" beats a timestamp when you are deciding what to
 * do next. Falls back to a date once it stops being useful.
 */
export function relativeTime(iso, hi = false) {
  if (!iso) return '—';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);

  if (Number.isNaN(mins)) return '—';
  if (mins < 1) return hi ? 'अभी' : 'just now';
  if (mins < 60) return hi ? `${mins} मिनट पहले` : `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return hi ? `${hours} घंटे पहले` : `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return hi ? `${days} दिन पहले` : `${days} d ago`;

  return then.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function formatDate(value, hi = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function StatusBadge({ status, hi = false }) {
  const meta = statusMeta(status);
  return <Pill tone={meta.tone}>{hi ? meta.label_hi : meta.label}</Pill>;
}

export function SeverityBadge({ severity, hi = false }) {
  const meta = severityMeta(severity);
  return <Pill tone={meta.tone}>{hi ? meta.label_hi : meta.label}</Pill>;
}

const ALERT_STATUS_LABEL = {
  new: ['New', 'नया'],
  acknowledged: ['Acknowledged', 'देखा गया'],
  actioned: ['Actioned', 'कार्रवाई हुई'],
  closed: ['Closed', 'बंद'],
};

export function AlertStatusBadge({ status, hi = false }) {
  const pair = ALERT_STATUS_LABEL[status] || ['Unknown', 'अज्ञात'];
  const tone = status === 'new' ? 'amber' : status === 'closed' ? 'neutral' : 'seal';
  return <Pill tone={tone}>{hi ? pair[1] : pair[0]}</Pill>;
}

/**
 * A filter row plus search. Chips rather than a dropdown, because
 * one tap beats open-scroll-tap and the counts are worth showing.
 */
export function FilterBar({
  options,
  value,
  onChange,
  search,
  onSearch,
  searchPlaceholder = 'Search',
  label,
}) {
  return (
    <div className="mb-6">
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {options.map((opt) => {
            const on = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                aria-pressed={on}
                className={`flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                  on
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule bg-paper-2 text-ink-soft hover:border-ink-faint hover:text-ink'
                }`}
              >
                {opt.label}
                {typeof opt.count === 'number' ? (
                  <span
                    className={`font-mono text-[0.7rem] ${on ? 'text-paper/70' : 'text-ink-faint'}`}
                  >
                    {opt.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {onSearch ? (
          <label className="relative shrink-0 lg:w-72">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="field w-full pl-11"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled value. Used everywhere a record is read rather than edited. */
export function Detail({ label, value, mono = false, className = '' }) {
  return (
    <div className={className}>
      <Eyebrow>{label}</Eyebrow>
      <p className={`mt-1.5 ${mono ? 'font-mono text-sm' : 'text-[0.95rem]'} text-ink`}>
        {value === null || value === undefined || value === '' ? (
          <span className="text-ink-faint">—</span>
        ) : (
          value
        )}
      </p>
    </div>
  );
}
