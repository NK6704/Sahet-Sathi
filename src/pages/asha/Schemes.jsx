import React, { useMemo, useState } from 'react';
import { ExternalLink, FileText, ChevronDown, Check, ListOrdered } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { useAsync } from '@/lib/useAsync';
import { getCuratedSchemes } from '@/services/api';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Pill,
  Stamp,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';
import { FilterBar, formatDate } from '@/components/asha/parts';

/* =============================================================
   /asha/schemes — what a worker can actually tell a family.

   Two rules govern this whole page:

     1. Never present eligibility as guaranteed. The phrasing is
        always "may be eligible based on the available information".
     2. Amounts, documents and sources are quoted, never computed.
        `coverage_amount` arrives as a sentence — "₹5,00,000 per
        family per year" — and is printed exactly as it arrived. An
        earlier version parsed a number out of it and reformatted it
        with a rupee sign, which quietly dropped "per family per
        year" and turned a yearly family cap into what looked like a
        one-off payment. A stale or reworded number here means a
        family travels for money that isn't coming.

   The list comes from GET /api/schemes via getCuratedSchemes. The
   page asks for the whole curated set once and filters in the
   browser, so the count beside each category is the true number of
   schemes in it rather than a guess made before the data arrived.
   ============================================================= */

const CATEGORIES = [
  { value: 'all', en: 'All', hi: 'सभी' },
  { value: 'General', en: 'General care', hi: 'सामान्य इलाज' },
  { value: 'Maternal & Child', en: 'Mother and child', hi: 'मातृत्व व शिशु' },
  { value: 'Medicines', en: 'Medicines', hi: 'दवाइयाँ' },
  { value: 'Elderly & Chronic', en: 'Elderly and long-term', hi: 'वृद्धजन व दीर्घकालिक' },
  { value: 'Specialized', en: 'Specialised', hi: 'विशेष' },
];

export function AshaSchemes() {
  const { profile } = useAuth();
  const { language } = useAppState();
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const { data, error, loading, reload } = useAsync(() => getCuratedSchemes(), []);
  const all = useMemo(() => data?.schemes ?? [], [data]);

  const rows = useMemo(() => {
    let out = all;
    if (category !== 'all') out = out.filter((s) => s.category === category);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((s) =>
        [s.name, s.name_hi, s.summary, s.summary_hi, s.coverage_amount, s.source_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [all, category, query]);

  /* Only the categories the data actually contains are offered. A
     chip that can only ever say "0" teaches a worker that the filter
     is broken. */
  const options = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        value: c.value,
        label: t(c.en, c.hi),
        count: c.value === 'all' ? all.length : all.filter((s) => s.category === c.value).length,
      })).filter((c) => c.value === 'all' || c.count > 0),
    [all, hi],
  );

  return (
    <AshaShell
      eyebrow={t('Register 005 · Schemes', 'रजिस्टर 005 · योजनाएँ')}
      title={t('What families can claim', 'परिवार क्या पा सकते हैं')}
      sub={t(
        'Benefit amounts, documents and application steps as published by the ministry. Read them out — do not promise them.',
        'मंत्रालय द्वारा प्रकाशित राशि, दस्तावेज़ और आवेदन के चरण। पढ़कर बताएँ — वादा न करें।',
      )}
    >
      {/* This sits above the list on purpose. It is the single most
          important sentence on the page. */}
      <InferenceNote className="mb-6">
        {t(
          'Nothing here is an approval. Tell families they may be eligible based on the available information, and that the final decision rests with the department.',
          'यहाँ कुछ भी मंज़ूरी नहीं है। परिवारों को बताएँ कि उपलब्ध जानकारी के आधार पर वे पात्र हो सकते हैं, और अंतिम निर्णय विभाग का है।',
        )}
      </InferenceNote>

      <FilterBar
        options={options}
        value={category}
        onChange={setCategory}
        search={query}
        onSearch={setQuery}
        searchPlaceholder={t('Search a scheme', 'योजना खोजें')}
        label={t('Category', 'श्रेणी')}
      />

      {loading ? (
        <LoadingState label={t('Loading schemes', 'योजनाएँ लोड हो रही हैं')} rows={3} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load schemes", 'योजनाएँ लोड नहीं हुईं')}
          body={
            error.message ||
            t(
              'Rather than show amounts that might be wrong, this page shows nothing until it can reach the source.',
              'गलत राशि दिखाने के बजाय, स्रोत मिलने तक यह पन्ना खाली रहता है।',
            )
          }
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            all.length === 0
              ? t('No schemes are on record', 'कोई योजना दर्ज नहीं है')
              : t('No scheme matches that', 'कोई योजना नहीं मिली')
          }
          body={
            all.length === 0
              ? t(
                  'The scheme list came back empty. Do not describe a scheme from memory — check with your block office.',
                  'योजनाओं की सूची खाली आई। याद के भरोसे किसी योजना के बारे में न बताएँ — अपने ब्लॉक कार्यालय से पूछें।',
                )
              : t(
                  'Try another category, or clear the search.',
                  'दूसरी श्रेणी आज़माएँ, या खोज हटाएँ।',
                )
          }
          action={
            query ? (
              <Btn variant="outline" onClick={() => setQuery('')}>
                {t('Clear search', 'खोज हटाएँ')}
              </Btn>
            ) : (
              <Btn variant="outline" onClick={reload}>
                {t('Check again', 'फिर देखें')}
              </Btn>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((s) => (
            <SchemeCard key={s.id ?? s.name} scheme={s} hi={hi} />
          ))}
        </div>
      )}
    </AshaShell>
  );
}

function SchemeCard({ scheme: s, hi }) {
  const t = (en, dev) => (hi ? dev : en);
  const [open, setOpen] = useState(false);

  // `verified_at` is the date the curated entry was last checked
  // against the published source. Without it there is nothing to
  // vouch for, so the stamp does not claim there is.
  const verified = Boolean(s.verified_at);
  const name = hi && s.name_hi ? s.name_hi : s.name;
  const summary = hi && s.summary_hi ? s.summary_hi : s.summary;

  const benefits = Array.isArray(s.key_benefits) ? s.key_benefits : [];
  const criteria = Array.isArray(s.eligibility_criteria) ? s.eligibility_criteria : [];
  const documents = Array.isArray(s.documents_required) ? s.documents_required : [];
  const steps = Array.isArray(s.application_process?.steps) ? s.application_process.steps : [];
  const hasDetail = documents.length || steps.length || criteria.length;

  return (
    <Card tone={verified ? 'seal' : 'amber'} className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {s.category ? <Eyebrow>{s.category}</Eyebrow> : null}
          <h3 className="mt-2 text-xl font-semibold leading-snug text-ink">{name}</h3>
          {hi && s.name_hi ? <p className="mt-1 text-[0.85rem] text-ink-faint">{s.name}</p> : null}
          {summary ? (
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">{summary}</p>
          ) : null}
        </div>
        <Stamp
          kind={verified ? 'verified' : 'inferred'}
          label={verified ? t('Checked', 'जाँची गई') : t('Unconfirmed', 'पुष्ट नहीं')}
          source={s.source_name || undefined}
        />
      </div>

      {/* Printed as published, word for word. Nothing is recalculated
          and no part of the sentence is dropped. */}
      {s.coverage_amount ? (
        <div className="mt-5 border-l-2 border-seal pl-4">
          <Eyebrow>{t('What it covers', 'क्या मिलता है')}</Eyebrow>
          <p className="display-md mt-1.5 text-2xl text-ink">{s.coverage_amount}</p>
          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-faint">
            {t(
              'Quoted exactly as the ministry publishes it. Read the whole line out, including the period it covers.',
              'जैसा मंत्रालय प्रकाशित करता है, ठीक वैसा ही। पूरी पंक्ति पढ़कर बताएँ, अवधि सहित।',
            )}
          </p>
        </div>
      ) : null}

      {benefits.length ? (
        <div className="mt-5">
          <Eyebrow>{t('What the family gets', 'परिवार को क्या मिलता है')}</Eyebrow>
          <ul className="mt-3 space-y-2">
            {benefits.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
                <Check size={15} className="mt-0.5 shrink-0 text-seal" aria-hidden="true" />
                <span className="min-w-0">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasDetail ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-6 flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-sm border border-rule bg-paper-2 px-4 text-left text-sm font-semibold text-ink transition hover:bg-paper-3"
          >
            {open
              ? t('Hide documents and how to apply', 'दस्तावेज़ और प्रक्रिया छिपाएँ')
              : t('Documents and how to apply', 'दस्तावेज़ और आवेदन कैसे करें')}
            <ChevronDown
              size={17}
              className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {open ? (
            <div className="mt-5 space-y-6">
              {documents.length ? (
                <div>
                  <Eyebrow>{t('Documents to carry', 'साथ ले जाने के दस्तावेज़')}</Eyebrow>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {documents.map((d, i) => (
                      <Pill key={i} tone="neutral">
                        <FileText size={12} aria-hidden="true" />
                        {d}
                      </Pill>
                    ))}
                  </div>
                </div>
              ) : null}

              {steps.length ? (
                <div>
                  <Eyebrow>{t('How to apply', 'आवेदन कैसे करें')}</Eyebrow>
                  <ol className="mt-3 space-y-2.5">
                    {steps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-[0.9rem] leading-relaxed text-ink-soft">
                        <span className="mt-0.5 shrink-0 font-mono text-[0.7rem] tracking-[0.08em] text-ink-faint">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {criteria.length ? (
                <div>
                  <Eyebrow>{t('Who it is for', 'किसके लिए')}</Eyebrow>
                  <ul className="mt-3 space-y-2">
                    {criteria.map((c, i) => (
                      <li
                        key={i}
                        className="flex gap-2.5 text-[0.9rem] leading-relaxed text-ink-soft"
                      >
                        <ListOrdered
                          size={15}
                          className="mt-0.5 shrink-0 text-ink-faint"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">{c}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
                    {t(
                      'These are the published criteria, not a decision. The department checks them.',
                      'ये प्रकाशित शर्तें हैं, निर्णय नहीं। जाँच विभाग करता है।',
                    )}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {s.source_name || s.verified_at ? (
        <p className="mt-6 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {s.source_name ? `${t('Source: ', 'स्रोत: ')}${s.source_name}` : null}
          {s.source_name && s.verified_at ? ' · ' : null}
          {s.verified_at ? `${t('Checked ', 'जाँचा गया ')}${formatDate(s.verified_at, hi)}` : null}
        </p>
      ) : null}

      {s.official_portal ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-5">
          <Btn
            as="a"
            href={s.official_portal}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            <ExternalLink size={15} aria-hidden="true" />
            {t('Official page', 'सरकारी पन्ना')}
          </Btn>
        </div>
      ) : null}
    </Card>
  );
}
