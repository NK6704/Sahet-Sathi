import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { useAppState } from '@/state/store';
import { getCuratedSchemes, searchLiveSchemes } from '@/services/api';
import { SchemeCard } from '@/components/schemes/SchemeCard';
import { EligibilityModal } from '@/components/schemes/EligibilityModal';
import {
  Btn,
  Eyebrow,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /schemes — the benefits directory.

   The note above the list is the most important sentence on the
   page and it is placed there deliberately, not in a footer.
   Nothing in this directory is an approval; the department decides.
   Every family that walks into an office believing this app
   promised them money and is turned away is a family that stops
   trusting the health system, not just the app.
   ============================================================= */

export function Schemes() {
  const { language, savedSchemeIds, toggleSaveScheme, userProfile } = useAppState();
  const hi = language === 'हिन्दी' || language === 'Hindi';
  const t = (en, dev) => (hi ? dev : en);

  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [liveSearching, setLiveSearching] = useState(false);
  const [liveNote, setLiveNote] = useState(null);
  const [eligibilityFor, setEligibilityFor] = useState(null);

  const categories = [
    { id: 'All', label: t('All schemes', 'सभी योजनाएँ') },
    { id: 'General', label: t('General care', 'सामान्य इलाज') },
    { id: 'Maternal & Child', label: t('Mother & child', 'मातृत्व व शिशु') },
    { id: 'Medicines', label: t('Medicines', 'दवाइयाँ') },
    { id: 'Elderly & Chronic', label: t('Elderly & long-term', 'वृद्धजन व दीर्घकालिक') },
  ];

  const fetchSchemes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCuratedSchemes({
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        search: submitted,
      });
      setSchemes(data?.schemes ?? []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, submitted]);

  useEffect(() => {
    fetchSchemes();
  }, [fetchSchemes]);

  async function handleLiveGovSearch() {
    if (!searchQuery.trim()) return;
    setLiveSearching(true);
    setLiveNote(null);
    try {
      const res = await searchLiveSchemes(searchQuery, language);
      const results = res?.results ?? [];
      if (results.length) {
        setSchemes((prev) => [...results, ...prev]);
      } else {
        // Saying "nothing found on the portals" is a real answer.
        // Silently leaving the old list up would imply otherwise.
        setLiveNote(
          t(
            'Nothing new found on the government portals for that.',
            'सरकारी पोर्टल पर इसके लिए कुछ नया नहीं मिला।',
          ),
        );
      }
    } catch {
      setLiveNote(
        t(
          'The live portal search could not be reached. The list below is the saved official data.',
          'लाइव पोर्टल खोज नहीं हो सकी। नीचे की सूची सहेजी हुई सरकारी जानकारी है।',
        ),
      );
    } finally {
      setLiveSearching(false);
    }
  }

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-6 sm:pt-8 ${hi ? 'is-deva' : ''}`}>
      {/* ---------- Head ---------- */}
      <header className="border-b border-rule pb-7">
        <Eyebrow>{t('Register · Schemes', 'रजिस्टर · योजनाएँ')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-2xl">
          {t('Government health schemes', 'सरकारी स्वास्थ्य योजनाएँ')}
        </h1>
        <p className="lede mt-4">
          {t(
            'What each scheme covers, who it is for, and the papers you need. Central and state programmes.',
            'हर योजना में क्या मिलता है, किसे मिलता है, और कौन से कागज़ लगते हैं। केंद्र और राज्य की योजनाएँ।',
          )}
        </p>
      </header>

      {/* ---------- Search ---------- */}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(searchQuery.trim());
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
          role="search"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('Search schemes', 'योजनाएँ खोजें')}</span>
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(
                'Scheme name or condition — Ayushman, delivery, TB',
                'योजना का नाम या बीमारी — आयुष्मान, प्रसव, टीबी',
              )}
              className="field w-full pl-11"
            />
          </label>
          <Btn type="submit" variant="primary">
            {t('Search', 'खोजें')}
          </Btn>
        </form>

        <Btn
          type="button"
          variant="outline"
          onClick={handleLiveGovSearch}
          disabled={liveSearching || !searchQuery.trim()}
          className="shrink-0"
          title={t('Search live government portals', 'लाइव सरकारी पोर्टल खोजें')}
        >
          <Globe size={16} className={liveSearching ? 'animate-spin' : ''} aria-hidden="true" />
          {liveSearching ? t('Searching…', 'खोज रहे हैं…') : t('Search gov portals', 'सरकारी पोर्टल खोजें')}
        </Btn>
      </div>

      {liveNote ? (
        <p className="mt-3 text-[0.85rem] leading-relaxed text-amber" role="status">
          {liveNote}
        </p>
      ) : null}

      {/* ---------- Category ---------- */}
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={t('Category', 'श्रेणी')}>
        {categories.map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              aria-pressed={active}
              className={`inline-flex min-h-10 items-center rounded-full border-[1.5px] px-4 text-[0.85rem] font-semibold transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ---------- The sentence that matters most ----------
          Above the list, on purpose. */}
      <InferenceNote className="mt-6 max-w-3xl">
        {t(
          'Nothing here is an approval. These are the published rules — the final decision on your application rests with the department.',
          'यहाँ कुछ भी स्वीकृति नहीं है। ये प्रकाशित नियम हैं — आपके आवेदन पर अंतिम निर्णय विभाग करता है।',
        )}
      </InferenceNote>

      {/* ---------- Results ---------- */}
      <div className="mt-6 pb-4">
        {loading ? (
          <LoadingState label={t('Loading schemes', 'योजनाएँ लोड हो रही हैं')} rows={3} />
        ) : error ? (
          <ErrorState
            title={t("Couldn't load schemes", 'योजनाएँ लोड नहीं हुईं')}
            onRetry={fetchSchemes}
            retryLabel={t('Try again', 'फिर कोशिश करें')}
          />
        ) : schemes.length === 0 ? (
          <EmptyState
            title={t('No schemes matched', 'कोई योजना नहीं मिली')}
            body={t(
              'Try a shorter word, pick another category, or search the government portals for something newer.',
              'छोटा शब्द आज़माएँ, दूसरी श्रेणी चुनें, या सरकारी पोर्टल पर नया खोजें।',
            )}
            action={
              <Btn
                variant="outline"
                onClick={() => {
                  setSelectedCategory('All');
                  setSearchQuery('');
                  setSubmitted('');
                }}
              >
                {t('Show all schemes', 'सभी योजनाएँ दिखाएँ')}
              </Btn>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {schemes.map((scheme) => (
              <SchemeCard
                key={scheme.id}
                scheme={scheme}
                isSaved={savedSchemeIds.includes(scheme.id)}
                onToggleSave={toggleSaveScheme}
                onCheckEligibility={setEligibilityFor}
                language={language}
              />
            ))}
          </div>
        )}
      </div>

      <EligibilityModal
        scheme={eligibilityFor}
        open={Boolean(eligibilityFor)}
        onClose={() => setEligibilityFor(null)}
        userProfile={userProfile}
        language={language}
      />
    </main>
  );
}
