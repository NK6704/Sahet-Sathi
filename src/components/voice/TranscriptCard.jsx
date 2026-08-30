import React from 'react';
import { RefreshCw, Check } from 'lucide-react';
import { getT } from '@/services/i18n';

/* =============================================================
   What the phone thinks you said.

   Speech recognition on Indian-language input over a patchy
   connection is wrong often enough that showing the transcript back
   is not a nicety — it is the only way a person can catch a
   misheard symptom before advice gets built on top of it. Hence the
   explicit confirm step rather than acting on the interim result.
   ============================================================= */

export function TranscriptCard({ transcript, interim, onEdit, onSubmit, onRetry, language = 'Hindi' }) {
  const t = getT(language);
  const display = transcript || interim;

  if (!display) return null;

  return (
    <div
      id="card-voice-transcript"
      className="card card-rail w-full p-5 appear"
      style={{ '--rail': interim ? 'var(--color-asha)' : 'var(--color-seal)' }}
      data-testid="card-transcript"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{t.youSaid}</p>
        <span className={`pill ${interim ? 'text-asha' : 'text-seal'}`}>
          {interim ? t.listening : t.confirmed || 'Confirmed'}
        </span>
      </div>

      <p className="mt-3 text-[1.05rem] font-medium leading-relaxed text-ink">
        <span aria-hidden="true" className="text-ink-faint">“</span>
        {display}
        <span aria-hidden="true" className="text-ink-faint">”</span>
      </p>

      {!interim && (onRetry || onSubmit) ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-4">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-rule px-4
                text-[0.85rem] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t.retry}
            </button>
          ) : null}
          {onSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-5
                text-[0.85rem] font-semibold text-paper transition-colors hover:bg-seal"
            >
              <Check size={15} aria-hidden="true" />
              {t.getGuidance}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
