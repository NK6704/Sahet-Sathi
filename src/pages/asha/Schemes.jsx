import React, { useMemo, useState } from 'react';
import { ExternalLink, Phone, FileText, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { listSchemes } from '@/services/asha';
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
import { FilterBar } from '@/components/asha/parts';

/* =============================================================
   /asha/schemes — what a worker can actually tell a family.

   Two rules from the brief govern this whole page:

     1. Never present eligibility as guaranteed. The phrasing is
        always "may be eligible based on the available information".
     2. Amounts and helplines are quoted from a source, and the
        source is printed next to them. A stale number here means a
        family travels for money that isn't coming.
   ============================================================= */

const CATEGORIES = [
  { value: 'all', label: 'All', label_hi: 'सभी' },
  { value: 'insurance', label: 'Insurance', label_hi: 'बीमा' },
  { value: 'maternal', label: 'Maternal', label_hi: 'मातृत्व' },
  { value: 'child', label: 'Child', label_hi: 'बाल' },
  { value: 'nutrition', label: 'Nutrition', label_hi: 'पोषण' },
  { value: 'identity', label: 'Health ID', label_hi: 'हेल्थ आईडी' },
];

/** Both backends feed this page. Flatten them to one shape here. */
function normalise(s) {
  const docs = s.documents || s.documents_required || s.required_documents || [];
  return {
    id: s.id || s.code || s.name,
    code: s.code || null,
    name: s.name || 'Scheme',
    name_hi: s.name_hi || null,
    short_desc: s.short_desc || s.description || s.summary || null,
    category: s.category || null,
    ministry: s.ministry || null,
    benefit_summary: s.benefit_summary || s.benefits || null,
    benefit_amount: typeof s.benefit_amount === 'number' ? s.benefit_amount : null,
    eligibility: s.eligibility_rules || s.eligibility || null,
    documents: Array.isArray(docs) ? docs : [],
    how_to_apply:
      s.how_to_apply ||
      (Array.isArray(s.application_process?.steps) ? s.application_process.steps.join(' → ') : null),
    official_url: s.official_url || s.official_portal || s.source_url || null,
    helpline: s.helpline || null,
    verification: s.verification || 'unverified',
    source: s.source || null,
  };
}

const rupees = (n) =>
  n == null ? null : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function AshaSchemes() {
  const { profile } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const { data, error, loading, reload } = useAsync(() => listSchemes({}), []);
  const all = useMemo(() => (data ?? []).map(normalise), [data]);

  const rows = useMemo(() => {
    let out = all;
    if (category !== 'all') out = out.filter((s) => s.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((s) =>
        [s.name, s.name_hi, s.short_desc, s.benefit_summary, s.ministry]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [all, category, query]);

  return (
    <AshaShell
      eyebrow={t('Register 005 · Schemes', 'रजिस्टर 005 · योजनाएँ')}
      title={t('What families can claim', 'परिवार क्या पा सकते हैं')}
      sub={t(
        'Benefit amounts, documents and helplines as published by the ministry. Read them out — do not promise them.',
        'मंत्रालय द्वारा प्रकाशित राशि, दस्तावेज़ और हेल्पलाइन। पढ़कर बताएँ — वादा न करें।',
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
        options={CATEGORIES.map((c) => ({
          value: c.value,
          label: hi ? c.label_hi : c.label,
          count: c.value === 'all' ? all.length : all.filter((s) => s.category === c.value).length,
        }))}
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
          body={t(
            'Rather than show amounts that might be wrong, this page shows nothing until it can reach the source.',
            'गलत राशि दिखाने के बजाय, स्रोत मिलने तक यह पन्ना खाली रहता है।',
          )}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('No schemes match that', 'कोई योजना नहीं मिली')}
          body={t(
            'Try another category, or clear the search.',
            'दूसरी श्रेणी आज़माएँ, या खोज हटाएँ।',
          )}
          action={
            query ? (
              <Btn variant="outline" onClick={() => setQuery('')}>
                {t('Clear search', 'खोज हटाएँ')}
              </Btn>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((s) => (
            <SchemeCard key={s.id} scheme={s} hi={hi} />
          ))}
        </div>
      )}
    </AshaShell>
  );
}

function SchemeCard({ scheme: s, hi }) {
  const t = (en, dev) => (hi ? dev : en);
  const [open, setOpen] = useState(false);
  const verified = s.verification === 'verified';

  return (
    <Card tone={verified ? 'seal' : 'amber'} className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {s.ministry ? <Eyebrow>{s.ministry}</Eyebrow> : null}
          <h3 className="mt-2 text-xl font-semibold leading-snug text-ink">
            {hi && s.name_hi ? s.name_hi : s.name}
          </h3>
          {hi && s.name_hi ? (
            <p className="mt-1 text-[0.85rem] text-ink-faint">{s.name}</p>
          ) : null}
          {s.short_desc ? (
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
              {s.short_desc}
            </p>
          ) : null}
        </div>
        <Stamp
          kind={verified ? 'verified' : 'inferred'}
          label={verified ? t('Verified', 'पुष्ट') : t('Unconfirmed', 'पुष्ट नहीं')}
        />
      </div>

      {s.benefit_summary || s.benefit_amount != null ? (
        <div className="mt-5 border-l-2 border-seal pl-4">
          <Eyebrow>{t('Benefit', 'लाभ')}</Eyebrow>
          {s.benefit_amount != null ? (
            <p className="display-md mt-1.5 text-2xl text-ink">{rupees(s.benefit_amount)}</p>
          ) : null}
          {s.benefit_summary ? (
            <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">
              {s.benefit_summary}
            </p>
          ) : null}
        </div>
      ) : null}

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
          {s.documents.length ? (
            <div>
              <Eyebrow>{t('Documents to carry', 'साथ ले जाने के दस्तावेज़')}</Eyebrow>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.documents.map((d) => (
                  <Pill key={d} tone="neutral">
                    <FileText size={12} aria-hidden="true" />
                    {d}
                  </Pill>
                ))}
              </div>
            </div>
          ) : null}

          {s.how_to_apply ? (
            <div>
              <Eyebrow>{t('How to apply', 'आवेदन कैसे करें')}</Eyebrow>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{s.how_to_apply}</p>
            </div>
          ) : null}

          {s.eligibility && typeof s.eligibility === 'object' && !Array.isArray(s.eligibility) ? (
            <div>
              <Eyebrow>{t('Who it is for', 'किसके लिए')}</Eyebrow>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(s.eligibility).map(([k, v]) => (
                  <div key={k} className="rounded-sm bg-paper-2 px-3 py-2">
                    <dt className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-ink-faint">
                      {k.replace(/_/g, ' ')}
                    </dt>
                    <dd className="mt-0.5 text-[0.9rem] text-ink">
                      {typeof v === 'boolean'
                        ? v
                          ? t('Yes', 'हाँ')
                          : t('No', 'नहीं')
                        : Array.isArray(v)
                        ? v.join(', ')
                        : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
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

      {s.source ? (
        <p className="mt-6 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {t('Source: ', 'स्रोत: ')}
          {s.source}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-5">
        {s.helpline ? (
          <Btn as="a" href={`tel:${String(s.helpline).replace(/[^\d+]/g, '')}`} variant="primary">
            <Phone size={16} aria-hidden="true" />
            {s.helpline}
          </Btn>
        ) : null}
        {s.official_url ? (
          <Btn
            as="a"
            href={s.official_url}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            <ExternalLink size={15} aria-hidden="true" />
            {t('Official page', 'सरकारी पन्ना')}
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}
