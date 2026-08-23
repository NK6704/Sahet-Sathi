import React from 'react';

export function VoiceStatus({ isListening, language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  if (!isListening) {
    return (
      <p id="label-voice-status" className="text-xs font-semibold text-[#637d74]" data-testid="status-voice-idle">
        {isHindi ? 'माइक दबाकर अपनी भाषा में पूछें' : 'Tap microphone and speak in your language'}
      </p>
    );
  }

  return (
    <div id="container-voice-active" className="flex flex-col items-center gap-2" data-testid="status-voice-listening">
      <div className="flex items-end gap-1.5 h-6">
        <span className="w-1.5 rounded-full bg-[#f68957] animate-[bounce_0.6s_infinite_100ms] h-3" />
        <span className="w-1.5 rounded-full bg-[#f68957] animate-[bounce_0.6s_infinite_200ms] h-6" />
        <span className="w-1.5 rounded-full bg-[#f68957] animate-[bounce_0.6s_infinite_300ms] h-4" />
        <span className="w-1.5 rounded-full bg-[#f68957] animate-[bounce_0.6s_infinite_400ms] h-5" />
        <span className="w-1.5 rounded-full bg-[#f68957] animate-[bounce_0.6s_infinite_250ms] h-2" />
      </div>
      <span className="text-xs font-bold text-[#b74636] animate-pulse">
        {isHindi ? 'हम सुन रहे हैं… बोलें' : 'Listening… Please speak'}
      </span>
    </div>
  );
}
