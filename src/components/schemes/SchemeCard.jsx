import React from 'react';
import { Bookmark, BookmarkCheck, ArrowRight, Check, Calculator } from 'lucide-react';
import { Link } from 'wouter';
import { LiveSourceBadge } from '@/components/common/LiveSourceBadge';
import { Card, Eyebrow } from '@/components/ds';

/* =============================================================
   One scheme.

   Two rules from the brief live in this card. First, the coverage
   amount is never shown bare — it is always attached to the scheme
   that publishes it, via the source badge at the top. Second, the
   eligibility control is labelled "Check eligibility", never
   "You qualify": the check produces a maybe, and the card must not
   promise more than the check can deliver.
   ============================================================= */

export function SchemeCard({ scheme, isSaved, onToggleSave, onCheckEligibility, language = 'Hindi' }) {
  const hi = language === 'हिन्दी' || language === 'Hindi';
  const t = (en, dev) => (hi ? dev : en);

  return (
    <Card
      id={`card-scheme-${scheme.id}`}
      tone="seal"
      lift
      className="flex flex-col justify-between p-5"
      data-testid={`card-scheme-${scheme.id}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{scheme.category || t('Government scheme', 'सरकारी योजना')}</Eyebrow>
            <div className="mt-2.5">
              <LiveSourceBadge
                sourceType={scheme.is_curated ? 'curated' : 'tavily_live'}
                sourceName={scheme.source_name}
                sourceUrl={scheme.source_url || scheme.official_url}
                verifiedAt={scheme.verified_at}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => onToggleSave && onToggleSave(scheme.id)}
            aria-label={
              isSaved ? t('Remove from saved', 'सहेजी सूची से हटाएँ') : t('Save this scheme', 'योजना सहेजें')
            }
            aria-pressed={!!isSaved}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors ${
              isSaved
                ? 'border-asha bg-asha text-white'
                : 'border-rule text-ink-faint hover:border-ink hover:text-ink'
            }`}
            data-testid={`btn-save-scheme-${scheme.id}`}
          >
            {isSaved ? <BookmarkCheck size={17} aria-hidden="true" /> : <Bookmark size={17} aria-hidden="true" />}
          </button>
        </div>

        <h3 className="mt-4 text-lg font-semibold leading-snug text-ink">
          {hi && scheme.name_hi ? scheme.name_hi : scheme.name}
        </h3>

        {scheme.coverage_amount ? (
          <p className="mt-3">
            <span className="eyebrow">{t('Cover', 'सहायता राशि')}</span>
            <span className="figure mt-1 block text-2xl text-seal">{scheme.coverage_amount}</span>
          </p>
        ) : null}

        <p className="mt-3 line-clamp-3 text-[0.87rem] leading-relaxed text-ink-soft">
          {hi && scheme.summary_hi ? scheme.summary_hi : scheme.summary}
        </p>

        {scheme.key_benefits?.length ? (
          <ul className="mt-4 space-y-1.5 text-[0.85rem] text-ink-soft">
            {scheme.key_benefits.slice(0, 2).map((benefit, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check size={13} className="mt-1 shrink-0 text-seal" strokeWidth={2.6} aria-hidden="true" />
                <span className="line-clamp-2">{benefit}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
        <button
          type="button"
          onClick={() => onCheckEligibility && onCheckEligibility(scheme)}
          className="inline-flex min-h-10 items-center gap-1.5 text-[0.85rem] font-semibold text-asha underline-offset-4 hover:underline"
          data-testid={`btn-check-eligibility-${scheme.id}`}
        >
          <Calculator size={14} aria-hidden="true" />
          {t('Check eligibility', 'पात्रता जाँचें')}
        </button>

        <Link
          href={`/schemes/${scheme.id}`}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-[0.85rem] font-semibold text-paper transition-colors hover:bg-seal"
          data-testid={`link-scheme-detail-${scheme.id}`}
        >
          {t('Full details', 'पूरी जानकारी')}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
