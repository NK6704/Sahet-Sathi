import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ShieldCheck,
  ArrowRight,
  Loader2,
  AlertTriangle,
  SkipForward,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { useAuth } from '@/lib/auth';
import { getT, isHindiLang } from '@/services/i18n';
import { Btn, Card, Eyebrow } from '@/components/ds';

/* =============================================================
   /onboarding — the first four questions.

   THIS FORM USED TO ARRIVE PRE-FILLED WITH SOMEBODY ELSE. Name
   "Meera Sharma", phone 98261-55443, age 32, Female, Sehore,
   Mandi, "BPL (Priority Household)", and all four consents
   already ticked. Its Save button wrote every one of those values
   to the account of whoever was actually holding the phone. A
   person who tapped straight through — which is what a person in
   a hurry does — ended up with a stranger's ration-card class on
   their record, and the scheme suggestions that follow read that
   field. Nothing is pre-filled now except what the account
   already holds.

   Three further rules this screen keeps:

     · Consent is never pre-ticked. A checkbox somebody did not
       tick is not consent, and location and voice are exactly the
       two permissions where that matters.
     · Only fields the person actually filled are sent. An empty
       age is left absent rather than written as 0, because 0 is a
       real age to the scheme rules and "unknown" is not.
     · A failed save does not navigate. The old code fired
       updateProfile() without waiting and pushed to /app on the
       next line, so a save that failed looked exactly like one
       that worked.

   The form is also skippable. Somebody who opened this app
   because a child has a fever should be able to reach the
   microphone without filling anything in.
   ============================================================= */

const GENDERS = [
  { value: 'Female', en: 'Female', hi: 'महिला' },
  { value: 'Male', en: 'Male', hi: 'पुरुष' },
  { value: 'Other', en: 'Other', hi: 'अन्य' },
];

const RATION_CARDS = [
  { value: 'BPL (Priority Household)', en: 'BPL / Priority household', hi: 'BPL / पात्र गृहस्थी' },
  { value: 'Antyodaya (AAY)', en: 'Antyodaya (AAY)', hi: 'अंत्योदय (AAY)' },
  { value: 'APL / None', en: 'APL / none', hi: 'APL / कोई नहीं' },
];

const CONSENT_KEYS = [
  'voice_processing',
  'location_access',
  'health_guidance_disclaimer',
  'asha_referral_consent',
];

/** A labelled field. `.field` carries the 3.25rem tap height. */
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[0.8rem] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/** Consent row. Unticked until the person ticks it. */
function Consent({ checked, onChange, title, body }) {
  return (
    <label className="flex cursor-pointer gap-3 border-t border-rule pt-3.5 first:border-0 first:pt-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-[1.15rem] w-[1.15rem] shrink-0 accent-seal"
      />
      <span className="min-w-0">
        <span className="block text-[0.88rem] font-semibold leading-snug text-ink">{title}</span>
        <span className="mt-1 block text-[0.8rem] leading-relaxed text-ink-faint">{body}</span>
      </span>
    </label>
  );
}

export function Onboarding() {
  const { language, userProfile, updateProfile } = useAppState();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const t = getT(language);
  const hi = isHindiLang(language);

  const text = (value) => (value === null || value === undefined ? '' : String(value));

  /* Seeded from the account, never from an invented person. On a
     fresh account every one of these is ''. */
  const [form, setForm] = useState(() => ({
    name: text(userProfile?.name),
    phone: text(userProfile?.phone),
    age: text(userProfile?.age),
    gender: text(userProfile?.gender),
    district: text(userProfile?.district),
    village: text(userProfile?.village),
    block: text(userProfile?.block),
    ration_card_type: text(userProfile?.ration_card_type),
    is_pregnant_or_lactating: userProfile?.is_pregnant_or_lactating === true,
  }));

  const [consents, setConsents] = useState(() =>
    CONSENT_KEYS.reduce((acc, key) => ({ ...acc, [key]: false }), {}),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setConsent = (key) => (value) => setConsents((prev) => ({ ...prev, [key]: value }));

  /* Voice and location are the two permissions this app cannot
     honestly proceed on without being asked. The rest of the form
     is optional. */
  const canSubmit =
    form.name.trim().length > 0 &&
    consents.health_guidance_disclaimer === true &&
    !saving;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    /* Only what was filled in. An untouched field is left out of
       the payload entirely rather than written as '' or 0.

       `language` is the exception and is always sent: it is not a claim
       the person has to make, it is the choice already made on the
       landing page, and the ASHA notification fan-out reads this column
       to decide which script to write a notice in. A household left on
       the column default would get notices it cannot read. */
    const payload = { consents, language };
    const put = (key, value) => {
      if (value !== null && value !== undefined && value !== '') payload[key] = value;
    };

    put('name', form.name.trim());
    put('phone', form.phone.trim());
    put('gender', form.gender);
    put('district', form.district.trim());
    put('village', form.village.trim());
    put('block', form.block.trim());
    put('ration_card_type', form.ration_card_type);

    const age = Number.parseInt(form.age, 10);
    if (Number.isFinite(age) && age > 0 && age < 130) payload.age = age;

    if (form.is_pregnant_or_lactating === true) payload.is_pregnant_or_lactating = true;

    const result = await updateProfile(payload);
    setSaving(false);

    /* A failed save stays on this page with the reason on screen. */
    if (result?.ok === false) {
      setError(
        result.error ||
          t(
            'Your details could not be saved. Nothing was lost — try again.',
            'आपका विवरण सेव नहीं हो सका। कुछ भी नहीं गया — फिर कोशिश करें।',
          ),
      );
      return;
    }

    setLocation('/app');
  };

  return (
    <main className={`shell reg-paper pb-16 pt-8 sm:pt-12 ${hi ? 'is-deva' : ''}`}>
      <div className="mx-auto max-w-2xl">
        <Eyebrow>{t('Register · First details', 'रजिस्टर · पहला विवरण')}</Eyebrow>
        <h1 className="display-lg mt-3">
          {t('A few details, in your own words', 'कुछ बातें, आपके अपने शब्दों में')}
        </h1>
        <p className="lede mt-4">
          {t(
            'These are used for two things only: to find which ASHA worker covers your village, and to work out which schemes are worth checking for your household. Nothing here is required except your name — you can fill the rest later, or not at all.',
            'ये दो कामों के लिए हैं: आपके गाँव की आशा कार्यकर्ता पता करने के लिए, और यह देखने के लिए कि आपके परिवार के लिए कौन-सी योजनाएँ जाँचने योग्य हैं। नाम के अलावा कुछ भी ज़रूरी नहीं — बाकी बाद में भर सकते हैं, या नहीं भी।',
          )}
        </p>

        {/* Said BEFORE the form, not after the save fails.
            /api/profile writes to public.profiles against the caller's own
            token, so with no account there is no row to write to and the
            save comes back "Sign in to continue" — which is true, and a
            terrible thing to learn after typing in nine fields. */}
        {!isAuthenticated && !authLoading ? (
          <Card tone="amber" className="mt-7 p-5" role="status">
            <Eyebrow>{t('These will not save yet', 'ये अभी सेव नहीं होंगे')}</Eyebrow>
            <p className="mt-2.5 text-[0.88rem] leading-relaxed text-ink-soft">
              {t(
                'Your details are stored against an account, and there is no account on this device yet. Make one first and this form will save; without one you can still use the assistant, the schemes and the hospital search.',
                'आपका विवरण किसी खाते के साथ सहेजा जाता है, और इस उपकरण पर अभी कोई खाता नहीं है। पहले खाता बनाएँ, फिर यह फ़ॉर्म सेव होगा; खाते के बिना भी सहायक, योजनाएँ और अस्पताल खोज चलती रहेंगी।',
              )}
            </p>
            <Btn as={Link} href="/signin" variant="primary" className="mt-4">
              {t('Create an account or sign in', 'खाता बनाएँ या साइन इन करें')}
              <ArrowRight size={16} aria-hidden="true" />
            </Btn>
          </Card>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-9 space-y-4">
          <Card className="p-5 sm:p-7">
            <Eyebrow>{t('01 · About you', '01 · आपके बारे में')}</Eyebrow>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label={t('Your name', 'आपका नाम')}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name')(e.target.value)}
                  autoComplete="name"
                  required
                  placeholder={t('As you would say it', 'जैसे आप बताते हैं')}
                  className="field mt-2"
                  data-testid="input-onboarding-name"
                />
              </Field>

              <Field
                label={t('Phone number', 'फ़ोन नंबर')}
                hint={t(
                  'So an ASHA worker can call you back.',
                  'इससे आशा कार्यकर्ता आपको कॉल कर सकती हैं।',
                )}
              >
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                  autoComplete="tel"
                  inputMode="tel"
                  className="field mt-2"
                />
              </Field>

              <Field label={t('Age in years', 'उम्र (वर्ष)')}>
                <input
                  type="number"
                  min="0"
                  max="129"
                  value={form.age}
                  onChange={(e) => set('age')(e.target.value)}
                  inputMode="numeric"
                  className="field mt-2"
                />
              </Field>

              <Field label={t('Gender', 'लिंग')}>
                <select
                  value={form.gender}
                  onChange={(e) => set('gender')(e.target.value)}
                  className="field mt-2"
                >
                  {/* An empty first option, so "not answered" is a
                      real state rather than whatever sorts first. */}
                  <option value="">{t('Prefer not to say', 'बताना नहीं चाहते')}</option>
                  {GENDERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {hi ? option.hi : option.en}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card className="p-5 sm:p-7">
            <Eyebrow>{t('02 · Where you live', '02 · आप कहाँ रहते हैं')}</Eyebrow>
            <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink-soft">
              {t(
                'Your village decides which ASHA worker is yours and which notices reach you.',
                'आपका गाँव तय करता है कि कौन-सी आशा कार्यकर्ता आपकी है और कौन-सी सूचनाएँ आपको मिलेंगी।',
              )}
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label={t('Village or town', 'गाँव / कस्बा')}>
                <input
                  type="text"
                  value={form.village}
                  onChange={(e) => set('village')(e.target.value)}
                  className="field mt-2"
                  data-testid="input-onboarding-village"
                />
              </Field>

              <Field
                label={t('District', 'ज़िला')}
                hint={t(
                  'Needed before your village can be matched — there is a Rampur in most districts of India.',
                  'गाँव मिलाने से पहले यह ज़रूरी है — भारत के लगभग हर ज़िले में एक रामपुर है।',
                )}
              >
                <input
                  type="text"
                  value={form.district}
                  onChange={(e) => set('district')(e.target.value)}
                  className="field mt-2"
                />
              </Field>

              {/* Optional, and it earns its place: uq_villages_identity
                  treats a village as (name, block, district, state), so
                  two Shyampurs in one district are two rows. Without a
                  block there is nothing to tell them apart, and the server
                  refuses to guess rather than attaching a household to a
                  worker who does not cover it. */}
              <Field
                label={t('Block or tehsil (optional)', 'ब्लॉक / तहसील (ज़रूरी नहीं)')}
                hint={t(
                  'Only needed if another village in your district has the same name.',
                  'केवल तब ज़रूरी है जब आपके ज़िले के किसी और गाँव का नाम भी यही हो।',
                )}
              >
                <input
                  type="text"
                  value={form.block}
                  onChange={(e) => set('block')(e.target.value)}
                  className="field mt-2"
                />
              </Field>

              <Field
                label={t('Ration card', 'राशन कार्ड')}
                hint={t(
                  'Several schemes are tied to the card type. This app cannot verify it — the office does that.',
                  'कई योजनाएँ कार्ड के प्रकार से जुड़ी हैं। यह ऐप इसकी पुष्टि नहीं कर सकता — वह दफ़्तर करता है।',
                )}
              >
                <select
                  value={form.ration_card_type}
                  onChange={(e) => set('ration_card_type')(e.target.value)}
                  className="field mt-2"
                >
                  <option value="">{t('Not sure', 'पता नहीं')}</option>
                  {RATION_CARDS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {hi ? option.hi : option.en}
                    </option>
                  ))}
                </select>
              </Field>

              <label className="flex cursor-pointer items-start gap-3 self-end pb-1">
                <input
                  type="checkbox"
                  checked={form.is_pregnant_or_lactating}
                  onChange={(e) => set('is_pregnant_or_lactating')(e.target.checked)}
                  className="mt-0.5 h-[1.15rem] w-[1.15rem] shrink-0 accent-seal"
                />
                <span className="text-[0.88rem] leading-snug text-ink">
                  {t(
                    'Pregnant or feeding a baby right now',
                    'अभी गर्भवती हैं या बच्चे को दूध पिला रही हैं',
                  )}
                </span>
              </label>
            </div>
          </Card>

          {/* ---------- Consent ----------
              Every box starts empty. Only the guidance disclaimer is
              required, because it is the one statement the app has to
              know the person has read. */}
          <Card tone="seal" className="p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="shrink-0 text-seal" aria-hidden="true" />
              <Eyebrow>{t('03 · What you agree to', '03 · आप किससे सहमत हैं')}</Eyebrow>
            </div>

            <div className="mt-5 space-y-3.5">
              <Consent
                checked={consents.health_guidance_disclaimer}
                onChange={setConsent('health_guidance_disclaimer')}
                title={t(
                  'I understand this app gives guidance, not a diagnosis',
                  'मैं समझता/समझती हूँ कि यह ऐप मार्गदर्शन देता है, निदान नहीं',
                )}
                body={t(
                  'It never prescribes medicine and never replaces a doctor. Anything urgent goes to 108.',
                  'यह कभी दवा नहीं लिखता और डॉक्टर की जगह नहीं लेता। कुछ भी गंभीर हो तो 108।',
                )}
              />
              <Consent
                checked={consents.voice_processing}
                onChange={setConsent('voice_processing')}
                title={t('Process what I say, to answer me', 'जो मैं बोलूँ, उसे समझकर जवाब दें')}
                body={t(
                  'Your speech is sent to Google Gemini to be understood and answered. Without this the app can still be typed to.',
                  'आपकी आवाज़ समझने और जवाब देने के लिए Google Gemini को भेजी जाती है। इसके बिना भी ऐप में टाइप कर सकते हैं।',
                )}
              />
              <Consent
                checked={consents.location_access}
                onChange={setConsent('location_access')}
                title={t('Use my location to find hospitals', 'अस्पताल खोजने के लिए मेरी लोकेशन लें')}
                body={t(
                  'Asked for only when you tap it, and used to measure distance. Without it, hospital distances cannot be worked out.',
                  'सिर्फ़ तब पूछा जाता है जब आप दबाते हैं, और दूरी नापने के लिए इस्तेमाल होता है। इसके बिना अस्पताल की दूरी नहीं निकल सकती।',
                )}
              />
              <Consent
                checked={consents.asha_referral_consent}
                onChange={setConsent('asha_referral_consent')}
                title={t(
                  'Let an ASHA worker be told if I raise an emergency',
                  'आपातकाल में आशा कार्यकर्ता को बताया जा सकता है',
                )}
                body={t(
                  'Only when you send an SOS yourself. Your name, number and what you described go to the worker for your village.',
                  'सिर्फ़ जब आप ख़ुद SOS भेजें। आपका नाम, नंबर और आपने जो बताया, वह आपके गाँव की कार्यकर्ता तक जाता है।',
                )}
              />
            </div>

            <p className="mt-5 text-[0.78rem] leading-relaxed text-ink-faint">
              {t(
                'You can change any of these later from Settings. Nothing here is shared with anybody outside this app.',
                'आप इन्हें बाद में सेटिंग्स से बदल सकते हैं। इसमें से कुछ भी इस ऐप के बाहर किसी को नहीं दिया जाता।',
              )}
            </p>
          </Card>

          {/* A failed save says so, here, and stays put. */}
          {error ? (
            <Card
              tone="siren"
              className="flex items-start gap-3 p-4"
              role="alert"
              data-testid="text-onboarding-error"
            >
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-siren" aria-hidden="true" />
              <p className="text-[0.87rem] leading-relaxed text-ink">{error}</p>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Btn
              type="submit"
              size="lg"
              disabled={!canSubmit}
              data-testid="btn-submit-onboarding"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              ) : null}
              {saving
                ? t('Saving', 'सेव कर रहे हैं')
                : t('Save and continue', 'सेव करें और आगे बढ़ें')}
              {!saving ? <ArrowRight size={16} aria-hidden="true" /> : null}
            </Btn>

            {/* Somebody whose child has a fever should not be held
                at a form. */}
            <Btn as={Link} href="/app" variant="outline" data-testid="btn-skip-onboarding">
              <SkipForward size={15} aria-hidden="true" />
              {t('Skip for now', 'अभी छोड़ें')}
            </Btn>
          </div>

          {!canSubmit && !saving ? (
            <p className="text-[0.8rem] leading-relaxed text-ink-faint">
              {form.name.trim().length === 0
                ? t('Your name is needed to save.', 'सेव करने के लिए नाम ज़रूरी है।')
                : t(
                    'Tick the first box to confirm you have read what this app does and does not do.',
                    'पहला बॉक्स चुनें — यह पुष्टि करने के लिए कि आपने पढ़ा है कि यह ऐप क्या करता है और क्या नहीं।',
                  )}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
