import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Sparkles, RotateCcw, MapPin, LocateFixed, Mic, Volume2, VolumeX } from 'lucide-react';
import { useLocation } from 'wouter';
import { useAppState } from '@/state/store';
import { sendMessageToAssistant } from '@/services/api';
import { VoiceController, speakText, stopSpeaking } from '@/services/voice';
import { getT, isHindiLang } from '@/services/i18n';
import { MicButton } from '@/components/voice/MicButton';
import { VoiceStatus } from '@/components/voice/VoiceStatus';
import { TranscriptCard } from '@/components/voice/TranscriptCard';
import { AssistantMessage } from '@/components/assistant/AssistantMessage';
import { Card, Eyebrow, InferenceNote, Waveform } from '@/components/ds';

export function Assistant() {
  const { language, userProfile } = useAppState();
  const [location] = useLocation();
  const t = getT(language);
  const hi = isHindiLang(language);

  const [messages, setMessages] = useState([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [continuousActive, setContinuousActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [locationName, setLocationName] = useState(
    `${userProfile?.village || 'Mandi'}, ${userProfile?.district || 'Sehore'}`,
  );
  const [locationLoading, setLocationLoading] = useState(false);
  const [hasWelcomed, setHasWelcomed] = useState(false);

  const voiceControllerRef = useRef(null);
  const continuousModeRef = useRef(false);
  const chatBottomRef = useRef(null);
  const sendRef = useRef(null);

  const welcomeText = hi
    ? 'नमस्ते! मैं आपका सेहत साथी AI सहायक हूँ। आप मुझसे बोलकर कोई भी बीमारी के लक्षण, पास के सरकारी अस्पताल या मुफ्त स्वास्थ्य योजनाओं के बारे में पूछ सकते हैं।'
    : 'Namaste! I am your Sehat Sathi AI Assistant. Ask me anything by speaking — symptoms, nearby government hospitals, or free welfare schemes.';

  /* ---------- Opening message & Fast Auto-Welcome ---------- */
  useEffect(() => {
    const initialWelcomeMsg = {
      id: 'init-1',
      sender: 'assistant',
      text: welcomeText,
      intent: 'general_welcome',
      sources: ['National Health Mission protocols', 'MoHFW India'],
      source_type: 'curated',
      related_schemes: [
        {
          id: 'pmjay-ayushman',
          title: hi ? 'आयुष्मान भारत (PM-JAY)' : 'Ayushman Bharat (PM-JAY)',
          benefit_summary: hi
            ? '₹5 लाख तक का सालाना कैशलेस इलाज'
            : '₹5 lakh annual cashless hospital cover',
          link: '/schemes/pmjay-ayushman',
        },
        {
          id: 'janani-suraksha',
          title: hi ? 'जननी सुरक्षा योजना (JSY)' : 'Janani Suraksha Yojana (JSY)',
          benefit_summary: hi
            ? 'सरकारी अस्पताल में प्रसव पर ₹1,400 नकद'
            : '₹1,400 cash help for institutional delivery',
          link: '/schemes/janani-suraksha',
        },
      ],
      actions: [
        {
          type: 'open_scheme',
          label: hi ? 'आयुष्मान भारत योजना' : 'Ayushman Bharat',
          link: '/schemes/pmjay-ayushman',
        },
        { type: 'find_care', label: hi ? 'पास का स्वास्थ्य केंद्र' : 'Nearby Health Centre', link: '/care' },
        {
          type: 'open_scheme',
          label: hi ? 'जननी सुरक्षा योजना' : 'Janani Suraksha',
          link: '/schemes/janani-suraksha',
        },
      ],
    };

    setMessages([initialWelcomeMsg]);

    // Check if opened via floating mic or autoStart query
    const searchParams = new URLSearchParams(window.location.search);
    const shouldAutoStart = searchParams.get('autoStart') === 'true' || !hasWelcomed;

    if (shouldAutoStart && !hasWelcomed) {
      setHasWelcomed(true);
      // Speak welcome greeting immediately
      speakText(welcomeText, language, () => {
        // Automatically start listening after speaking the greeting!
        if (voiceControllerRef.current) {
          setContinuousActive(true);
          continuousModeRef.current = true;
          voiceControllerRef.current.start(true);
        }
      });
    }
  }, [language, hi]);

  const suggestionPrompts = hi
    ? [
        'गर्भवती महिला को अस्पताल में क्या सहायता मिलती है?',
        'आयुष्मान कार्ड से ₹5 लाख का इलाज कैसे मिलेगा?',
        'तेज़ बुखार और बदन दर्द में क्या सावधानी रखें?',
        'सस्ती जेनेरिक दवा के लिए जन औषधि केंद्र कहाँ है?',
      ]
    : [
        'What cash help does Janani Suraksha give a pregnant woman?',
        'How do I use the Ayushman card for ₹5 lakh treatment?',
        'What home care should I follow for high fever and body ache?',
        'Where is the nearest Jan Aushadhi Kendra for cheap medicines?',
      ];

  /* ---------- Location ---------- */
  const detectLiveLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
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
            if (locality) setLocationName(`${locality}, ${a.state || 'India'}`);
          }
        } catch {
          setLocationName(`${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E`);
        } finally {
          setLocationLoading(false);
        }
      },
      () => setLocationLoading(false),
      { timeout: 8000, enableHighAccuracy: true },
    );
  }, [hi]);

  useEffect(() => {
    detectLiveLocation();
  }, [detectLiveLocation]);

  /* ---------- Sending Message to Live Gemini ---------- */
  const handleSendMessage = async (textToSend, wasSpoken = false) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isLoading) return;

    // Stop speaking previous answer when new query arrives
    stopSpeaking();

    setMessages((prev) => [
      ...prev,
      { id: `usr-${Date.now()}`, sender: 'user', text: query, timestamp: new Date().toISOString() },
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
        location: locationName,
        conversationHistory: messages.slice(-4),
      });

      const assistantMsg = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: response.response,
        intent: response.intent,
        urgency: response.urgency,
        sources: response.sources,
        source_type: response.source_type,
        nearby_hospitals: response.nearby_hospitals || [],
        related_schemes: response.related_schemes || [],
        actions: response.actions || [],
        confidence: response.confidence,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Automatically speak the response in the user's language!
      if (response.response) {
        speakText(response.response, language, () => {
          // If continuous voice mode is on, resume listening for follow-up!
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
          text: hi
            ? 'माफ़ कीजिए, सर्वर से बात नहीं हो सकी। कृपया पुनः प्रयास करें या पास के स्वास्थ्य केंद्र / 108 से संपर्क करें।'
            : 'We encountered a connection issue. Please try again or consult your local healthcare centre / 108.',
          sources: [],
          source_type: null,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  sendRef.current = handleSendMessage;

  /* ---------- Voice Controller Setup ---------- */
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

  const handleClearHistory = () => {
    stopSpeaking();
    voiceControllerRef.current?.stop();
    setContinuousActive(false);
    continuousModeRef.current = false;
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: 'assistant',
        text: hi
          ? 'नई बातचीत शुरू। अपना सवाल बोलकर या लिखकर पूछें।'
          : 'Started a new conversation. Ask your health or scheme question.',
        intent: 'reset',
        sources: ['National Health Mission protocols'],
        source_type: 'curated',
      },
    ]);
  };

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-6 sm:pt-8 ${hi ? 'is-deva' : ''}`}>
      {/* ---------- Header Banner ---------- */}
      <header className="border-b border-rule pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{hi ? 'AI आवाज़ साथी · लाइव स्वास्थ्य सहायक' : 'AI Live Voice Health Assistant'}</Eyebrow>
            <h1 className="display-lg mt-2 flex flex-wrap items-center gap-2.5">
              <Sparkles size={26} className="shrink-0 text-asha animate-pulse" aria-hidden="true" />
              <span>{t.assistantTitle}</span>
            </h1>
            <p className="lede mt-2 max-w-2xl text-[0.92rem]">
              {hi 
                ? 'लाइव आवाज़ बातचीत • बिना रुके अपनी भाषा में पूछें • अस्पताल व सरकारी योजनाओं की पूरी जानकारी'
                : 'Live Continuous Dialogue • Speak naturally in your language • Verified healthcare & scheme intelligence'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={detectLiveLocation}
              disabled={locationLoading}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 text-[0.8rem] font-semibold text-ink transition-colors hover:border-ink disabled:opacity-60"
              title={hi ? 'लोकेशन फिर से पता करें' : 'Re-detect your location'}
            >
              <MapPin
                size={13}
                className={locationLoading ? 'text-asha animate-bounce' : 'text-seal'}
                aria-hidden="true"
              />
              <span className="max-w-[14ch] truncate sm:max-w-none font-medium">
                {locationLoading ? t.locatingGps : locationName}
              </span>
              <LocateFixed size={12} className="text-ink-faint" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleClearHistory}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-rule px-3.5 text-[0.8rem] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>{t.clearChat}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Central Live Voice Interaction Hub ---------- */}
      <section className="ink-panel appear mt-6 rounded-card p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <Eyebrow className="text-paper-3/70">
            {hi ? 'माइक दबाएं और सीधे बोलें' : 'Live Voice Dialogue — Speak Naturally'}
          </Eyebrow>

          <div className="mt-5 relative">
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

          {/* Dynamic Waveform Visualizer */}
          <Waveform
            bars={28}
            active={isListening || isLoading}
            className="mt-4 w-full max-w-md text-asha-bright"
          />

          {/* Live Detected Transcription Card */}
          {(transcript || interimTranscript) ? (
            <div className="mt-5 w-full max-w-lg text-left appear">
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

      {/* ---------- 1-Tap FAQ Suggestion Chips ---------- */}
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
              <span className="truncate">💬 {prompt}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Conversation & Guidance Stream ---------- */}
      <section className="mt-7 space-y-4 rounded-card border border-rule bg-paper-2 p-4 sm:p-6 min-h-[280px]">
        {messages.map((msg) => (
          <AssistantMessage key={msg.id} message={msg} language={language} />
        ))}

        {isLoading ? (
          <Card className="flex items-center gap-3 p-4" aria-live="polite">
            <Waveform bars={12} active className="h-6 w-24 text-asha" />
            <span className="text-[0.85rem] font-semibold text-ink-soft">{t.thinking}</span>
          </Card>
        ) : null}

        <div ref={chatBottomRef} />
      </section>

      {/* ---------- Standing Disclaimer ---------- */}
      <InferenceNote className="mt-5">{t.disclaimer}</InferenceNote>

      {/* ---------- Typed Fallback Input Bar ---------- */}
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
