import React, { useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Wifi, WifiOff, Volume2, Database, Trash2, HelpCircle, HeartHandshake } from 'lucide-react';
import { useAppState } from '@/state/store';
import { LanguageSelector } from '@/components/common/LanguageSelector';
import { ConsentDialog } from '@/components/common/ConsentDialog';

export function Settings() {
  const { language, setLanguage, offlineMode, setOfflineMode, userProfile, updateProfile } = useAppState();
  const [consentOpen, setConsentOpen] = useState(false);
  const [clearedNotice, setClearedNotice] = useState(false);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const handleClearCache = () => {
    localStorage.removeItem('sehat_saved_schemes');
    setClearedNotice(true);
    setTimeout(() => setClearedNotice(false), 3000);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      {/* Header */}
      <div className="border-b border-rule pb-4">
        <span className="rounded-full bg-paper-2 px-3 py-1 text-xs font-bold text-amber uppercase">
          {isHindi ? 'सेटिंग्स व नियंत्रण' : 'Preferences & Offline Controls'}
        </span>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
          {isHindi ? 'ऐप सेटिंग्स व ऑफ़लाइन मोड' : 'Settings & Offline Access'}
        </h1>
        <p className="text-xs text-ink-soft">
          {isHindi
            ? 'कम इंटरनेट वाले क्षेत्रों के लिए ऑफ़लाइन कैशिंग, भाषा प्राथमिकता और गोपनीयता अनुमतियाँ।'
            : 'Configure low-connectivity caching, audio synthesis parameters, and data privacy rights.'}
        </p>
      </div>

      {clearedNotice && (
        <div className="rounded-2xl border border-seal/25 bg-seal-soft p-3 text-xs font-bold text-seal appear">
          {isHindi ? 'स्थानीय कैश साफ़ किया गया।' : 'Local application cache cleared.'}
        </div>
      )}

      {/* Settings Options */}
      <div className="rounded-3xl border border-rule bg-paper-2 p-6 space-y-5 shadow-xs">
        {/* Language Selection */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
          <div>
            <p className="font-bold text-sm text-ink">{isHindi ? 'डिफ़ॉल्ट भाषा' : 'Primary Language'}</p>
            <p className="text-xs text-ink-soft">{isHindi ? 'बोलने व पढ़ने के लिए' : 'Voice and text interface language'}</p>
          </div>
          <LanguageSelector language={language} setLanguage={setLanguage} />
        </div>

        {/* Offline Cache Mode Simulation */}
        <div className="flex items-start justify-between gap-3 border-b border-rule pb-4">
          <div>
            <p className="font-bold text-sm text-ink flex items-center gap-2">
              {offlineMode ? <WifiOff size={16} className="text-siren" /> : <Wifi size={16} className="text-seal" />}
              <span>{isHindi ? 'ग्रामीण ऑफ़लाइन मोड (Low Connectivity)' : 'Rural Offline Mode'}</span>
            </p>
            <p className="text-xs text-ink-soft">
              {isHindi ? 'इंटरनेट न होने पर भी जरूरी प्राथमिक उपचार व योजना विवरण तुरंत दिखाएं' : 'Preload essential health first-aid and scheme guidelines for zero-network rural areas'}
            </p>
          </div>

          <button
            onClick={() => setOfflineMode(!offlineMode)}
            className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
              offlineMode ? 'bg-seal' : 'bg-rule'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper-2 shadow-xs transition-transform ${
                offlineMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Consent & Privacy */}
        <div className="flex items-start justify-between gap-3 border-b border-rule pb-4">
          <div>
            <p className="font-bold text-sm text-ink flex items-center gap-2">
              <ShieldCheck size={16} className="text-seal" />
              <span>{isHindi ? 'डेटा गोपनीयता व सहमति प्रबंधन' : 'Privacy & Consents'}</span>
            </p>
            <p className="text-xs text-ink-soft">
              {isHindi ? 'आवाज़, स्थान व स्वास्थ्य रिकॉर्ड अनुमतियों को बदलें' : 'Manage STT, GPS location, and ASHA referral permissions'}
            </p>
          </div>

          <button
            onClick={() => setConsentOpen(true)}
            className="rounded-full bg-seal px-4 py-1.5 text-xs font-bold text-paper-2 hover:bg-seal"
          >
            {isHindi ? 'सहमति देखें' : 'Manage'}
          </button>
        </div>

        {/* Clear Local Storage */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div>
            <p className="font-bold text-sm text-ink flex items-center gap-2">
              <Database size={16} className="text-amber" />
              <span>{isHindi ? 'स्थानीय कैश साफ़ करें' : 'Clear Local Cache'}</span>
            </p>
            <p className="text-xs text-ink-soft">
              {isHindi ? 'सुरक्षित की गई योजनाओं और हाल की बातचीत का डेटा रीसेट करें' : 'Reset stored preferences and temporary conversation logs'}
            </p>
          </div>

          <button
            onClick={handleClearCache}
            className="flex items-center gap-1 rounded-full border border-rule bg-paper-2 px-4 py-1.5 text-xs font-bold text-siren hover:bg-siren-soft"
          >
            <Trash2 size={13} />
            <span>{isHindi ? 'साफ़ करें' : 'Clear'}</span>
          </button>
        </div>
      </div>

      {/* Official Health Mission Attribution */}
      <div className="rounded-3xl bg-seal-soft border border-rule p-6 text-xs text-ink space-y-2">
        <div className="flex items-center gap-2 font-bold text-sm text-seal">
          <HeartHandshake size={18} />
          <span>{isHindi ? 'आधिकारिक स्वास्थ्य सेवा डिस्क्लेमर' : 'Official Public Health Disclaimer'}</span>
        </div>
        <p className="leading-relaxed">
          {isHindi
            ? 'सेहत साथी राष्ट्रीय स्वास्थ्य मिशन (NHM) और स्वास्थ्य एवं परिवार कल्याण मंत्रालय के अनुमोदित प्रोटोकॉल पर आधारित मार्गदर्शक मंच है। यह किसी पंजीकृत चिकित्सक के व्यक्तिगत परीक्षण का विकल्प नहीं है।'
            : 'Sehat Sathi is a voice-first healthcare guidance and government scheme discovery layer aligned with National Health Mission protocols. It is designed to empower rural citizens and ASHA workers, not replace professional medical practitioners.'}
        </p>
      </div>

      <ConsentDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        consents={userProfile?.consents}
        onSaveConsents={(newConsents) => updateProfile({ consents: newConsents })}
        language={language}
      />
    </main>
  );
}
