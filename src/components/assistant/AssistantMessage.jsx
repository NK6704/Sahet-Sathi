import React, { useState } from 'react';
import { Volume2, VolumeX, ShieldAlert, Sparkles, User, Bot, CheckCircle2, Award, ExternalLink, MapPin } from 'lucide-react';
import { Link } from 'wouter';
import { speakText, stopSpeaking } from '@/services/voice';
import { LiveSourceBadge } from '@/components/common/LiveSourceBadge';
import { ActionChips } from '@/components/assistant/ActionChips';

export function AssistantMessage({ message, language = 'Hindi', onActionClick }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const isUser = message.sender === 'user';
  const isEmergency = message.urgency === 'emergency';
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const handleToggleVoice = () => {
    if (isPlaying) {
      stopSpeaking();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      speakText(message.text, language, () => setIsPlaying(false));
    }
  };

  if (isUser) {
    return (
      <div id={`msg-user-${message.id}`} className="flex justify-end appear" data-testid="msg-user">
        <div className="flex max-w-[85%] items-start gap-2 sm:max-w-[70%]">
          <div className="rounded-2xl rounded-tr-xs bg-[#1f655d] px-4 py-3 text-sm font-medium leading-relaxed text-[#f8f3e5] shadow-xs">
            {message.text}
          </div>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#347870] text-[#f9f2df]">
            <User size={15} />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      id={`msg-assistant-${message.id}`}
      className={`flex justify-start appear ${isEmergency ? 'border-2 border-[#b74636] rounded-3xl p-2 bg-[#fdf1ee]' : ''}`}
      data-testid="msg-assistant"
    >
      <div className="flex max-w-[95%] items-start gap-3 sm:max-w-[88%] w-full">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-2xl ${
            isEmergency ? 'bg-[#b74636] text-white' : 'bg-[#e76f46] text-[#fff5e6]'
          } shadow-xs`}
        >
          {isEmergency ? <ShieldAlert size={18} /> : <Bot size={18} />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="rounded-3xl rounded-tl-xs border border-[#ded5c2] bg-[#fbf8ef] p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display text-sm font-bold text-[#214e4a]">
                  {isEmergency ? 'आपातकालीन अलर्ट / Emergency Triage' : 'सेहत साथी AI Guidance'}
                </span>
                {message.intent && (
                  <span className="rounded-full bg-[#f2e7d5] px-2 py-0.5 text-[10px] font-bold text-[#7a5938] uppercase">
                    {message.intent.replace('_', ' ')}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleToggleVoice}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition shrink-0 ${
                  isPlaying
                    ? 'bg-[#b74636] text-white animate-pulse'
                    : 'bg-[#e5ede9] text-[#1f655d] hover:bg-[#d5e4de]'
                }`}
                aria-label={isPlaying ? 'Stop listening' : 'Listen with voice'}
              >
                {isPlaying ? <VolumeX size={14} /> : <Volume2 size={14} />}
                <span className="text-[11px]">{isPlaying ? 'Stop' : 'Listen (सुनें)'}</span>
              </button>
            </div>

            <div className="text-sm leading-relaxed text-[#2a4d47] whitespace-pre-line font-medium">
              {message.text}
            </div>

            {/* Related Government Schemes Card Section */}
            {message.related_schemes && message.related_schemes.length > 0 && (
              <div className="rounded-2xl border border-[#d2dfdb] bg-[#edf6f3] p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#1f655d]">
                  <Award size={15} className="text-[#e76f46]" />
                  <span>{isHindi ? 'संबंधित सरकारी स्वास्थ्य योजनाएं (लाभ):' : 'Related Government Health Schemes:'}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {message.related_schemes.map((scheme, idx) => (
                    <Link
                      key={idx}
                      to={scheme.link || '/schemes'}
                      className="group flex flex-col justify-between rounded-xl border border-[#cbd9cc] bg-[#fcfaf5] p-2.5 transition hover:border-[#1f655d] hover:shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-bold text-[#1f655d] group-hover:underline">
                          {scheme.title}
                        </span>
                        <ExternalLink size={12} className="text-[#1f655d] opacity-70 shrink-0 mt-0.5" />
                      </div>
                      <p className="mt-1 text-[11px] text-[#557168] line-clamp-2">
                        {scheme.benefit_summary}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Sources Badge */}
            {message.sources && message.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[#ede5d4] pt-2">
                <LiveSourceBadge
                  sourceType={message.source_type || 'curated'}
                  sourceName={message.sources.join(', ')}
                />
              </div>
            )}

            {/* Action Chips */}
            {message.actions && message.actions.length > 0 && (
              <div className="border-t border-[#ede5d4] pt-2">
                <ActionChips actions={message.actions} onActionClick={onActionClick} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
