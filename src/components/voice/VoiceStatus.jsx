import React from 'react';
import { getT } from '@/services/i18n';

/* =============================================================
   The listening indicator.

   Its whole job is to answer one anxious question — "is it hearing
   me?" — without words, because the person is mid-sentence and not
   reading. Live bars while listening; a quiet instruction when not.
   ============================================================= */

const BARS = [
  { h: 'h-2.5', delay: '100ms' },
  { h: 'h-6', delay: '220ms' },
  { h: 'h-4', delay: '330ms' },
  { h: 'h-5', delay: '440ms' },
  { h: 'h-2', delay: '260ms' },
];

export function VoiceStatus({ isListening, language = 'Hindi' }) {
  const t = getT(language);

  if (!isListening) {
    return (
      <p
        id="label-voice-status"
        className="text-[0.85rem] font-medium text-ink-faint"
        data-testid="status-voice-idle"
      >
        {t.tapToSpeak}
      </p>
    );
  }

  return (
    <div
      id="container-voice-active"
      className="flex flex-col items-center gap-2"
      data-testid="status-voice-listening"
      role="status"
      aria-live="polite"
    >
      <div className="flex h-6 items-end gap-1.5" aria-hidden="true">
        {BARS.map((b, i) => (
          <span
            key={i}
            className={`vu-bar w-1.5 rounded-full bg-asha ${b.h}`}
            style={{ animationDelay: b.delay }}
          />
        ))}
      </div>
      <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-asha">
        {t.listening}
      </span>
    </div>
  );
}
