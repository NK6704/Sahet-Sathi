import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Sparkles,
  RotateCcw,
  MapPin,
  LocateFixed,
  MapPinOff,
  MessageSquare,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { sendMessageToAssistant } from '@/services/api';
import { VoiceController, speakText, stopSpeaking } from '@/services/voice';
import { getT, isHindiLang } from '@/services/i18n';
import { MicButton } from '@/components/voice/MicButton';
import { VoiceStatus } from '@/components/voice/VoiceStatus';
import { TranscriptCard } from '@/components/voice/TranscriptCard';
import { AssistantMessage } from '@/components/assistant/AssistantMessage';
import { Card, Eyebrow, InferenceNote, Waveform } from '@/components/ds';

/* =============================================================
   The voice assistant.

   Two things here used to be wrong in ways nobody could see from
   the screen, and both are fixed below.

   1. The page opened with a hard-coded location — "Mandi, Sehore" —
      for every person in India, and it was sent to the model as
      fact. Now the button reads the saved village if there is one,
      otherwise it says plainly that no location has been shared.
      Nothing is guessed.

   2. The browser's coordinates were fetched, reverse-geocoded into
      a place name, and then thrown away. The server attaches nearby
      hospitals only when it receives lat/lng, so the hospital list
      in every answer was permanently empty and nobody knew why. The
      coordinates now go into the shared store and travel with the
      question.

   The conversation also no longer opens with a fabricated assistant
   turn stamped "curated". A greeting is not an answer and must not
   wear an answer's provenance. It is spoken, and the panel below
   says what can be asked; the transcript stays empty until somebody
   actually asks something.
   ============================================================= */

export function Assistant() {
  const { language, userProfile, coords, setCoords } = useAppState();
  const t = getT(language);
  const hi = isHindiLang(language);

  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [continuousActive, setContinuousActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [detectedPlace, setDetectedPlace] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const voiceControllerRef = useRef(null);
  const continuousModeRef = useRef(false);
  const chatBottomRef = useRef(null);
  const sendRef = useRef(null);
  const welcomedRef = useRef(false);

  /* The person's own saved village is a fact we hold; a default for
     everyone else's is not. When neither exists, the header says so. */
  const savedPlace = useMemo(() => {
    const parts = [userProfile?.village, userProfile?.district].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }, [userProfile?.village, userProfile?.district]);

  const placeLabel = detectedPlace || savedPlace;

  const welcomeText = hi
    ? 'नमस्ते! मैं आपका सेहत साथी सहायक हूँ। लक्षण, पास के सरकारी अस्पताल या सरकारी स्वास्थ्य योजनाओं के बारे में अपनी भाषा में पूछिए।'
    : 'Namaste. I am your Sehat Sathi assistant. Ask about symptoms, nearby government hospitals, or government health schemes — in your own language.';

  const suggestionPrompts = hi
    ? [
        'गर्भवती महिला को अस्पताल में क्या सहायता मिलती है?',
        'आयुष्मान कार्ड से इलाज कैसे मिलेगा?',
        'तेज़ बुखार और बदन दर्द में क्या सावधानी रखें?',
        'सस्ती जेनेरिक दवा कहाँ मिलेगी?',
      ]
    : [
        'What help does Janani Suraksha Yojana give a pregnant woman?',
        'How do I use an Ayushman card at a hospital?',
        'What home care should I follow for high fever and body ache?',
        'Where can I get cheaper generic medicines?',
      ];

  /* ---------- Location ----------
     One job: get real coordinates into the store, and a readable
     place name for the header. If either fails we say so; we never
     substitute a district. */
  const detectLiveLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError(
        hi
          ? 'यह फ़ोन लोकेशन साझा नहीं कर सकता।'
          : 'This device cannot share a location.',
      );
      return;
    }

    setLocationLoading(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;

        // Stored FIRST. The place name is a nicety; the coordinates are
        // what the hospital registry is actually searched with, and
        // losing them was the original defect on this page.
        setCoords({
          latitude,
          longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          at: new Date().toISOString(),
        });

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': hi ? 'hi,en' : 'en' } },
          );
          if (res.ok) {
            const data = await res.json();
            const a = data.address || {};
            const locality =
              a.village || a.suburb || a.town || a.city || a.county || a.state_district;
            setDetectedPlace(
              locality
                ? `${locality}${a.state ? `, ${a.state}` : ''}`
                : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
            );
          } else {
            setDetectedPlace(`${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
          }
        } catch {
          // The name lookup is optional. Coordinates are already saved,
          // so the hospital list works either way.
          setDetectedPlace(`${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
        } finally {
          setLocationLoading(false);
        }
      },
      (err) => {
        setLocationLoading(false);
        setLocationError(
          err?.code === 1
            ? hi
              ? 'लोकेशन की अनुमति नहीं मिली। अस्पताल की दूरी नहीं बताई जा सकेगी।'
              : 'Location permission was declined, so hospital distances cannot be shown.'
            : hi
              ? 'लोकेशन पता नहीं चल सकी। फिर कोशिश करें।'
              : 'Your location could not be read. Please try again.',
        );
      },
      { timeout: 8000, enableHighAccuracy: true },
    );
  }, [hi, setCoords]);

  /* Ask once on arrival. If the person has already shared a position
     this session we reuse it rather than prompting again. */
  useEffect(() => {
    if (!coords) detectLiveLocation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Spoken greeting ----------
     Speaks once per visit. It deliberately does NOT push a message
     into the transcript: an invented assistant turn carrying scheme
     cards and a "curated" source stamp is exactly the pattern this
     rebuild removed. */
  useEffect(() => {
    if (welcomedRef.current) return;
    welcomedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const autoStart = params.get('autoStart') === 'true';

    speakText(welcomeText, language, () => {
      if (autoStart && voiceControllerRef.current) {
        setContinuousActive(true);
        continuousModeRef.current = true;
        voiceControllerRef.current.start(true);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Sending a question ---------- */
  const handleSendMessage = async (textToSend, wasSpoken = false) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isLoading) return;

    stopSpeaking();

    const history = messages.slice(-6).map((m) => ({
      role: m.sender === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    }));

    setMessages((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}`,
        sender: 'user',
        text: query,
        spoken: wasSpoken,
        timestamp: new Date().toISOString(),
      },
    ]);
    setInputQuery('');
    setTranscript('');
    setInterimTranscript('');
    setIsLoading(true);

    try {
      const response = await sendMessageToAssistant({
        message: query,
        language,
        userProfile,
        location: placeLabel,
        // The whole point of the fix. Null when unknown — the server
        // then returns an empty hospital list plus the reason, which
        // AssistantMessage renders.
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
        conversationHistory: history,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `ast-${Date.now()}`,
          sender: 'assistant',
          text: response.response,
          intent: response.intent,
          urgency: response.urgency,
          // The written summary the person reads at the counter.
          summary: response.summary || null,
          relatedSchemes: response.relatedSchemes || [],
          nearbyHospitals: response.nearbyHospitals || [],
          hospitalsNote: response.hospitalsNote || null,
          locationShared: response.locationShared === true,
          actions: response.actions || [],
          sources: response.sources || [],
          sourceType: response.sourceType || null,
          confidence: response.confidence,
          verification: response.verification || 'inferred',
          disclaimer: response.disclaimer || null,
          timestamp: new Date().toISOString(),
        },
      ]);

      if (response.response) {
        speakText(response.response, language, () => {
          if (continuousModeRef.current && voiceControllerRef.current) {
            setTimeout(() => {
              if (continuousModeRef.current) voiceControllerRef.current.start(true);
            }, 600);
          }
        });
      }
    } catch (err) {
      console.warn('Assistant error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text:
            (hi
              ? 'सर्वर से बात नहीं हो सकी, इसलिए इस सवाल का जवाब नहीं बन पाया। दोबारा कोशिश करें। आपात स्थिति में 108 पर कॉल करें।'
              : 'The server could not be reached, so this question was not answered. Please try again. In an emergency, call 108.') +
            (err?.message ? `\n\n(${err.message})` : ''),
          sources: [],
          sourceType: null,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  sendRef.current = handleSendMessage;

  /* ---------- Voice controller ---------- */
  useEffect(() => {
    const controller = new VoiceController({
      language,
      continuousMode: true,
      onStateChange: ({ isListening: listening, continuousMode }) => {
        setIsListening(listening);
        setContinuousActive(continuousMode);
        continuousModeRef.current = continuousMode;
      },
      onResult: ({ text, final, interim }) => {
        setTranscript(final || text);
        setInterimTranscript(interim);
        if (final && final.trim().length > 1) {
          controller.pause();
          sendRef.current?.(final.trim(), true);
        }
      },
      onError: (err) => console.warn('Voice error:', err),
    });

    controller.setLanguage(language);
    voiceControllerRef.current = controller;

    return () => {
      controller.stop();
      stopSpeaking();
    };
  }, [language]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isLoading]);

  const handleToggleListening = () => {
    const controller = voiceControllerRef.current;
    if (!controller) return;

    if (isListening || continuousActive) {
      controller.stop();
      stopSpeaking();
      setContinuousActive(false);
      continuousModeRef.current = false;
    } else {
      stopSpeaking();
      setTranscript('');
      setInterimTranscript('');
      setContinuousActive(true);
      continuousModeRef.current = true;
      controller.start(true);
    }
  };

  /* Clearing empties the transcript. It does not write a fake opening
     turn, because there is nothing to attribute one to. */
  const handleClearHistory = () => {
    stopSpeaking();
    voiceControllerRef.current?.stop();
    setContinuousActive(false);
    continuousModeRef.current = false;
    setMessages([]);
    setTranscript('');
    setInterimTranscript('');
  };

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-6 sm:pt-8 ${hi ? 'is-deva' : ''}`}>
      {/* ---------- Header ---------- */}
      <header className="border-b border-rule pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{hi ? 'आवाज़ सहायक' : 'Voice assistant'}</Eyebrow>
            <h1 className="display-lg mt-2 flex flex-wrap items-center gap-2.5">
              <Sparkles size={26} className="shrink-0 text-asha" aria-hidden="true" />
              <span>{t.assistantTitle}</span>
            </h1>
            <p className="lede mt-2 max-w-2xl text-[0.92rem]">
              {hi
                ? 'अपनी भाषा में बोलकर पूछें। हर जवाब के साथ ज़रूरी कागज़ात, अगले कदम और स्वास्थ्य सलाह लिखकर भी मिलेगी।'
                : 'Ask out loud in your own language. Every answer also comes in writing — the documents to carry, the next steps, and the health guidance.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={detectLiveLocation}
              disabled={locationLoading}
              className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 text-[0.8rem] font-semibold text-ink transition-colors hover:border-ink disabled:opacity-60"
              title={
                hi
                  ? 'लोकेशन साझा करें या फिर से पता करें'
                  : 'Share or re-detect your location'
              }
              data-testid="btn-detect-location"
            >
              {placeLabel ? (
                <MapPin
                  size={13}
                  className={locationLoading ? 'text-asha' : 'text-seal'}
                  aria-hidden="true"
                />
              ) : (
                <MapPinOff size={13} className="text-amber" aria-hidden="true" />
              )}
              <span className="max-w-[16ch] truncate font-medium sm:max-w-none">
                {locationLoading
                  ? t.locatingGps
                  : placeLabel || (hi ? 'लोकेशन साझा करें' : 'Share location')}
              </span>
              <LocateFixed size={12} className="text-ink-faint" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleClearHistory}
              disabled={messages.length === 0}
              className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full border border-rule px-3.5 text-[0.8rem] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>{t.clearChat}</span>
            </button>
          </div>
        </div>

        {/* Location state, stated rather than implied. */}
        {locationError ? (
          <p className="mt-3 text-[0.8rem] leading-relaxed text-amber" role="status">
            {locationError}
          </p>
        ) : !coords && !locationLoading ? (
          <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
            {hi
              ? 'लोकेशन साझा किए बिना जवाब मिलेगा, पर पास के अस्पतालों की दूरी नहीं बताई जा सकेगी।'
              : 'Answers work without a location, but nearby hospital distances cannot be worked out until you share one.'}
          </p>
        ) : null}
      </header>

      {/* ---------- Voice hub ---------- */}
      <section className="ink-panel appear mt-6 rounded-card p-6 shadow-rest sm:p-8">
        <div className="flex flex-col items-center text-center">
          <Eyebrow className="text-paper-3/70">
            {hi ? 'माइक दबाएँ और बोलें' : 'Press the mic and speak'}
          </Eyebrow>

          <div className="relative mt-5">
            <MicButton
              isListening={isListening}
              isLoading={isLoading}
              continuousMode={continuousActive}
              onClick={handleToggleListening}
              size="large"
              language={language}
            />
          </div>

          <div className="mt-4">
            <VoiceStatus isListening={isListening} language={language} />
          </div>

          <Waveform
            bars={28}
            active={isListening || isLoading}
            className="mt-4 w-full max-w-md text-asha-bright"
          />

          {transcript || interimTranscript ? (
            <div className="appear mt-5 w-full max-w-lg text-left">
              <TranscriptCard
                transcript={transcript}
                interim={interimTranscript}
                onSubmit={() => handleSendMessage(transcript, true)}
                onRetry={() => {
                  setTranscript('');
                  setInterimTranscript('');
                  voiceControllerRef.current?.start(true);
                }}
                language={language}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------- Suggested questions ---------- */}
      <div className="mt-7">
        <Eyebrow>{t.faqSuggestions}</Eyebrow>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestionPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendMessage(prompt, false)}
              disabled={isLoading}
              className="inline-flex min-h-10 max-w-full items-center rounded-full border-[1.5px] border-rule px-4 text-left text-[0.82rem] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              data-testid={`prompt-chip-${idx}`}
            >
              <span className="truncate">{prompt}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Transcript ---------- */}
      <section className="mt-7 min-h-[280px] space-y-4 rounded-card border border-rule bg-paper-2 p-4 sm:p-6">
        {messages.length === 0 && !isLoading ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
            <MessageSquare size={22} className="text-ink-faint" aria-hidden="true" />
            <p className="mt-3 max-w-md text-[0.9rem] leading-relaxed text-ink-soft">
              {welcomeText}
            </p>
            <p className="mt-2 max-w-md text-[0.8rem] leading-relaxed text-ink-faint">
              {hi
                ? 'आपकी बातचीत यहाँ दिखेगी। यह पेज छोड़ने पर बातचीत सहेजी नहीं जाती।'
                : 'Your conversation appears here. It is not saved when you leave this page.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <AssistantMessage
              key={msg.id}
              message={msg}
              language={language}
              onShareLocation={detectLiveLocation}
            />
          ))
        )}

        {isLoading ? (
          <Card className="flex items-center gap-3 p-4" aria-live="polite">
            <Waveform bars={12} active className="h-6 w-24 text-asha" />
            <span className="text-[0.85rem] font-semibold text-ink-soft">{t.thinking}</span>
          </Card>
        ) : null}

        <div ref={chatBottomRef} />
      </section>

      {/* ---------- Standing disclaimer ---------- */}
      <InferenceNote className="mt-5">{t.disclaimer}</InferenceNote>

      {/* ---------- Typed input ---------- */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="mt-5 flex items-center gap-2 pb-6"
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t.typePlaceholder}</span>
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={t.typePlaceholder}
            className="field w-full"
          />
        </label>
        <button
          type="submit"
          disabled={!inputQuery.trim() || isLoading}
          aria-label={t.send}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors hover:bg-seal disabled:opacity-40"
          data-testid="btn-send-message"
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </form>
    </main>
  );
}
