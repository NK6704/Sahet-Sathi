import React, { useCallback, useEffect, useState } from 'react';
import { useRoute, Link } from 'wouter';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  FileText,
  ExternalLink,
  Calculator,
  Building2,
  Phone,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { getSchemeById } from '@/services/api';
import { LiveSourceBadge } from '@/components/common/LiveSourceBadge';
import { EligibilityModal } from '@/components/schemes/EligibilityModal';
import {
  Btn,
  Card,
  Eyebrow,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
  SectionHead,
} from '@/components/ds';

/* =============================================================
   /schemes/:id — one scheme in full.

   Structured as a register page: the entitlement first, then what
   you get, then what you must bring, then what you do. That order
   matters because it is the order a person actually needs it in
   while standing at a counter.

   The published criteria are labelled as criteria, not as a verdict.
   ============================================================= */

export function SchemeDetail() {
  const [, params] = useRoute('/schemes/:id');
  const schemeId = params?.id;
  const { language, savedSchemeIds, toggleSaveScheme, userProfile } = useAppState();

  const hi = language === 'हिन्दी' || language === 'Hindi';
  const t = (en, dev) => (hi ? dev : en);

  const [scheme, setScheme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eligibilityOpen, setEligibilityOpen] = useState(false);

  const isSaved = schemeId ? savedSchemeIds.includes(schemeId) : false;

  const load = useCallback(() => {
    if (!schemeId) return;
    setLoading(true);
    setError(null);
    getSchemeById(schemeId)
      .then((data) => setScheme(data ?? null))
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [schemeId]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link
      href="/schemes"
      className="inline-flex min-h-11 items-center gap-1.5 text-[0.85rem] font-semibold text-ink-soft transition-colors hover:text-ink"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {t('All schemes', 'सभी योजनाएँ')}
    </Link>
  );

  if (loading) {
    return (
      <main className="shell pad-bottom-nav pt-6">
        {back}
        <div className="mt-6">
          <LoadingState label={t('Loading the scheme', 'योजना लोड हो रही है')} rows={3} />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="shell pad-bottom-nav pt-6">
        {back}
        <div className="mt-6">
          <ErrorState
            title={t("Couldn't load this scheme", 'योजना लोड नहीं हुई')}
            onRetry={load}
            retryLabel={t('Try again', 'फिर कोशिश करें')}
          />
        </div>
      </main>
    );
  }

  if (!scheme) {
    return (
      <main className="shell pad-bottom-nav pt-6">
        {back}
        <div className="mt-6">
          <EmptyState
            title={t('Scheme not found', 'योजना नहीं मिली')}
            body={t(
              'This scheme is not in our records. It may have been renamed or replaced — the directory lists what we can confirm.',
              'यह योजना हमारे रिकॉर्ड में नहीं है। इसका नाम बदला या इसे हटाया गया हो सकता है — सूची में वही है जिसकी पुष्टि हो सकती है।',
            )}
            action={
              <Btn as={Link} href="/schemes" variant="outline">
                {t('Back to schemes', 'योजनाओं पर वापस')}
              </Btn>
            }
          />
        </div>
      </main>
    );
  }

  const steps = scheme.application_process?.steps ?? [];
  const docs = scheme.documents_required ?? [];

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-6 sm:pt-8 ${hi ? 'is-deva' : ''}`}>
      {back}

      {/* ---------- The entitlement ---------- */}
      <Card tone="seal" className="mt-5 p-6 sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{scheme.category || t('Government scheme', 'सरकारी योजना')}</Eyebrow>
            <div className="mt-3">
              <LiveSourceBadge
                sourceType={scheme.is_curated ? 'curated' : 'live'}
                sourceName={scheme.source_name}
                sourceUrl={scheme.official_portal || scheme.source_url}
                verifiedAt={scheme.verified_at}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggleSaveScheme(scheme.id)}
            aria-pressed={isSaved}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.85rem] font-semibold transition-colors ${
              isSaved
                ? 'border-asha bg-asha text-white'
                : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {isSaved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
            {isSaved ? t('Saved', 'सहेजी गई') : t('Save', 'सहेजें')}
          </button>
        </div>

        <h1 className="display-lg mt-6 max-w-3xl">
          {hi && scheme.name_hi ? scheme.name_hi : scheme.name}
        </h1>

        {scheme.coverage_amount ? (
          <div className="mt-7">
            <Eyebrow>{t('What you get', 'आपको क्या मिलता है')}</Eyebrow>
            <p className="figure mt-2 text-4xl text-seal sm:text-5xl">{scheme.coverage_amount}</p>
          </div>
        ) : null}

        <p className="lede mt-6 max-w-2xl">
          {hi && scheme.summary_hi ? scheme.summary_hi : scheme.summary}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <Btn variant="primary" size="lg" onClick={() => setEligibilityOpen(true)}>
            <Calculator size={17} aria-hidden="true" />
            {t('Check my eligibility', 'मेरी पात्रता जाँचें')}
          </Btn>

          {scheme.official_portal ? (
            <Btn
              as="a"
              href={scheme.official_portal}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
            >
              {t('Official portal', 'आधिकारिक पोर्टल')}
              <ExternalLink size={15} aria-hidden="true" />
            </Btn>
          ) : null}

          {scheme.helpline ? (
            <Btn as="a" href={`tel:${String(scheme.helpline).replace(/[^\d+]/g, '')}`} variant="outline">
              <Phone size={15} aria-hidden="true" />
              {scheme.helpline}
            </Btn>
          ) : null}
        </div>

        <InferenceNote className="mt-6 max-w-2xl">
          {t(
            'These are the published rules, not a decision on your case. The department has the final say.',
            'ये प्रकाशित नियम हैं, आपके मामले का निर्णय नहीं। अंतिम निर्णय विभाग का होता है।',
          )}
        </InferenceNote>
      </Card>

      {/* ---------- Benefits ---------- */}
      {scheme.key_benefits?.length ? (
        <section className="mt-12">
          <SectionHead index="001" eyebrow={t('Benefits', 'लाभ')} title={t('What the scheme covers', 'योजना में क्या शामिल है')} />
          <Card className="mt-6 p-6">
            <ul className="space-y-3 text-[0.92rem] leading-relaxed text-ink-soft">
              {scheme.key_benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Check size={16} className="mt-1 shrink-0 text-seal" strokeWidth={2.6} aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {/* ---------- Documents + how to apply ---------- */}
      {docs.length || steps.length ? (
        <section className="mt-12 pb-4">
          <SectionHead
            index="002"
            eyebrow={t('Applying', 'आवेदन')}
            title={t('What to bring, and where to go', 'क्या ले जाएँ, और कहाँ जाएँ')}
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {docs.length ? (
              <Card tone="amber" className="p-6">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="shrink-0 text-amber" aria-hidden="true" />
                  <Eyebrow>{t('Documents to carry', 'साथ ले जाने के कागज़')}</Eyebrow>
                </div>
                <ul className="mt-4 space-y-2">
                  {docs.map((doc, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 rounded-sm border border-rule-soft bg-paper-3 px-3.5 py-3 text-[0.88rem] text-ink-soft"
                    >
                      <span className="reg-index mt-0.5 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[0.78rem] leading-relaxed text-ink-faint">
                  {t(
                    'Take the originals as well as photocopies. Offices often keep the copies.',
                    'मूल कागज़ और फ़ोटोकॉपी दोनों ले जाएँ। कार्यालय अक्सर कॉपी रख लेते हैं।',
                  )}
                </p>
              </Card>
            ) : null}

            {steps.length ? (
              <Card tone="seal" className="p-6">
                <div className="flex items-center gap-2">
                  <Building2 size={16} className="shrink-0 text-seal" aria-hidden="true" />
                  <Eyebrow>{t('How to apply', 'आवेदन कैसे करें')}</Eyebrow>
                </div>
                <ol className="mt-4 space-y-4">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-seal font-mono text-[0.66rem] font-medium text-white">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 text-[0.9rem] leading-relaxed text-ink-soft">{step}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}

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
