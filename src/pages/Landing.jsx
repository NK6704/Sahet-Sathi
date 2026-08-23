import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  HeartPulse,
  Mic,
  ShieldCheck,
  FileText,
  MapPin,
  Siren,
  UserCheck,
  ArrowRight,
  Sparkles,
  Camera,
  Languages,
  CheckCircle2
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { SUPPORTED_LANGUAGES } from '@/services/i18n';

export function Landing() {
  const { language, setLanguage, userRole, setUserRole } = useAppState();
  const [, setLocation] = useLocation();

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const handleStart = (role = 'citizen') => {
    setUserRole(role);
    if (role === 'asha') {
      setLocation('/asha/login');
    } else {
      setLocation('/onboarding');
    }
  };

  return (
    <main className="min-h-[calc(100vh-74px)] px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col justify-between">
      {/* Hero Section */}
      <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr] items-center">
        <div className="appear">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#cbd9cc] bg-[#eef5f1] px-3.5 py-1.5 text-xs font-extrabold text-[#1f655d] shadow-2xs">
            <Sparkles size={14} className="text-[#e76f46]" />
            <span>{isHindi ? 'राष्ट्रीय स्वास्थ्य मिशन आधारित AI साथी' : 'AI Rural Health & Scheme Companion'}</span>
          </div>

          <h1 className="mt-4 font-display text-4xl leading-[1.08] tracking-tight text-[#214e4a] sm:text-5xl lg:text-6xl">
            {isHindi ? (
              <>अपनी भाषा में <span className="text-[#1f655d] underline decoration-[#f6c09c] decoration-4">बोलकर पूछें</span>, सही इलाज व योजना पाएँ।</>
            ) : (
              <>Multilingual <span className="text-[#1f655d] underline decoration-[#f6c09c] decoration-4">Healthcare & Schemes</span> in your own voice.</>
            )}
          </h1>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#546e65]">
            {isHindi
              ? 'गाँव और कस्बों के परिवारों के लिए आवाज़-आधारित स्वास्थ्य मार्गदर्शन, ₹5 लाख तक का मुफ्त इलाज (आयुष्मान भारत), जननी सुरक्षा, जन औषधि केंद्र और आपातकालीन 108 सहायता।'
              : 'Voice-first guidance layer over existing public health infrastructure: Ayushman Bharat, Janani Suraksha, free generic medicines, nearest PHC/CHC care, and direct ASHA worker emergency alerts.'}
          </p>

          {/* Language Selector Grid */}
          <div className="mt-6 rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-5 shadow-xs">
            <p className="text-xs font-bold uppercase tracking-wider text-[#8a6b4a] flex items-center gap-1.5">
              <Languages size={15} /> {isHindi ? 'अपनी पसंदीदा भाषा चुनें' : 'Choose Your Preferred Language'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const active = language === lang.name;
                return (
                  <button
                    key={lang.name}
                    type="button"
                    onClick={() => setLanguage(lang.name)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition ${
                      active
                        ? 'bg-[#1f655d] text-[#f9f2df] shadow-xs'
                        : 'border border-[#dacfb9] bg-[#fbf7ec] text-[#355e58] hover:bg-[#eee4d0]'
                    }`}
                  >
                    <span>{lang.name}</span>
                    <span className="opacity-70 text-[11px]">({lang.script})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action CTAs */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleStart('citizen')}
              className="flex items-center gap-2 rounded-full bg-[#1f655d] px-7 py-3.5 text-sm font-extrabold text-[#f9f2df] shadow-md transition hover:-translate-y-0.5 hover:bg-[#18534c] active:scale-95"
              data-testid="btn-start-citizen"
            >
              <Mic size={18} />
              <span>{isHindi ? 'आवाज़ साथी शुरू करें' : 'Start Voice Assistant'}</span>
              <ArrowRight size={16} />
            </button>

            <button
              onClick={() => handleStart('asha')}
              className="flex items-center gap-2 rounded-full border border-[#1f655d] bg-[#fbf7ec] px-5 py-3.5 text-sm font-bold text-[#1f655d] shadow-xs transition hover:bg-[#eef5f1]"
              data-testid="btn-start-asha"
            >
              <UserCheck size={17} />
              <span>{isHindi ? 'आशा कार्यकर्ता लॉगिन' : 'ASHA Worker Portal'}</span>
            </button>
          </div>
        </div>

        {/* Hero Interactive Card Preview */}
        <div className="space-y-4 appear">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[#1f655d] p-7 text-[#f9f2df] shadow-xl">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full border border-white/10" />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#c4dfc7]">
                <Mic size={16} /> {isHindi ? 'लाइव आवाज़ समझ' : 'Live Voice Guidance'}
              </span>
              <span className="rounded-full bg-[#e76f46] px-3 py-1 text-[11px] font-black text-white">
                Bhashini + Gemini AI
              </span>
            </div>

            <div className="mt-5 rounded-2xl bg-[#174f49] p-4 text-xs leading-relaxed text-[#eef5df] border border-white/10">
              <p className="font-bold text-[#f6c09c]">
                🗣️ "{isHindi ? 'मेरी पत्नी 8 महीने की गर्भवती है, क्या हमें अस्पताल जाने पर सरकारी पैसा मिलेगा?' : 'My wife is 8 months pregnant, can we get government support for hospital delivery?'}"
              </p>
              <p className="mt-2 text-[#d5e7d6]">
                ✅ {isHindi ? 'हाँ! जननी सुरक्षा योजना (JSY) के तहत सरकारी अस्पताल में प्रसव कराने पर ₹1,400 सीधे बैंक खाते में मिलते हैं और 108 एम्बुलेंस मुफ्त है।' : 'Yes! Under Janani Suraksha Yojana (JSY), you receive ₹1,400 DBT cash support and free 108 drop-back ambulance.'}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-[#c4dfc7]">Ayushman PM-JAY</p>
                <p className="mt-1 font-display text-lg font-bold">₹5,00,000</p>
                <p className="text-[10px] text-[#d5e7d6]">Free Cashless Hospital Care</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-[#c4dfc7]">Jan Aushadhi</p>
                <p className="mt-1 font-display text-lg font-bold">50-90% Off</p>
                <p className="text-[10px] text-[#d5e7d6]">Generic Quality Medicines</p>
              </div>
            </div>
          </div>

          {/* Quick Feature Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-semibold text-[#294f4b]">
            <div className="flex items-center gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] p-3 shadow-2xs">
              <CheckCircle2 size={16} className="text-[#1f655d]" />
              <span>{isHindi ? '100% सत्यापित डेटा' : 'Verified Gov Data'}</span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] p-3 shadow-2xs">
              <Camera size={16} className="text-[#e76f46]" />
              <span>{isHindi ? 'पर्ची व फोटो जाँच' : 'Prescription OCR'}</span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] p-3 shadow-2xs col-span-2 sm:col-span-1">
              <Siren size={16} className="text-[#b74636]" />
              <span>{isHindi ? '108 आपातकालीन SOS' : 'Emergency SOS'}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
