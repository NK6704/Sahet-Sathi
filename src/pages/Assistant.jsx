import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Send,
  Volume2,
  VolumeX,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  RotateCcw,
  Languages,
  AlertCircle,
  HelpCircle,
  MapPin,
  LocateFixed,
  Radio
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { sendMessageToAssistant } from '@/services/api';
import { VoiceController, speakText, stopSpeaking } from '@/services/voice';
import { MicButton } from '@/components/voice/MicButton';
import { VoiceStatus } from '@/components/voice/VoiceStatus';
import { TranscriptCard } from '@/components/voice/TranscriptCard';
import { AssistantMessage } from '@/components/assistant/AssistantMessage';
import { ActionChips } from '@/components/assistant/ActionChips';

export function Assistant() {
  const { language, userProfile } = useAppState();
  const [messages, setMessages] = useState([
    {
      id: 'init-1',
      sender: 'assistant',
      text:
        language === 'हिन्दी' || language === 'Hindi'
          ? 'नमस्ते! मैं आपका सेहत साथी AI सहायक हूँ। अब आप एक बार माइक चालू करके बिना रुके एक के बाद एक कई सवाल पूछ सकते हैं। मैं आपको प्राथमिक देखभाल सलाह, पास के स्वास्थ्य केंद्र और सरकारी योजनाओं की पूरी जानकारी बोलकर भी दूंगा।'
          : 'Namaste! I am your Sehat Sathi AI Assistant. Continuous voice chat is now active — you can speak freely question after question. I will guide you with verified care advice, nearby centres, and live scheme benefits.',
      intent: 'general_welcome',
      sources: ['National Health Mission Protocols', 'MoHFW India'],
      source_type: 'curated',
      related_schemes: [
        {
          id: 'pmjay-ayushman',
          title: 'आयुष्मान भारत (PM-JAY)',
          benefit_summary: '₹5 लाख तक का सालाना कैशलेस इलाज',
          link: '/schemes/pmjay-ayushman'
        },
        {
          id: 'janani-suraksha',
          title: 'जननी सुरक्षा योजना (JSY)',
          benefit_summary: 'सरकारी अस्पताल में सुरक्षित प्रसव पर ₹1,400 नकद',
          link: '/schemes/janani-suraksha'
        }
      ],
      actions: [
        { type: 'open_scheme', label: 'आयुष्मान भारत योजना', link: '/schemes/pmjay-ayushman' },
        { type: 'find_care', label: 'पास का स्वास्थ्य केंद्र', link: '/care' },
        { type: 'open_scheme', label: 'जननी सुरक्षा योजना', link: '/schemes/janani-suraksha' }
      ]
    }
  ]);

  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [continuousActive, setContinuousActive] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [locationName, setLocationName] = useState(`${userProfile?.village || 'Mandi'}, ${userProfile?.district || 'Sehore'}`);
  const [locationLoading, setLocationLoading] = useState(false);

  const voiceControllerRef = useRef(null);
  const continuousModeRef = useRef(false);
  const chatBottomRef = useRef(null);
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  // Sample Prompts
  const suggestionPrompts = isHindi
    ? [
        'गर्भवती महिला के लिए अस्पताल में क्या सहायता मिलती है?',
        'आयुष्मान कार्ड में ₹5 लाख का मुफ्त इलाज कैसे मिलेगा?',
        'तेज बुखार और बदन दर्द में क्या प्राथमिक सावधानी बरतें?',
        'सस्ती जेनेरिक दवाइयों के लिए जन औषधि केंद्र कहाँ है?'
      ]
    : [
        'What cash assistance is given under Janani Suraksha for pregnant women?',
        'How to get ₹5 Lakh hospital treatment under Ayushman Card?',
        'What immediate home care to follow for high fever and body ache?',
        'Where can I find cheap generic medicines at Jan Aushadhi Kendra?'
      ];

  // Request & Auto-Detect User's Live Geolocation
  const detectLiveLocation = () => {
    if (!navigator.geolocation) return;
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        try {
          // Attempt reverse geocoding via OpenStreetMap nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': isHindi ? 'hi,en' : 'en' } }
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const locality =
              addr.village || addr.suburb || addr.town || addr.city || addr.county || addr.state_district || 'Your Live Location';
            const state = addr.state || 'India';
            setLocationName(`${locality}, ${state}`);
          }
        } catch {
          setLocationName(`GPS: ${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E`);
        } finally {
          setLocationLoading(false);
        }
      },
      (err) => {
        console.warn('Geolocation access declined or unavailable:', err.message);
        setLocationLoading(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    detectLiveLocation();
  }, []);

  // Initialize Speech Recognition with continuous multi-question dialogue support
  useEffect(() => {
    const controller = new VoiceController({
      language: language,
      continuousMode: true,
      onStateChange: ({ isListening, continuousMode }) => {
        setIsListening(isListening);
        setContinuousActive(continuousMode);
        continuousModeRef.current = continuousMode;
      },
      onResult: ({ text, final, interim }) => {
        setTranscript(final || text);
        setInterimTranscript(interim);
        if (final && final.trim().length > 1) {
          // Pause mic while assistant processes and answers, then automatically resume
          controller.pause();
          handleSendMessage(final.trim(), true);
        }
      },
      onError: (err) => {
        console.warn('Voice error:', err);
      }
    });

    controller.setLanguage(language);
    voiceControllerRef.current = controller;

    return () => {
      if (controller) controller.stop();
      stopSpeaking();
    };
  }, [language, locationName]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      setTranscript('');
      setInterimTranscript('');
      setContinuousActive(true);
      continuousModeRef.current = true;
      controller.start(true);
    }
  };

  const handleSendMessage = async (textToSend, wasSpoken = false) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isLoading) return;

    // Append User Message
    const userMsg = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setTranscript('');
    setInterimTranscript('');
    setIsLoading(true);

    try {
      const response = await sendMessageToAssistant({
        message: query,
        language: language,
        userProfile: userProfile,
        location: locationName,
        conversationHistory: messages.slice(-4)
      });

      const assistantMsg = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: response.response,
        intent: response.intent,
        urgency: response.urgency,
        sources: response.sources,
        source_type: response.source_type,
        related_schemes: response.related_schemes || [],
        actions: response.actions || [],
        confidence: response.confidence,
        timestamp: new Date().toISOString()
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Auto-speak response if query was spoken or in continuous voice mode
      if (wasSpoken || continuousModeRef.current) {
        speakText(response.response, language, () => {
          // AFTER finishing speaking the answer, resume listening automatically if continuous mode remains on!
          if (continuousModeRef.current && voiceControllerRef.current) {
            setTimeout(() => {
              if (continuousModeRef.current) {
                voiceControllerRef.current.start(true);
              }
            }, 500);
          }
        });
      }
    } catch (err) {
      console.warn('Assistant error:', err);
      const fallbackMsg = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: isHindi
          ? 'माफ़ कीजिए, सर्वर से संपर्क नहीं हो पाया। कृपया पास के प्राथमिक स्वास्थ्य केंद्र से संपर्क करें।'
          : 'We encountered a connection issue. Please consult your local Primary Health Centre or ASHA worker.',
        sources: ['National Health Mission Guidelines'],
        source_type: 'curated'
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    stopSpeaking();
    if (voiceControllerRef.current) voiceControllerRef.current.stop();
    setContinuousActive(false);
    continuousModeRef.current = false;
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: 'assistant',
        text: isHindi
          ? 'नई बातचीत शुरू की गई है। कृपया अपना सवाल पूछें।'
          : 'Conversation cleared. Please ask your health or scheme question.',
        intent: 'reset',
        sources: ['National Health Mission'],
        source_type: 'curated'
      }
    ]);
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      {/* Top Banner with Live Location Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ded5c2] pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl font-bold text-[#214e4a] sm:text-3xl flex items-center gap-2">
              <Sparkles size={24} className="text-[#e76f46]" />
              <span>{isHindi ? 'बोलकर पूछें (आवाज़ साथी)' : 'Voice Health Assistant'}</span>
            </h1>

            {/* Live Location Chip */}
            <button
              onClick={detectLiveLocation}
              disabled={locationLoading}
              className="flex items-center gap-1 rounded-full border border-[#cbd9cc] bg-[#eef5f1] px-2.5 py-1 text-[11px] font-bold text-[#1f655d] hover:bg-[#dceee9]"
              title="Click to re-sync live GPS location"
            >
              <MapPin size={12} className={locationLoading ? 'animate-bounce text-[#e76f46]' : 'text-[#1f655d]'} />
              <span>{locationLoading ? (isHindi ? 'स्थान खोज रहे हैं…' : 'Locating GPS…') : locationName}</span>
              <LocateFixed size={11} className="opacity-60" />
            </button>
          </div>

          <p className="mt-1 text-xs text-[#627c73]">
            {isHindi
              ? 'लगातार बातचीत मोड • एक बार दबाएं और बिना रुके सवाल पूछते रहें • सरकारी योजनाओं की पूरी जानकारी'
              : 'Continuous Hands-Free Dialogue • Instant Live Scheme Grounding • Nearest Healthcare Guidance'}
          </p>
        </div>

        <button
          onClick={handleClearHistory}
          className="flex items-center gap-1.5 rounded-full border border-[#dacfb9] bg-[#fbf7ec] px-3.5 py-1.5 text-xs font-semibold text-[#546e65] hover:bg-[#eee4d0]"
          title="Clear Conversation"
        >
          <RotateCcw size={14} />
          <span>{isHindi ? 'नया सवाल' : 'Clear Chat'}</span>
        </button>
      </div>

      {/* Primary Voice Mic Interaction Section with Vertical Big Mic */}
      <div className="flex flex-col items-center justify-center rounded-[2.5rem] border border-[#ded5c2] bg-gradient-to-b from-[#fbf8ef] to-[#f4ede0] p-6 sm:p-8 shadow-sm appear">
        <MicButton
          isListening={isListening}
          isLoading={isLoading}
          continuousMode={continuousActive}
          onClick={handleToggleListening}
          size="large"
        />

        <div className="mt-4 text-center">
          <VoiceStatus isListening={isListening} language={language} />
        </div>

        {/* Live / Detected Transcript */}
        {(transcript || interimTranscript) && (
          <div className="mt-4 w-full max-w-lg">
            <TranscriptCard
              transcript={transcript}
              interim={interimTranscript}
              onSubmit={() => handleSendMessage(transcript, true)}
              onRetry={() => {
                setTranscript('');
                setInterimTranscript('');
                if (voiceControllerRef.current) voiceControllerRef.current.start(true);
              }}
              language={language}
            />
          </div>
        )}
      </div>

      {/* Suggested Quick Prompt Chips */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-[#8a6b4a]">
          {isHindi ? 'या इनमें से कोई सवाल चुनें:' : 'Or tap a frequently asked question:'}
        </p>
        <div className="flex flex-wrap gap-2">
          {suggestionPrompts.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendMessage(prompt, false)}
              className="rounded-full border border-[#cbd9cc] bg-[#eef5f1] px-3.5 py-1.5 text-xs font-semibold text-[#1f655d] transition hover:bg-[#dceee9] active:scale-95 text-left"
              data-testid={`prompt-chip-${idx}`}
            >
              💬 {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation Stream */}
      <div className="space-y-4 rounded-3xl border border-[#ded5c2] bg-[#f5efe2] p-4 sm:p-6 min-h-[350px]">
        {messages.map((msg) => (
          <AssistantMessage
            key={msg.id}
            message={msg}
            language={language}
          />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-bold text-[#1f655d] animate-pulse">
            <Bot size={18} />
            <span>{isHindi ? 'सेहत साथी उत्तर तैयार कर रहा है…' : 'Finding verified health advice…'}</span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Text Input Fallback Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="flex items-center gap-2 rounded-full border border-[#ded5c2] bg-[#fbf8ef] p-1.5 shadow-md"
      >
        <input
          type="text"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          placeholder={isHindi ? 'अपना सवाल यहाँ टाइप करें…' : 'Or type your symptoms / scheme question here...'}
          className="flex-1 bg-transparent px-4 py-2.5 text-sm text-[#214e4a] placeholder-[#8ea49c] outline-none"
        />

        <button
          type="submit"
          disabled={!inputQuery.trim() || isLoading}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1f655d] text-[#f9f2df] shadow-xs hover:bg-[#18534c] disabled:opacity-40"
          aria-label="Send message"
          data-testid="btn-send-message"
        >
          <Send size={18} />
        </button>
      </form>
    </main>
  );
}
