import React from 'react';
import { Siren, Phone, ArrowRight, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';

export function EmergencyBanner({ language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  return (
    <div
      id="banner-emergency-fast-path"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#b74636] to-[#922d21] p-5 text-[#fff7e9] shadow-lg"
      data-testid="banner-emergency"
    >
      <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full border border-white/15" />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-white animate-pulse">
            <Siren size={26} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#ffe5d5]">
                {isHindi ? 'त्वरित आपातकालीन सेवा' : 'Immediate Emergency Path'}
              </span>
            </div>
            <h3 className="mt-1 font-display text-xl font-bold">
              {isHindi ? 'क्या किसी को तत्काल मदद की आवश्यकता है?' : 'Need Urgent Medical Emergency Help?'}
            </h3>
            <p className="mt-0.5 text-xs text-[#ffd7bf]">
              {isHindi
                ? '108 (एम्बुलेंस) / 112 (आपातकाल) सीधे कॉल करें या तुरंत आशा कार्यकर्ता को अलर्ट भेजें।'
                : 'Direct 108 Ambulance / 112 calling with instant GPS broadcast to local ASHA team.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href="tel:108"
            className="flex items-center gap-1.5 rounded-full bg-[#fff7e9] px-4 py-2 text-xs font-black text-[#8e332b] shadow-sm hover:bg-[#ffeedd]"
            data-testid="btn-banner-call-108"
          >
            <Phone size={14} /> 108 Ambulance
          </a>
          <Link
            href="/emergency"
            className="flex items-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20"
            data-testid="btn-banner-open-emergency"
          >
            <span>{isHindi ? 'आपातकालीन पेज' : 'Emergency Hub'}</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
