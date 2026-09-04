import React from 'react';
import { Mic, MicOff, Loader2, Radio } from 'lucide-react';

/* =============================================================
   The microphone.

   This is the product's primary verb — for most users it is the
   only control they will ever press, and they will press it while
   standing up, holding a child, in bright sun. So it is deliberately
   the largest, highest-contrast object on any screen it appears on.

   Idle is ink (calm, confident, obviously pressable). Listening is
   ASHA magenta with a live pulse, so there is never any doubt about
   whether the phone is actually hearing you.
   ============================================================= */

const SIZES = {
  large: { box: 'h-40 w-32', boxActive: 'h-44 w-36', icon: 34, pad: 'p-3.5' },
  small: { box: 'h-28 w-24', boxActive: 'h-30 w-26', icon: 26, pad: 'p-2.5' },
};

export function MicButton({
  isListening,
  isLoading,
  onClick,
  continuousMode = false,
  size = 'large',
  language = 'Hindi',
  className = '',
}) {
  const hi = language !== 'English';
  const t = (en, dev) => (hi ? dev : en);
  const s = SIZES[size] || SIZES.large;

  const label = isLoading
    ? t('Working', 'सुन रही हूँ')
    : isListening
    ? t('Listening…', 'सुन रही हूँ…')
    : t('Tap to speak', 'बोलने के लिए दबाएँ');

  const sub = isLoading
    ? t('Tap to cancel', 'रद्द करने के लिए दबाएँ')
    : isListening
    ? t('Tap again to SEND', 'भेजने के लिए फिर दबाएँ')
    : t('In your own language', 'अपनी भाषा में');

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <button
        id="button-voice-microphone"
        type="button"
        onClick={onClick}
        aria-label={
          isListening
            ? t('Stop listening', 'सुनना बंद करें')
            : isLoading
            ? t('Stop searching', 'खोजना बंद करें')
            : t('Start speaking', 'बोलना शुरू करें')
        }
        aria-pressed={!!isListening}
        data-animate={isListening && !isLoading}
        className={`group relative flex flex-col items-center justify-center rounded-[1.75rem] border-[1.5px]
          transition-[transform,background-color,border-color] duration-200 active:translate-y-px
          disabled:cursor-not-allowed disabled:opacity-60
          ${
            isListening
              ? `${s.boxActive} is-listening border-asha bg-asha text-white`
              : `${s.box} border-ink bg-ink text-paper hover:bg-seal hover:border-seal`
          }`}
        data-testid="button-mic"
      >
        <span className="relative z-10 flex flex-col items-center gap-2.5">
          <span
            className={`grid place-items-center rounded-full ${s.pad} transition-transform duration-200 ${
              isListening
                ? 'scale-105 bg-white/15'
                : 'bg-white/10 group-hover:scale-105'
            }`}
          >
            {isLoading ? (
              <Loader2 size={s.icon} className="animate-spin" aria-hidden="true" />
            ) : isListening ? (
              <MicOff size={s.icon} strokeWidth={2.1} aria-hidden="true" />
            ) : (
              <Mic size={s.icon} strokeWidth={2.1} aria-hidden="true" />
            )}
          </span>

          <span className="px-2 text-center">
            <span className="block font-mono text-[0.66rem] font-medium uppercase tracking-[0.14em]">
              {label}
            </span>
            <span className="mt-1 block text-[0.7rem] leading-snug opacity-70">{sub}</span>
          </span>
        </span>
      </button>

      {/* Only shown when it is true, because a claim about hands-free
          listening that isn't actually happening is a lie about a
          microphone. */}
      {isListening && continuousMode ? (
        <span className="pill border-asha text-asha">
          <Radio size={12} aria-hidden="true" />
          {t('Hands-free — keep talking', 'हैंड्स-फ़्री — बोलती रहें')}
        </span>
      ) : null}
    </div>
  );
}
