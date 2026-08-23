import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Mic,
  Bot,
  HeartPulse,
  FileText,
  MapPin,
  Camera,
  TrendingUp,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Phone,
  CheckCircle2,
  LocateFixed,
  Search,
  Volume2
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { EmergencyBanner } from '@/components/emergency/EmergencyBanner';

export function UserHome() {
  const { language, userProfile } = useAppState();
  const [, setLocation] = useLocation();

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const quickPaths = [
    { href: '/assistant', label: isHindi ? 'बोलकर पूछें' : 'Voice Assistant', hindi: 'आवाज़ साथी', icon: Mic, color: 'bg-[#dceee9]', textColor: 'text-[#1f655d]' },
    { href: '/schemes', label: isHindi ? 'सरकारी योजनाएँ' : 'Health Schemes', hindi: 'आयुष्मान व अन्य', icon: FileText, color: 'bg-[#f5e7cd]', textColor: 'text-[#8a572a]' },
    { href: '/care', label: isHindi ? 'पास का इलाज' : 'Nearby Healthcare', hindi: 'PHC, CHC व दवाइयाँ', icon: MapPin, color: 'bg-[#e4e4ef]', textColor: 'text-[#355e58]' },
    { href: '/image-assist', label: isHindi ? 'पर्ची / दवा फोटो' : 'Prescription OCR', hindi: 'दवा व जाँच समझें', icon: Camera, color: 'bg-[#fcedea]', textColor: 'text-[#b74636]' },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-24 md:pb-12 space-y-6">
      {/* Top Greeting & Location */}
      <div className="flex flex-wrap items-center justify-between gap-4 appear">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#c36a42]">
            {isHindi ? 'नमस्ते एवं शुभ दिन' : 'Welcome to Sehat Sathi'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[#214e4a] sm:text-4xl">
            {isHindi ? `${userProfile?.name || 'मीरा'}, आज आपकी कैसे मदद करें?` : `How can we help you today, ${userProfile?.name || 'Meera'}?`}
          </h1>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] px-3.5 py-2 text-xs font-semibold text-[#48635a] shadow-2xs">
          <LocateFixed size={15} className="text-[#c36a42]" />
          <span>{userProfile?.village || 'Mandi'}, {userProfile?.district || 'Sehore'}</span>
        </div>
      </div>

      {/* Primary Voice Action Banner */}
      <section
        id="card-home-voice-hero"
        className="relative overflow-hidden rounded-[2.5rem] bg-[#1f655d] p-6 text-[#f8f2df] shadow-xl sm:p-9 appear"
      >
        <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute -right-2 -top-12 h-44 w-44 rounded-full border border-white/10" />

        <div className="relative z-10 max-w-xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#c4dfc7]">
            <Volume2 size={14} />
            <span>{isHindi ? 'सीधे बोलकर पूछें (आवाज़ साथी)' : 'Voice-First AI Assistant'}</span>
          </div>

          <h2 className="mt-3 font-display text-3xl leading-tight font-bold text-white sm:text-4xl">
            {isHindi ? 'आपको क्या तकलीफ है या कौन सी योजना चाहिए?' : 'Describe your symptoms or ask about any government scheme'}
          </h2>

          <p className="mt-3 text-xs sm:text-sm leading-relaxed text-[#d5e7d6]">
            {isHindi
              ? 'बिना टाइप किए अपनी मातृभाषा में बोलें। बुखार, प्रसव सहायता, ₹5 लाख का आयुष्मान कार्ड, या पास के अस्पताल की जानकारी तुरंत पाएं।'
              : 'Speak naturally in your language. Get instant safe guidance, scheme eligibility (PM-JAY, JSY), or connect with your local ASHA worker.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/assistant"
              className="flex items-center gap-2 rounded-full bg-[#e76f46] px-6 py-3 text-sm font-extrabold text-[#fff7e9] shadow-md transition hover:bg-[#d65f37] active:scale-95"
              data-testid="btn-home-speak"
            >
              <Mic size={18} />
              <span>{isHindi ? 'माइक दबाकर बोलें' : 'Tap to Speak Now'}</span>
              <ArrowRight size={16} />
            </Link>

            <Link
              href="/schemes"
              className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-4 py-3 text-xs font-bold text-white hover:bg-white/20"
            >
              <FileText size={15} />
              <span>{isHindi ? 'योजनाएं खोजें' : 'Search Schemes'}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Emergency Fast Path Banner */}
      <EmergencyBanner language={language} />

      {/* Quick Services 4-Grid */}
      <section aria-labelledby="quick-services-title" className="appear">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="quick-services-title" className="font-display text-xl font-bold text-[#214e4a]">
            {isHindi ? 'त्वरित स्वास्थ्य सेवाएँ' : 'Quick Access Paths'}
          </h2>
          <span className="text-xs text-[#718b82] font-medium">
            {isHindi ? 'स्पष्ट और सुरक्षित उत्तर' : 'Clear & Verified Answers'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickPaths.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="lift-card flex min-h-[135px] flex-col justify-between rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-4 shadow-xs hover:border-[#1f655d]"
                data-testid={`link-quick-${item.href.replace('/', '')}`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-2xl ${item.color} ${item.textColor}`}>
                  <Icon size={22} />
                </span>
                <div>
                  <span className="block text-sm font-bold text-[#214e4a]">{item.label}</span>
                  <span className="block text-[11px] text-[#6d847b]">{item.hindi}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Two-Column Section: Verified Scheme Highlight & Daily Care Tip */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr] appear">
        {/* Scheme Highlight Card */}
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-[#f5e7cd] px-3 py-1 text-xs font-bold text-[#8a572a]">
              ⭐ {isHindi ? 'लोकप्रिय सरकारी योजना' : 'Featured Government Scheme'}
            </span>
            <span className="text-[11px] font-bold text-[#1f655d]">Verified Data</span>
          </div>

          <h3 className="mt-3 font-display text-2xl font-bold text-[#214e4a]">
            {isHindi ? 'आयुष्मान भारत PM-JAY (मुफ्त ₹5 लाख इलाज)' : 'Ayushman Bharat PM-JAY Health Cover'}
          </h3>

          <p className="mt-2 text-xs leading-relaxed text-[#546e65]">
            {isHindi
              ? 'गरीब एवं कमजोर परिवारों को सूचीबद्ध सरकारी व निजी अस्पतालों में प्रतिवर्ष ₹5 लाख तक का कैशलेस इलाज मिलता है। कोई उम्र या परिवार आकार की सीमा नहीं।'
              : '₹5,00,000 annual cashless hospitalization coverage per family across empaneled public and private hospitals. No family size or age capping.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3 pt-2 border-t border-[#ded5c2]">
            <Link
              href="/schemes/pmjay-ayushman"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1f655d] px-4 py-2 text-xs font-bold text-[#f9f2df] hover:bg-[#18534c]"
            >
              <span>{isHindi ? 'पात्रता व आवेदन प्रक्रिया देखें' : 'View Eligibility & Process'}</span>
              <ArrowRight size={14} />
            </Link>

            <Link
              href="/care"
              className="text-xs font-bold text-[#8a572a] hover:underline"
            >
              {isHindi ? 'पास का आयुष्मान केंद्र खोजें' : 'Find Empaneled Hospital'}
            </Link>
          </div>
        </div>

        {/* Daily Rural Health Care Tip */}
        <div className="rounded-3xl border border-[#ded5c2] bg-[#eef5f1] p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1f655d]">
              <Sparkles size={16} className="text-[#e76f46]" />
              <span>{isHindi ? 'आज की स्वास्थ्य सलाह' : 'Daily Health Care Note'}</span>
            </div>

            <h4 className="mt-2 font-display text-xl font-bold text-[#214e4a]">
              {isHindi ? 'उबला पानी और समय पर ओआरएस (ORS)' : 'Safe Drinking Water & Hydration'}
            </h4>

            <p className="mt-2 text-xs leading-relaxed text-[#48635a]">
              {isHindi
                ? 'दस्त या उल्टी होने पर तुरंत ओआरएस घोल या नमक-चीनी का पानी पिएं। बच्चों में बुखार 2 दिन से अधिक रहे तो आशा कार्यकर्ता से तुरंत संपर्क करें।'
                : 'For dehydration or fever, prepare fresh ORS solution in clean boiled water. Never delay consulting your ASHA worker if infant fever exceeds 24 hours.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-[#cbd9cc] flex items-center justify-between">
            <Link href="/assistant" className="text-xs font-bold text-[#1f655d] flex items-center gap-1 hover:underline">
              <span>{isHindi ? 'AI से और पूछें' : 'Ask AI Voice'}</span>
              <ArrowRight size={13} />
            </Link>
            <span className="text-[10px] text-[#718b82]">NHM Health Protocol</span>
          </div>
        </div>
      </div>
    </main>
  );
}
