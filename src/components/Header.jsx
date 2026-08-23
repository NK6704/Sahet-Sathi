import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  HeartPulse,
  Siren,
  Languages,
  Menu,
  X,
  UserCheck,
  ShieldCheck,
  Camera,
  Bot,
  FileText,
  MapPin,
  TrendingUp,
  Settings as SettingsIcon,
  HelpCircle,
  Bell
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { LanguageSelector } from '@/components/common/LanguageSelector';
import { ConsentDialog } from '@/components/common/ConsentDialog';

export function Header() {
  const { language, setLanguage, userRole, userProfile, updateProfile } = useAppState();
  const [, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  return (
    <>
      <header
        id="header-sehat-sathi"
        className="sticky top-0 z-40 border-b border-[#ded5c2] bg-[#f9f4e8]/95 backdrop-blur-md"
      >
        <div className="mx-auto flex h-[74px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1f655d] text-[#f9f2df] shadow-sm">
              <HeartPulse size={24} strokeWidth={2.2} />
            </span>
            <div>
              <span className="block font-display text-xl font-bold tracking-tight text-[#214e4a]">
                {isHindi ? 'सेहत साथी' : 'Sehat Sathi'}
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[#8a6b4a]">
                {userRole === 'asha' ? 'ASHA Healthcare Portal' : (isHindi ? 'ग्रामीण स्वास्थ्य साथी' : 'Rural Health Companion')}
              </span>
            </div>
          </Link>

          {/* Desktop Right Controls */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageSelector language={language} setLanguage={setLanguage} />

            <button
              onClick={() => setConsentOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-[#dacfb9] bg-[#fbf7ec] px-3 py-1.5 text-xs font-semibold text-[#355e58] shadow-2xs hover:bg-[#eee4d0]"
              title="Privacy & Consent"
            >
              <ShieldCheck size={15} className="text-[#1f655d]" />
              <span>{isHindi ? 'सहमति' : 'Privacy'}</span>
            </button>

            {userRole === 'asha' ? (
              <Link
                href="/asha"
                className="flex items-center gap-1.5 rounded-full bg-[#1f655d] px-4 py-2 text-xs font-bold text-[#f9f2df] shadow-sm hover:bg-[#18534c]"
              >
                <UserCheck size={15} />
                <span>ASHA Dashboard</span>
              </Link>
            ) : (
              <Link
                href="/emergency"
                className="flex items-center gap-2 rounded-full bg-[#b74636] px-4 py-2 text-xs font-extrabold text-[#fff7e9] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#9f392d]"
                data-testid="btn-header-emergency"
              >
                <Siren size={15} className="animate-pulse" />
                <span>{isHindi ? 'आपातकालीन 108' : 'Emergency 108'}</span>
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/emergency"
              className="flex items-center gap-1 rounded-full bg-[#b74636] px-3 py-1.5 text-xs font-bold text-white shadow-2xs"
            >
              <Siren size={14} /> 108
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-[#ded5c2] text-[#35615a] bg-[#fbf7ec]"
              aria-label="Toggle Navigation"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="border-t border-[#ded5c2] bg-[#fbf8ef] px-5 py-4 md:hidden appear space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#627a72]">Language / भाषा:</span>
              <LanguageSelector language={language} setLanguage={setLanguage} />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#ded5c2]">
              <Link
                href="/app"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5 text-xs font-bold text-[#214e4a]"
              >
                <Bot size={16} className="text-[#1f655d]" /> {isHindi ? 'होम' : 'Home'}
              </Link>
              <Link
                href="/assistant"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#dceee9] p-2.5 text-xs font-bold text-[#1f655d]"
              >
                <Bot size={16} /> {isHindi ? 'आवाज़ साथी' : 'AI Voice'}
              </Link>
              <Link
                href="/schemes"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5 text-xs font-bold text-[#214e4a]"
              >
                <FileText size={16} className="text-[#8a572a]" /> {isHindi ? 'योजनाएं' : 'Schemes'}
              </Link>
              <Link
                href="/care"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5 text-xs font-bold text-[#214e4a]"
              >
                <MapPin size={16} className="text-[#1f655d]" /> {isHindi ? 'पास का इलाज' : 'Find Care'}
              </Link>
              <Link
                href="/image-assist"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5 text-xs font-bold text-[#214e4a]"
              >
                <Camera size={16} className="text-[#c36a42]" /> {isHindi ? 'पर्ची जाँच' : 'Image Assist'}
              </Link>
              <Link
                href="/asha/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5 text-xs font-bold text-[#214e4a]"
              >
                <UserCheck size={16} className="text-[#1f655d]" /> {isHindi ? 'आशा पोर्टल' : 'ASHA Portal'}
              </Link>
            </div>
          </div>
        )}
      </header>

      <ConsentDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        consents={userProfile?.consents}
        onSaveConsents={(newConsents) => updateProfile({ consents: newConsents })}
        language={language}
      />
    </>
  );
}
