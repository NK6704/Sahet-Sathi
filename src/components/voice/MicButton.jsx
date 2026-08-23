import React from 'react';
import { Mic, MicOff, Loader2, Radio } from 'lucide-react';

export function MicButton({ isListening, isLoading, onClick, continuousMode = false, size = 'large', className = '' }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        id="button-voice-microphone"
        type="button"
        onClick={onClick}
        disabled={isLoading}
        aria-label={isListening ? 'Stop voice conversation' : 'Start speaking'}
        className={`group relative flex flex-col items-center justify-center rounded-3xl p-6 transition-all duration-300 active:scale-95 disabled:opacity-50 ${
          isListening
            ? 'w-36 h-44 bg-gradient-to-b from-[#c84630] to-[#9b2a1a] text-[#fff5e6] shadow-[0_0_40px_rgba(200,70,48,0.55)] border-4 border-[#ffb29d]'
            : 'w-32 h-40 bg-gradient-to-b from-[#e76f46] to-[#c9522b] text-[#fff5e6] hover:from-[#f07b53] hover:to-[#d65c34] shadow-xl border-4 border-[#3d837a]/40 hover:border-[#3d837a]'
        } ${className}`}
        data-testid="button-mic"
      >
        {/* Animated Sound Wave Rings when active */}
        {isListening && (
          <>
            <span className="absolute -inset-2.5 rounded-[2rem] border-2 border-[#e76f46] opacity-60 animate-ping" />
            <span className="absolute -inset-5 rounded-[2.5rem] border border-[#f68957] opacity-30 animate-pulse" />
          </>
        )}

        {/* Vertical Icon Layout */}
        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className={`grid place-items-center rounded-full p-3 transition-transform ${
            isListening ? 'bg-[#7d2013] scale-110' : 'bg-[#ab3c1b] group-hover:scale-105'
          }`}>
            {isLoading ? (
              <Loader2 size={36} className="animate-spin text-white" />
            ) : isListening ? (
              <MicOff size={36} className="text-[#ffe0d6] animate-pulse" />
            ) : (
              <Mic size={36} className="text-white" />
            )}
          </div>

          <div className="text-center">
            <span className="block text-xs font-black tracking-wider uppercase">
              {isLoading ? 'Processing' : isListening ? 'Listening…' : 'Tap to Speak'}
            </span>
            <span className="block text-[10px] font-semibold opacity-85">
              {isListening ? 'Tap to Pause' : 'Continuous AI Mode'}
            </span>
          </div>
        </div>
      </button>

      {/* Mode pill */}
      {isListening && (
        <div className="flex items-center gap-1.5 rounded-full bg-[#faeae6] px-3 py-1 text-[11px] font-bold text-[#b74636] border border-[#f1c3b7] animate-fade-in">
          <Radio size={12} className="animate-pulse" />
          <span>Hands-Free Auto-Listening Active</span>
        </div>
      )}
    </div>
  );
}
