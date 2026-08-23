import React, { useState, useEffect } from 'react';
import { useRoute, Link } from 'wouter';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Phone,
  ExternalLink,
  Calculator,
  Building2
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { getSchemeById } from '@/services/api';
import { LiveSourceBadge } from '@/components/common/LiveSourceBadge';
import { EligibilityModal } from '@/components/schemes/EligibilityModal';

export function SchemeDetail() {
  const [, params] = useRoute('/schemes/:id');
  const schemeId = params?.id;
  const { language, savedSchemeIds, toggleSaveScheme, userProfile } = useAppState();

  const [scheme, setScheme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eligibilityOpen, setEligibilityOpen] = useState(false);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';
  const isSaved = schemeId ? savedSchemeIds.includes(schemeId) : false;

  useEffect(() => {
    if (!schemeId) return;
    setLoading(true);
    getSchemeById(schemeId)
      .then((data) => setScheme(data))
      .catch((err) => console.warn('Scheme detail load err:', err))
      .finally(() => setLoading(false));
  }, [schemeId]);

  if (loading) {
    return (
      <div className="py-20 text-center text-sm font-bold text-[#1f655d] animate-pulse">
        {isHindi ? 'योजना का विवरण लोड हो रहा है…' : 'Loading scheme details…'}
      </div>
    );
  }

  if (!scheme) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h2 className="font-display text-2xl font-bold text-[#214e4a]">
          {isHindi ? 'योजना नहीं मिली' : 'Scheme Not Found'}
        </h2>
        <Link href="/schemes" className="mt-4 inline-block text-sm font-bold text-[#1f655d] underline">
          ← {isHindi ? 'योजना सूची पर वापस जाएं' : 'Back to schemes directory'}
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6 appear">
      {/* Back Button */}
      <div>
        <Link
          href="/schemes"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#5c726a] hover:text-[#1f655d]"
        >
          <ArrowLeft size={16} />
          <span>{isHindi ? 'सभी योजनाओं पर वापस' : 'Back to all schemes'}</span>
        </Link>
      </div>

      {/* Main Scheme Hero Banner */}
      <div className="rounded-[2.5rem] border border-[#ded5c2] bg-[#fbf8ef] p-6 sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#dceee9] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#1f655d]">
              {scheme.category}
            </span>
            <LiveSourceBadge
              sourceType={scheme.is_curated ? 'curated' : 'live'}
              sourceName={scheme.source_name}
              verifiedAt={scheme.verified_at}
            />
          </div>

          <button
            onClick={() => toggleSaveScheme(scheme.id)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${
              isSaved
                ? 'bg-[#1f655d] text-[#f9f2df]'
                : 'border border-[#dacfb9] bg-[#fbf7ec] text-[#47625a] hover:bg-[#eee4d0]'
            }`}
          >
            {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            <span>{isSaved ? (isHindi ? 'सुरक्षित है' : 'Saved') : (isHindi ? 'सुरक्षित करें' : 'Save Scheme')}</span>
          </button>
        </div>

        <h1 className="mt-4 font-display text-3xl font-bold text-[#214e4a] sm:text-4xl">
          {isHindi && scheme.name_hi ? scheme.name_hi : scheme.name}
        </h1>

        <div className="mt-4 inline-block rounded-2xl bg-[#f5efe2] px-4 py-2 text-sm font-extrabold text-[#8a572a]">
          💰 {isHindi ? 'वित्तीय सहायता राशि' : 'Financial Benefit'}: {scheme.coverage_amount}
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[#48635a]">
          {isHindi && scheme.summary_hi ? scheme.summary_hi : scheme.summary}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-[#ded5c2]">
          <button
            onClick={() => setEligibilityOpen(true)}
            className="flex items-center gap-2 rounded-full bg-[#1f655d] px-6 py-2.5 text-xs font-bold text-[#f9f2df] shadow-xs hover:bg-[#18534c]"
          >
            <Calculator size={16} />
            <span>{isHindi ? 'अपनी पात्रता जांचें' : 'Check My Eligibility'}</span>
          </button>

          {scheme.official_portal && (
            <a
              href={scheme.official_portal}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-[#cbd9cc] bg-[#fbf7ec] px-4 py-2.5 text-xs font-bold text-[#1f655d] hover:bg-[#eef5f1]"
            >
              <span>{isHindi ? 'आधिकारिक सरकारी पोर्टल' : 'Official Portal'}</span>
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Key Benefits */}
      <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 shadow-xs">
        <h2 className="font-display text-xl font-bold text-[#214e4a]">
          ✨ {isHindi ? 'मुख्य लाभ व विशेषताएं' : 'Key Scheme Benefits'}
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-[#38534c]">
          {scheme.key_benefits?.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#1f655d]" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Required Documents & Application Steps Grid */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Documents */}
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 shadow-xs">
          <h3 className="font-display text-lg font-bold text-[#214e4a] flex items-center gap-2">
            <FileText size={18} className="text-[#8a572a]" />
            <span>{isHindi ? 'ज़रूरी दस्तावेज़ (Checklist)' : 'Required Documents'}</span>
          </h3>
          <ul className="mt-3 space-y-2 text-xs text-[#48635a]">
            {scheme.documents_required?.map((doc, idx) => (
              <li key={idx} className="flex items-center gap-2 rounded-xl bg-[#f5efe2] p-2.5">
                <span className="font-bold text-[#1f655d]">📄</span>
                <span>{doc}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* How to Apply */}
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 shadow-xs">
          <h3 className="font-display text-lg font-bold text-[#214e4a] flex items-center gap-2">
            <Building2 size={18} className="text-[#1f655d]" />
            <span>{isHindi ? 'आवेदन कैसे करें (कदम दर कदम)' : 'How to Apply'}</span>
          </h3>
          <div className="mt-3 space-y-2 text-xs text-[#48635a]">
            {scheme.application_process?.steps?.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1f655d] text-[10px] font-bold text-white">
                  {idx + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Eligibility Modal */}
      <EligibilityModal
        scheme={scheme}
        open={eligibilityOpen}
        onClose={() => setEligibilityOpen(false)}
        userProfile={userProfile}
        language={language}
      />
    </main>
  );
}
