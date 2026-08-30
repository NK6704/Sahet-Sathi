import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check, AlertTriangle, CircleDashed, MinusCircle, FileText, ExternalLink } from 'lucide-react';
import { checkSchemeEligibility } from '@/services/api';
import { Btn, Card, Eyebrow, InferenceNote, Stamp } from '@/components/ds';

/* =============================================================
   The eligibility check.

   This app does not decide eligibility, and this component is where
   that either holds or fails. The server no longer returns a
   verdict: it returns `decision: "not_assessed"` and a checklist of
   { title, state: 'met' | 'not_met' | 'unknown', note }.

   Three rules govern the rendering:

     1. UNKNOWN IS NOT A FAILURE. Most items come back unknown,
        because this app has not seen anybody's Aadhaar or bank
        account and has not asked. An unknown row is rendered quietly
        and neutrally — never in the colour of a refusal — and the
        count of unknowns is stated outright, because that count is
        the honest summary of how much is actually settled.
     2. NO SCORE, NO VERDICT. There is no `match_score` and no
        `is_eligible` in the response any more; both were invented
        server-side (94%, and a default of true). A percentage reads
        as a probability of getting the money, which is not what it
        ever measured.
     3. WHO DECIDES IS NAMED. The department's own verification
        process decides, and the source it publishes is printed. A
        person who reads this should know exactly who to go to and
        what to read for themselves.
   ============================================================= */

const STATES = {
  met: {
    icon: Check,
    tone: 'text-seal',
    box: 'border-seal/30 bg-seal-soft',
    en: 'Matches',
    hi: 'मिलता है',
  },
  not_met: {
    icon: MinusCircle,
    tone: 'text-amber',
    box: 'border-amber/30 bg-amber-soft',
    en: 'Does not match',
    hi: 'नहीं मिलता',
  },
  unknown: {
    // Deliberately the quietest of the three. Not knowing something
    // is not a rejection, and it must not be coloured like one.
    icon: CircleDashed,
    tone: 'text-ink-faint',
    box: 'border-rule-soft bg-paper-3',
    en: "We don't know",
    hi: 'हमें नहीं पता',
  },
};

function stateOf(item) {
  const key = String(item?.state ?? 'unknown');
  return STATES[key] ? key : 'unknown';
}

export function EligibilityModal({ scheme, open, onClose, userProfile, language = 'English' }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const panelRef = useRef(null);

  const hi = language === 'हिन्दी' || language === 'Hindi';
  const t = (en, dev) => (hi ? dev : en);

  // Reset between schemes, so one scheme's answer can never be read
  // as another's.
  useEffect(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, [scheme?.id, open]);

  const handleKey = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, handleKey]);

  if (!open || !scheme) return null;

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const data = await checkSchemeEligibility(scheme.id, userProfile);
      setResult(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const checklist = Array.isArray(result?.checklist) ? result.checklist : [];
  const counts = checklist.reduce(
    (acc, item) => {
      acc[stateOf(item)] += 1;
      return acc;
    },
    { met: 0, not_met: 0, unknown: 0 },
  );
  // The server sends its own count. Trust it, and fall back to what
  // is on screen rather than to zero.
  const unknownCount = Number.isFinite(result?.unknownCount)
    ? result.unknownCount
    : counts.unknown;

  const documents = Array.isArray(result?.documents) ? result.documents : [];
  const criteria = Array.isArray(result?.criteria) ? result.criteria : [];
  const notes = Array.isArray(result?.notes) ? result.notes : [];
  const nextSteps = Array.isArray(result?.next_steps) ? result.next_steps : [];

  // Only what the profile actually holds. An empty profile prints
  // one plain sentence instead of a name-shaped blank and a stray
  // comma, which is what the previous version did.
  const knownDetails = [
    userProfile?.name || userProfile?.full_name,
    userProfile?.age ? `${userProfile.age}${t(' years', ' वर्ष')}` : null,
    userProfile?.gender,
    userProfile?.village,
    userProfile?.district,
    userProfile?.state,
    userProfile?.ration_card_type,
  ].filter(Boolean);

  const schemeName = result?.scheme_name || (hi && scheme.name_hi ? scheme.name_hi : scheme.name);
  const sourceName = result?.source_name || scheme.source_name || null;
  const sourceUrl = result?.source_url || scheme.source_url || scheme.official_portal || null;

  return (
    <div
      id="modal-scheme-eligibility"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eligibility-title"
        className={`card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-b-none p-6 sm:rounded-b-card sm:p-7 appear ${
          hi ? 'is-deva' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        data-testid="panel-eligibility"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{t('Eligibility check', 'पात्रता जाँच')}</Eyebrow>
            <h2 id="eligibility-title" className="display-md mt-2 text-2xl">
              {schemeName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'बंद करें')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-rule text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {/* What the check has to work with. Shown so an answer can be
            traced to thin details rather than seeming arbitrary. */}
        <Card className="mt-5 bg-paper-3 p-4">
          <Eyebrow>{t('Checked against', 'इनके आधार पर')}</Eyebrow>
          {knownDetails.length ? (
            <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-soft">
              {knownDetails.join(' · ')}
            </p>
          ) : (
            <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-soft">
              {t(
                'Your profile is empty, so there is nothing to check against yet. Fill in your details and most of the list below can be answered.',
                'आपकी प्रोफ़ाइल खाली है, इसलिए अभी मिलाने के लिए कुछ नहीं है। विवरण भरें तो नीचे की सूची में से ज़्यादातर का जवाब मिल सकेगा।',
              )}
            </p>
          )}
        </Card>

        {!result && !error ? (
          <div className="mt-6">
            <p className="text-[0.92rem] leading-relaxed text-ink-soft">
              {t(
                'We will list this scheme’s published rules next to what we actually know about you, and name the papers you would need. It is a list, not a decision.',
                'हम इस योजना के प्रकाशित नियमों को आपकी उपलब्ध जानकारी के साथ रखेंगे, और ज़रूरी कागज़ बताएँगे। यह एक सूची है, निर्णय नहीं।',
              )}
            </p>
            <Btn
              variant="primary"
              size="lg"
              onClick={runCheck}
              disabled={loading}
              className="mt-5 w-full sm:w-auto"
              data-testid="btn-evaluate-eligibility"
            >
              <FileText size={17} aria-hidden="true" />
              {loading ? t('Checking…', 'जाँच रहे हैं…') : t('Run the check', 'जाँच शुरू करें')}
            </Btn>
          </div>
        ) : null}

        {/* No invented verdict. If the check did not run, say so. */}
        {error ? (
          <Card tone="siren" className="mt-6 p-5" role="alert">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-siren" aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-[1rem] font-semibold text-ink">
                  {t('The check could not be run', 'जाँच नहीं हो सकी')}
                </h3>
                <p className="mt-2 text-[0.87rem] leading-relaxed text-ink-soft">
                  {t(
                    'We will not guess at an answer about your entitlements. Try again, or ask your ASHA worker — she can check this with the block office.',
                    'आपके अधिकारों के बारे में हम अनुमान नहीं लगाएँगे। फिर कोशिश करें, या अपनी आशा कार्यकर्ता से पूछें — वे ब्लॉक कार्यालय से पता कर सकती हैं।',
                  )}
                </p>
                <Btn variant="outline" onClick={runCheck} className="mt-4">
                  {t('Try again', 'फिर कोशिश करें')}
                </Btn>
              </div>
            </div>
          </Card>
        ) : null}

        {result ? (
          <div className="mt-6 space-y-5 appear">
            {/* ---- The framing. Never a verdict. ---- */}
            <Card tone="amber" className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="display-md max-w-sm text-xl">
                  {t(
                    'You may be eligible based on the information available. This is not a decision.',
                    'उपलब्ध जानकारी के आधार पर आप पात्र हो सकती हैं। यह निर्णय नहीं है।',
                  )}
                </h3>
                <Stamp kind="inferred" label={t('Not assessed', 'जाँच नहीं हुई')} />
              </div>

              {result.decisionNote ? (
                <p className="mt-4 border-t border-rule pt-4 text-[0.87rem] leading-relaxed text-ink-soft">
                  {result.decisionNote}
                </p>
              ) : null}

              {/* Who actually decides. Named, not implied. */}
              <p className="mt-4 text-[0.87rem] leading-relaxed text-ink">
                <span className="font-semibold">{t('Who decides: ', 'निर्णय कौन करता है: ')}</span>
                {t(
                  'the scheme’s own verification process — an Ayushman Mitra at an empanelled hospital, a CSC, or the scheme office, against the SECC and state records. Sehat Sathi has no part in it.',
                  'योजना की अपनी सत्यापन प्रक्रिया — सूचीबद्ध अस्पताल का आयुष्मान मित्र, CSC, या योजना कार्यालय, SECC और राज्य रिकॉर्ड के आधार पर। सेहत साथी की इसमें कोई भूमिका नहीं है।',
                )}
              </p>
            </Card>

            {/* ---- The count of unknowns: the honest summary ---- */}
            <Card className="p-5">
              <Eyebrow>{t('How much is settled', 'कितना तय है')}</Eyebrow>
              <p className="mt-2.5 text-[0.92rem] leading-relaxed text-ink-soft">
                {unknownCount > 0
                  ? t(
                      `${unknownCount} of ${checklist.length} things on this list are not known to us. Nothing has been ruled out and nothing has been confirmed.`,
                      `इस सूची की ${checklist.length} बातों में से ${unknownCount} हमें नहीं पता। कुछ भी खारिज नहीं हुआ और कुछ भी पक्का नहीं हुआ।`,
                    )
                  : t(
                      'Every item on this list has an answer from your details. The counter still verifies each one against its own records.',
                      'इस सूची की हर बात का जवाब आपके विवरण से मिल गया। काउंटर फिर भी हर बात को अपने रिकॉर्ड से मिलाएगा।',
                    )}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-rule pt-4">
                {[
                  { key: 'unknown', value: counts.unknown },
                  { key: 'met', value: counts.met },
                  { key: 'not_met', value: counts.not_met },
                ].map(({ key, value }) => (
                  <div key={key} className={`rounded-sm border p-3 ${STATES[key].box}`}>
                    <dt className="font-mono text-[0.66rem] uppercase leading-tight tracking-[0.08em] text-ink-faint">
                      {hi ? STATES[key].hi : STATES[key].en}
                    </dt>
                    <dd className={`figure mt-1.5 text-2xl ${STATES[key].tone}`}>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            {/* ---- The checklist ---- */}
            {checklist.length ? (
              <div>
                <Eyebrow>{t('What the scheme asks for', 'योजना क्या माँगती है')}</Eyebrow>
                <ul className="mt-3 space-y-2">
                  {checklist.map((item, i) => {
                    const key = stateOf(item);
                    const meta = STATES[key];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={`${item.title ?? 'item'}-${i}`}
                        className={`rounded-sm border px-3.5 py-3 ${meta.box}`}
                        data-testid={`eligibility-item-${key}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 text-[0.88rem] font-medium leading-snug text-ink">
                            {item.title}
                          </span>
                          <span
                            className={`flex shrink-0 items-center gap-1.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.08em] ${meta.tone}`}
                          >
                            <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
                            {hi ? meta.hi : meta.en}
                          </span>
                        </div>
                        {item.note ? (
                          <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-soft">
                            {item.note}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {/* ---- Documents to carry ---- */}
            {documents.length ? (
              <div>
                <Eyebrow>{t('Documents to carry', 'साथ ले जाने के कागज़')}</Eyebrow>
                <ul className="mt-3 space-y-2">
                  {documents.map((doc, i) => (
                    <li
                      key={`${doc}-${i}`}
                      className="flex items-start gap-2.5 rounded-sm border border-rule-soft bg-paper-3 px-3.5 py-3 text-[0.88rem] leading-relaxed text-ink-soft"
                    >
                      <span className="reg-index mt-0.5 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
                  {t(
                    'Take the originals as well as photocopies, and expect the office to ask for something not on this list.',
                    'मूल कागज़ और फ़ोटोकॉपी दोनों ले जाएँ, और यह मानकर चलें कि कार्यालय इस सूची से बाहर का कुछ और भी माँग सकता है।',
                  )}
                </p>
              </div>
            ) : null}

            {/* ---- The scheme's published criteria, as criteria ---- */}
            {criteria.length ? (
              <Card className="p-5">
                <Eyebrow>{t('Published criteria', 'प्रकाशित मानदंड')}</Eyebrow>
                <ul className="mt-3 space-y-2 text-[0.87rem] leading-relaxed text-ink-soft">
                  {criteria.map((c, i) => (
                    <li key={`${c}-${i}`} className="flex items-start gap-2">
                      <span
                        className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint"
                        aria-hidden="true"
                      />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {notes.length ? (
              <Card tone="amber" className="p-5">
                <Eyebrow>{t('Worth knowing', 'जानने योग्य')}</Eyebrow>
                <ul className="mt-3 space-y-2 text-[0.87rem] leading-relaxed text-ink-soft">
                  {notes.map((n, i) => (
                    <li key={`${n}-${i}`}>{n}</li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {nextSteps.length ? (
              <Card className="p-5">
                <Eyebrow>{t('Next steps', 'अगले कदम')}</Eyebrow>
                <ol className="mt-3 space-y-3">
                  {nextSteps.map((step, i) => (
                    <li key={`${step}-${i}`} className="flex items-start gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-seal font-mono text-[0.66rem] font-medium text-white">
                        {i + 1}
                      </span>
                      <span className="pt-0.5 text-[0.88rem] leading-relaxed text-ink-soft">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            ) : null}

            {/* The one line that must never be softened. */}
            <InferenceNote>
              {t(
                'This is not an approval. The department decides, and it may ask for more than what is listed here.',
                'यह स्वीकृति नहीं है। निर्णय विभाग करता है, और वह यहाँ दी सूची से अधिक कागज़ माँग सकता है।',
              )}
            </InferenceNote>

            {/* ---- Provenance. The reason to trust, or sensibly
                    distrust, everything above. ---- */}
            <div className="border-t border-rule pt-4">
              <p className="font-mono text-[0.66rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
                {sourceName ? (
                  <>
                    {t('Source: ', 'स्रोत: ')}
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-baseline gap-1 underline decoration-rule underline-offset-2 hover:text-ink"
                      >
                        {sourceName}
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    ) : (
                      sourceName
                    )}
                  </>
                ) : (
                  t(
                    'No published source is recorded for this scheme’s rules.',
                    'इस योजना के नियमों का कोई प्रकाशित स्रोत दर्ज नहीं है।',
                  )
                )}
                {sourceUrl && !sourceName ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-1 underline decoration-rule underline-offset-2 hover:text-ink"
                  >
                    {sourceUrl}
                  </a>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
