import React from 'react';
import { Bookmark, BookmarkCheck, ArrowRight, ShieldCheck, CheckCircle, ExternalLink, Calculator } from 'lucide-react';
import { Link } from 'wouter';
import { LiveSourceBadge } from '@/components/common/LiveSourceBadge';

export function SchemeCard({ scheme, isSaved, onToggleSave, onCheckEligibility, language = 'Hindi' }) {
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  return (
    <div
      id={`card-scheme-${scheme.id}`}
      className="lift-card flex flex-col justify-between rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-5 shadow-xs transition hover:border-[#1f655d]"
      data-testid={`card-scheme-${scheme.id}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#dceee9] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1f655d]">
              {scheme.category || 'Government Scheme'}
            </span>
            <LiveSourceBadge
              sourceType={scheme.is_curated ? 'curated' : 'tavily_live'}
              sourceName={scheme.source_name}
              verifiedAt={scheme.verified_at}
            />
          </div>

          <button
            type="button"
            onClick={() => onToggleSave && onToggleSave(scheme.id)}
            aria-label={isSaved ? 'Remove from saved' : 'Save scheme'}
            className={`grid h-8 w-8 place-items-center rounded-full border transition ${
              isSaved
                ? 'border-[#1f655d] bg-[#1f655d] text-[#f9f2df]'
                : 'border-[#dacfb9] bg-[#fbf7ec] text-[#637d74] hover:bg-[#eee4d0]'
            }`}
            data-testid={`btn-save-scheme-${scheme.id}`}
          >
            {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </button>
        </div>

        <h3 className="mt-3 font-display text-xl font-bold leading-snug text-[#214e4a]">
          {isHindi && scheme.name_hi ? scheme.name_hi : scheme.name}
        </h3>

        <div className="mt-2 rounded-xl bg-[#f5efe2] px-3 py-1.5 text-xs font-bold text-[#8a572a]">
          💰 {isHindi ? 'सहायता राशि' : 'Coverage'}: {scheme.coverage_amount}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[#5c726b] line-clamp-3">
          {isHindi && scheme.summary_hi ? scheme.summary_hi : scheme.summary}
        </p>

        {scheme.key_benefits && scheme.key_benefits.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-[#3a5851]">
            {scheme.key_benefits.slice(0, 2).map((benefit, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-[#1f655d]" />
                <span className="line-clamp-1">{benefit}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-[#ded5c2] pt-3">
        <button
          type="button"
          onClick={() => onCheckEligibility && onCheckEligibility(scheme)}
          className="flex items-center gap-1 text-xs font-bold text-[#8a572a] hover:underline"
          data-testid={`btn-check-eligibility-${scheme.id}`}
        >
          <Calculator size={14} />
          <span>{isHindi ? 'पात्रता जाँचें' : 'Check Eligibility'}</span>
        </button>

        <Link
          href={`/schemes/${scheme.id}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1f655d] px-3.5 py-1.5 text-xs font-bold text-[#f9f2df] shadow-2xs hover:bg-[#18534c]"
          data-testid={`link-scheme-detail-${scheme.id}`}
        >
          <span>{isHindi ? 'पूरी जानकारी' : 'View Details'}</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
