import React from 'react';
import { Loader2, Mic, MicOff, Radio } from 'lucide-react';
import { useVoiceAgent } from '@/hooks/useVoiceAgent';

export function LiveVoiceButton({
  language = 'English',
  onTranscript,
  onResponse,
  onTurnComplete,
  className = '',
}) {
  const { start, stop, isConnected, isConnecting, error } = useVoiceAgent({
    language,
    onTranscript,
    onResponse,
    onTurnComplete,
  });

  const hi = language !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <button
        type="button"
        onClick={isConnected ? stop : start}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.82rem] font-semibold transition-colors ${
          isConnected
            ? 'border-asha bg-asha text-white'
            : 'border-rule bg-paper-2 text-ink hover:border-ink'
        }`}
        aria-pressed={isConnected}
        aria-label={
          isConnected
            ? t('Stop live voice', 'लाइव आवाज़ बंद करें')
            : t('Start live voice', 'लाइव आवाज़ शुरू करें')
        }
      >
        {isConnecting ? (
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        ) : isConnected ? (
          <MicOff size={15} aria-hidden="true" />
        ) : (
          <Mic size={15} aria-hidden="true" />
        )}
        <span>{isConnected ? t('Stop live voice', 'लाइव आवाज़ बंद करें') : t('Gemini Live beta', 'जेमिनी लाइव बीटा')}</span>
        {isConnected ? <Radio size={14} className="animate-pulse" aria-hidden="true" /> : null}
      </button>

      <p className="text-[0.78rem] leading-relaxed text-ink-faint">
        {isConnected
          ? t(
              'Live session is open. Speak naturally and the assistant will answer aloud.',
              'लाइव सत्र खुला है। सामान्य रूप से बोलें, सहायक जवाब बोलकर देगा।',
            )
          : t(
              'Direct voice session through the server token. Sign-in is required.',
              'यह सर्वर टोकन के साथ सीधा वॉइस सत्र है। इसके लिए साइन-इन ज़रूरी है।',
            )}
      </p>

      {error ? <p className="text-[0.78rem] leading-relaxed text-siren">{error}</p> : null}
    </div>
  );
}
