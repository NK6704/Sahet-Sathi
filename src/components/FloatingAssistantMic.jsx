import React from 'react';
import { useLocation } from 'wouter';
import { Mic, Sparkles } from 'lucide-react';
import { useAppState } from '@/state/store';
import { getT, isHindiLang } from '@/services/i18n';

export function FloatingAssistantMic() {
  const [location, setLocation] = useLocation();
  const { language } = useAppState();
  const isHindi = isHindiLang(language);

  // Do not render floating mic if user is already on /assistant or in /asha portal or onboarding
  if (location === '/assistant' || location.startsWith('/asha') || location === '/onboarding') {
    return null;
  }

  const handleOpenAssistant = () => {
    setLocation('/assistant?autoStart=true');
  };

  return (
    <aside
      aria-label="Floating AI Assistant"
      className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2 group appear"
    >
      {/* Floating Tooltip / Label */}
      <button
        onClick={handleOpenAssistant}
        className="hidden sm:flex items-center gap-1.5 rounded-full bg-[#1f655d] px-3.5 py-1.5 text-xs font-bold text-[#f9f2df] shadow-lg border border-[#347870] hover:bg-[#18534c] transition transform hover:scale-105"
      >
        <Sparkles size={13} className="text-[#f68957] animate-spin" style={{ animationDuration: '4s' }} />
        <span>{isHindi ? 'बोलकर पूछें' : 'Ask AI Voice'}</span>
      </button>

      {/* Pulsing Mic Button */}
      <button
        onClick={handleOpenAssistant}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#1f655d] via-[#246f66] to-[#e76f46] text-white shadow-xl shadow-emerald-950/20 transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-4 focus:ring-emerald-300"
        aria-label={isHindi ? 'बोलकर पूछें' : 'Ask AI Voice Assistant'}
        data-testid="btn-floating-mic"
      >
        {/* Pulsing Outer Rings */}
        <span className="absolute -inset-1 rounded-full bg-[#e76f46]/30 animate-ping opacity-75" />
        <span className="absolute -inset-0.5 rounded-full bg-[#1f655d]/40 animate-pulse" />

        <div className="relative flex items-center justify-center">
          <Mic size={24} className="stroke-[2.3]" />
        </div>
      </button>
    </aside>
  );
}
