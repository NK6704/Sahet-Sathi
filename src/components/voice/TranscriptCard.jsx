import React from 'react';
import { Edit3, Check, RefreshCw } from 'lucide-react';

export function TranscriptCard({ transcript, interim, onEdit, onSubmit, onRetry, language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';
  const display = transcript || interim;

  if (!display) return null;

  return (
    <div
      id="card-voice-transcript"
      className="w-full rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] p-4 shadow-sm appear"
      data-testid="card-transcript"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#8a6b4a]">
          {isHindi ? 'आपकी आवाज़ का अनुवाद' : 'Detected Speech'}
        </p>
        <span className="text-[10px] rounded-full bg-[#dceee9] px-2 py-0.5 font-bold text-[#1f655d]">
          {interim ? 'Live...' : 'Confirmed'}
        </span>
      </div>

      <p className="mt-2 text-base font-semibold leading-relaxed text-[#214e4a]">
        "{display}"
      </p>

      {!interim && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#ded5c2] pt-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 rounded-full border border-[#dacfb9] px-3 py-1 text-xs font-semibold text-[#5d726b] hover:bg-[#eee4d0]"
            >
              <RefreshCw size={13} /> {isHindi ? 'फिर से बोलें' : 'Retry'}
            </button>
          )}
          {onSubmit && (
            <button
              onClick={onSubmit}
              className="flex items-center gap-1 rounded-full bg-[#1f655d] px-4 py-1 text-xs font-bold text-[#f9f2df] shadow-xs hover:bg-[#18534c]"
            >
              <Check size={14} /> {isHindi ? 'सलाह लें' : 'Get Guidance'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
