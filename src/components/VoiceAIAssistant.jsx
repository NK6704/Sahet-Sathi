import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Volume2, VolumeX, ArrowUpRight, Stethoscope, AlertTriangle } from 'lucide-react';
import { Link } from 'wouter';
import { VoiceController, speakText, stopSpeaking } from '@/services/voice';
import { sendMessageToAssistant } from '@/services/api';
import { useAppState } from '@/state/store';
import { getT, isHindiLang } from '@/services/i18n';
import { MicButton } from '@/components/voice/MicButton';
import { Card, Eyebrow, Stamp, Waveform } from '@/components/ds';

/* =============================================================
   The one-shot voice widget.

   Ask once, hear one answer, put the phone down. No history, no
   typing, no scrolling — this is the mode for a person who is
   standing in a doorway holding a child.

   Because it speaks its answer aloud, the failure path matters more
   than usual: if the request fails, the spoken and written reply
   both say the connection failed and the card carries no source
   stamp. Nothing here should sound authoritative when it isn't.
   ============================================================= */

export default function VoiceAIAssistant() {
  const { language, userProfile } = useAppState();
  const t = getT(language);
  const hi = isHindiLang(language);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [coords, setCoords] = useState(null);
  const [locationError, setLocationError] = useState('');

  const voiceRef = useRef(null);
  const sendRef = useRef(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationError(t.locationDenied),
    );
  }, [t.locationDenied]);

  const handleSendToAI = useCallback(
    async (messageText) => {
      if (!messageText.trim()) return;
      setLoading(true);
      setAiResponse(null);
      setFailed(false);
      stopSpeaking();
      setIsPlayingAudio(false);

      try {
        const res = await sendMessageToAssistant({
          message: messageText,
          language,
          userProfile,
          location: coords
            ? `${coords.lat},${coords.lng}`
            : `${userProfile?.village || 'Mandi'}, ${userProfile?.district || 'Sehore'}`,
          lat: coords?.lat,
          lng: coords?.lng,
          conversationHistory: [],
        });

        setAiResponse(res);
        setLoading(false);

        if (res.response) {
          setIsPlayingAudio(true);
          speakText(res.response, language, () => setIsPlayingAudio(false));
        }
      } catch (err) {
        console.warn('AI call failed:', err);
        setLoading(false);
        setFailed(true);
        // Spoken and written say the same thing, and neither claims a source.
        const message = hi
          ? 'सर्वर से बात नहीं हो सकी, इसलिए जवाब नहीं दे पा रहे। फिर कोशिश करें या पास के प्राथमिक स्वास्थ्य केंद्र से पूछें। गंभीर हालत में 108 पर कॉल करें।'
          : 'The server could not be reached, so I have no answer for this. Please try again or ask at your nearest Primary Health Centre. If it is serious, call 108.';
        setAiResponse({ response: message, actions: [], related_schemes: [], sources: [] });
        setIsPlayingAudio(true);
        speakText(message, language, () => setIsPlayingAudio(false));
      }
    },
    [coords, userProfile, language, hi],
  );

  sendRef.current = handleSendToAI;

  useEffect(() => {
    voiceRef.current = new VoiceController({
      language,
      onResult: ({ text, final }) => {
        setTranscript(text);
        if (final) {
          setIsListening(false);
          sendRef.current?.(text);
        }
      },
      onError: (err) => {
        console.warn('Voice error:', err);
        setIsListening(false);
        setLoading(false);
      },
      onStateChange: ({ isListening: listening }) => setIsListening(listening),
    });

    return () => {
      voiceRef.current?.stop();
      stopSpeaking();
    };
  }, [language]);

  const toggleMic = () => {
    if (isListening) {
      voiceRef.current?.stop();
      setIsListening(false);
      return;
    }
    setTranscript('');
    setAiResponse(null);
    setFailed(false);
    stopSpeaking();
    setIsPlayingAudio(false);
    voiceRef.current?.start(false); // one-shot
  };

  const handleTogglePlayAudio = () => {
    if (isPlayingAudio) {
      stopSpeaking();
      setIsPlayingAudio(false);
    } else if (aiResponse?.response) {
      setIsPlayingAudio(true);
      speakText(aiResponse.response, language, () => setIsPlayingAudio(false));
    }
  };

  const sources = Array.isArray(aiResponse?.sources) ? aiResponse.sources.filter(Boolean) : [];
  const sourced =
    !failed &&
    sources.length > 0 &&
    (aiResponse?.source_type === 'curated' ||
      aiResponse?.source_type === 'verified' ||
      aiResponse?.source_type === 'official');

  return (
    <div
      className={`appear mx-auto w-full max-w-lg overflow-hidden rounded-card border border-rule bg-paper-2 ${
        hi ? 'is-deva' : ''
      }`}
    >
      {/* ---------- Header ---------- */}
      <div className="ink-panel px-5 py-6 text-center">
        <Eyebrow className="text-paper-3/70">{t.assistantTitle}</Eyebrow>
        <p className="mt-2 text-[0.95rem] font-medium text-paper">{t.tapToSpeak}</p>

        <Waveform
          bars={22}
          active={isListening}
          className="mx-auto mt-4 max-w-[15rem] text-asha-bright"
        />

        {coords ? (
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-paper-3">
            <MapPin size={11} aria-hidden="true" />
            {t.locationActive}
          </span>
        ) : null}
      </div>

      {/* ---------- Body ---------- */}
      <div className="flex min-h-[13rem] flex-col items-center justify-center gap-4 p-5 text-center">
        {!transcript && !aiResponse && !loading ? (
          <div className="py-4">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-seal-soft text-seal">
              <Stethoscope size={22} aria-hidden="true" />
            </span>
            <p className="mx-auto mt-4 max-w-xs text-[0.86rem] leading-relaxed text-ink-soft">
              {isListening ? t.listening : t.listeningIdlePrompt}
            </p>
          </div>
        ) : null}

        {transcript ? (
          <div className="w-full rounded-sm border border-rule-soft bg-paper-3 p-4 text-left">
            <Eyebrow>{t.youSaid}</Eyebrow>
            <p className="mt-1.5 text-[0.92rem] font-semibold leading-relaxed text-ink">
              {transcript}
            </p>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-4" role="status" aria-live="polite">
            <Waveform bars={14} active className="h-7 w-28 text-asha" />
            <p className="text-[0.82rem] font-semibold text-ink-soft">{t.thinking}</p>
          </div>
        ) : null}

        {aiResponse && !loading ? (
          <Card tone={failed ? 'siren' : 'seal'} className="w-full p-4 text-left appear">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {failed ? (
                  <AlertTriangle size={15} className="shrink-0 text-siren" aria-hidden="true" />
                ) : null}
                <Eyebrow className={failed ? 'text-siren' : ''}>
                  {failed
                    ? hi
                      ? 'जवाब नहीं मिला'
                      : 'No answer available'
                    : t.sehatSathiReply}
                </Eyebrow>
              </div>

              <button
                type="button"
                onClick={handleTogglePlayAudio}
                aria-label={isPlayingAudio ? t.stopVoice : t.listenVoice}
                aria-pressed={isPlayingAudio}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[0.76rem] font-semibold transition-colors ${
                  isPlayingAudio
                    ? 'border-asha bg-asha text-white'
                    : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
                }`}
              >
                {isPlayingAudio ? (
                  <VolumeX size={13} aria-hidden="true" />
                ) : (
                  <Volume2 size={13} aria-hidden="true" />
                )}
                {isPlayingAudio ? t.stopVoice : t.listenVoice}
              </button>
            </div>

            <p className="mt-3 whitespace-pre-line text-[0.9rem] leading-relaxed text-ink-soft">
              {aiResponse.response}
            </p>

            {aiResponse.related_schemes?.length ? (
              <div className="mt-4">
                <Eyebrow>{t.relatedSchemesTitle}</Eyebrow>
                <div className="mt-2.5 space-y-2">
                  {aiResponse.related_schemes.map((scheme, idx) => (
                    <Link
                      key={scheme.id || idx}
                      href={scheme.link || '/schemes'}
                      className="group flex items-start justify-between gap-2 rounded-sm border border-rule-soft bg-paper-3 px-3.5 py-2.5 transition-colors hover:border-seal"
                    >
                      <span className="min-w-0">
                        <span className="block text-[0.84rem] font-semibold text-ink group-hover:text-seal">
                          {scheme.title}
                        </span>
                        {scheme.benefit_summary ? (
                          <span className="mt-0.5 block line-clamp-1 text-[0.76rem] text-ink-faint">
                            {scheme.benefit_summary}
                          </span>
                        ) : null}
                      </span>
                      <ArrowUpRight
                        size={13}
                        className="mt-1 shrink-0 text-ink-faint"
                        aria-hidden="true"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {aiResponse.actions?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {aiResponse.actions.map((action, idx) =>
                  action.link?.startsWith('tel:') ? (
                    <a
                      key={idx}
                      href={action.link}
                      className="inline-flex min-h-10 items-center rounded-full border-[1.5px] border-siren bg-siren px-3.5 text-[0.8rem] font-semibold text-white"
                    >
                      {action.label}
                    </a>
                  ) : (
                    <Link
                      key={idx}
                      href={action.link || '/schemes'}
                      className="inline-flex min-h-10 items-center rounded-full border-[1.5px] border-ink bg-ink px-3.5 text-[0.8rem] font-semibold text-paper transition-colors hover:border-seal hover:bg-seal"
                    >
                      {action.label}
                    </Link>
                  ),
                )}
              </div>
            ) : null}

            <div className="mt-4 border-t border-rule pt-3">
              {sourced ? (
                <Stamp kind="verified" label={t.verifiedSource} source={sources.join(' · ')} />
              ) : sources.length ? (
                <Stamp
                  kind="inferred"
                  label={hi ? 'AI द्वारा तैयार' : 'AI-assisted'}
                  source={sources.join(' · ')}
                />
              ) : (
                <Stamp
                  kind="inferred"
                  label={hi ? 'स्रोत नहीं जुड़ा' : 'No source attached'}
                />
              )}
            </div>
          </Card>
        ) : null}
      </div>

      {/* ---------- The microphone ---------- */}
      <div className="flex flex-col items-center gap-3 border-t border-rule bg-paper-3 px-5 py-6">
        <MicButton
          isListening={isListening}
          isLoading={loading}
          continuousMode={false}
          onClick={toggleMic}
          size="small"
          language={language}
        />
        <span className="text-[0.8rem] font-semibold text-ink-soft">
          {isListening ? t.listening : t.tapToSpeak}
        </span>
        {locationError ? (
          <p className="text-[0.74rem] text-amber">{locationError}</p>
        ) : null}
      </div>
    </div>
  );
}
