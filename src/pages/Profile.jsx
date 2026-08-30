import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  Save,
  ShieldCheck,
  Phone,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import { getAshaContact } from '@/services/platform';
import { ConsentDialog } from '@/components/common/ConsentDialog';
import {
  Btn,
  Card,
  Eyebrow,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  SectionHead,
} from '@/components/ds';

/* =============================================================
   /profile — "My details".

   This screen used to open with somebody else's life in it:
   Meera Sharma, 32, Female, Sehore, Mandi, BPL Priority
   Household, four family members, mild hypertension. None of it
   was real, and it was pre-filled into a form whose Save button
   would have written it to the account of whoever was actually
   holding the phone.

   The store now starts empty and hydrates from GET /api/profile,
   so this page has three honest states and shows exactly one:

     LOADING   the request has not settled. A skeleton, never
               zeros — "0 family members" and "age 0" are claims,
               and they are wrong ones.
     EMPTY     it settled and the record is blank. This is a new
               account, not a failure, so it reads as an
               invitation to fill it in.
     FILLED    the person's own answers, editable.

   A failed save is reported. updateProfile() resolves
   {ok:false, error} rather than throwing, and the earlier version
   showed "Health profile updated successfully!" unconditionally —
   including when the write had failed.
   ============================================================= */

const GENDERS = [
  { value: 'Female', en: 'Female', dev: 'महिला' },
  { value: 'Male', en: 'Male', dev: 'पुरुष' },
  { value: 'Other', en: 'Other', dev: 'अन्य' },
];

/* The stored strings, unchanged. The scheme eligibility checker on the
   server matches /bpl|priority|antyodaya|aay|nfsa/i against this exact
   value, so rewording an option here would silently change a
   checklist answer from "met" to "not met". */
const RATION_CARDS = [
  {
    value: 'Antyodaya (AAY)',
    en: 'Antyodaya — AAY',
    dev: 'अंत्योदय — AAY',
  },
  {
    value: 'BPL (Priority Household)',
    en: 'Priority Household — BPL',
    dev: 'पात्र गृहस्थी — BPL',
  },
  {
    value: 'APL / None',
    en: 'Neither, or no ration card',
    dev: 'इनमें से कोई नहीं, या राशन कार्ड नहीं',
  },
];

const BLANK_FORM = {
  name: '',
  phone: '',
  age: '',
  gender: '',
  state: '',
  district: '',
  village: '',
  ration_card_type: '',
  family_members: '',
  is_pregnant_or_lactating: false,
  chronic_conditions: '',
};

/** The profile as form strings. null and undefined both mean "not filled". */
function formFrom(profile) {
  const text = (value) => (value === null || value === undefined ? '' : String(value));

  return {
    name: text(profile?.name),
    phone: text(profile?.phone),
    age: text(profile?.age),
    gender: text(profile?.gender),
    state: text(profile?.state),
    district: text(profile?.district),
    village: text(profile?.village),
    ration_card_type: text(profile?.ration_card_type),
    family_members: text(profile?.family_members),
    is_pregnant_or_lactating: profile?.is_pregnant_or_lactating === true,
    chronic_conditions: Array.isArray(profile?.chronic_conditions)
      ? profile.chronic_conditions.join(', ')
      : text(profile?.chronic_conditions),
  };
}

/** Blank stays blank. A number the person never typed is not a zero. */
const numberOrNull = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const listFrom = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Has this account told us anything at all yet? */
function isBlankProfile(profile) {
  const filled = [
    profile?.name,
    profile?.phone,
    profile?.age,
    profile?.gender,
    profile?.state,
    profile?.district,
    profile?.village,
    profile?.ration_card_type,
    profile?.family_members,
  ].some((v) => v !== null && v !== undefined && String(v).trim() !== '');

  return !filled && !(profile?.chronic_conditions?.length > 0);
}

/**
 * The village on the ASHA contact response.
 *
 * /api/asha/contact returns it as a row — {id, name, block, district,
 * state} — so it is read as an object first and tolerated as a plain
 * string, which is what an older shape of this endpoint returned.
 */
function villageLabel(village) {
  if (!village) return '';
  if (typeof village === 'string') return village;
  return [village.name, village.block, village.district].filter(Boolean).join(', ');
}

/** A labelled text field. `.field` carries the 3.25rem tap height. */
function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[0.8rem] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/* -------------------------------------------------------------
   02 · Your ASHA worker

   The one thing on this page that comes from the server rather
   than from the person. Her name and number are printed only if
   the registry holds a worker mapped to their village; when it
   does not, the server's own sentence says so and no neighbouring
   village's worker is substituted.
   ------------------------------------------------------------- */
function AshaContact({ contact, loading, error, onRetry, signedIn, t }) {
  if (!signedIn) {
    return (
      <EmptyState
        stamp={false}
        title={t('Sign in to see who covers your village', 'अपने गाँव की कार्यकर्ता देखने के लिए साइन इन करें')}
        body={t(
          'Which ASHA worker is yours depends on the village on your record, so we have to know whose record this is.',
          'कौन-सी आशा कार्यकर्ता आपकी है, यह आपके रिकॉर्ड में दर्ज गाँव से तय होता है — इसलिए पहले पहचान ज़रूरी है।',
        )}
      />
    );
  }

  if (loading) {
    return (
      <LoadingState
        label={t('Looking up your ASHA worker', 'आपकी आशा कार्यकर्ता खोज रहे हैं')}
        rows={1}
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title={t('We could not look her up', 'जानकारी नहीं मिल सकी')}
        body={
          error.message ||
          t(
            'The server could not be reached. That is a connection problem — it does not mean no worker covers your village.',
            'सर्वर तक नहीं पहुँच सके। यह कनेक्शन की समस्या है — इसका मतलब यह नहीं कि आपके गाँव में कोई कार्यकर्ता नहीं है।',
          )
        }
        onRetry={onRetry}
        retryLabel={t('Try again', 'फिर कोशिश करें')}
      />
    );
  }

  const asha = contact?.asha ?? null;

  /* Nobody mapped. The server said why in one sentence and that
     sentence is the whole content of this state — inventing a name
     or a number here is the most harmful thing this page could do. */
  if (!asha) {
    const helpline = contact?.helpline ?? null;

    return (
      <div className="space-y-4">
        <Card className="p-5">
          <Eyebrow>{t('No worker linked yet', 'अभी कोई कार्यकर्ता दर्ज नहीं')}</Eyebrow>
          <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">
            {contact?.note ||
              t(
                'No ASHA worker is linked to your village in this app yet, so there is no name or number to show you.',
                'इस ऐप में अभी आपके गाँव के लिए कोई आशा कार्यकर्ता दर्ज नहीं है, इसलिए दिखाने के लिए कोई नाम या नंबर नहीं है।',
              )}
          </p>
        </Card>

        {helpline?.number ? (
          <Card tone="seal" className="p-5">
            <Eyebrow>{t('In the meantime', 'तब तक')}</Eyebrow>
            <h3 className="display-md mt-2.5 text-xl">
              {helpline.label || t('Government health helpline', 'सरकारी स्वास्थ्य हेल्पलाइन')}
            </h3>
            <p className="figure mt-3 text-4xl text-seal">{helpline.number}</p>
            <div className="mt-5">
              <Btn as="a" href={`tel:${helpline.number}`}>
                <Phone size={17} aria-hidden="true" />
                {t('Call the helpline', 'हेल्पलाइन पर कॉल करें')}
              </Btn>
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  const alsoCovering = contact?.alsoCovering ?? [];
  const village = villageLabel(contact?.village);

  return (
    <div className="space-y-4">
      <Card tone="asha" className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>{t('Your ASHA worker', 'आपकी आशा कार्यकर्ता')}</Eyebrow>
          {asha.isPrimary ? (
            <Pill tone="asha">{t('Primary for your village', 'आपके गाँव की मुख्य कार्यकर्ता')}</Pill>
          ) : null}
        </div>

        <h3 className="display-md mt-3 text-2xl">{asha.fullName}</h3>

        <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {village ? (
            <div>
              <Eyebrow>{t('Village', 'गाँव')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">{village}</p>
            </div>
          ) : null}
          {asha.subCentre ? (
            <div>
              <Eyebrow>{t('Sub-centre', 'उपकेंद्र')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">{asha.subCentre}</p>
            </div>
          ) : null}
          {asha.ashaCode ? (
            <div>
              <Eyebrow>{t('ASHA code', 'आशा कोड')}</Eyebrow>
              <p className="mt-1.5 font-mono text-[0.95rem] text-ink">{asha.ashaCode}</p>
            </div>
          ) : null}
          {asha.phone ? (
            <div>
              <Eyebrow>{t('Phone', 'फ़ोन')}</Eyebrow>
              <p className="figure mt-1.5 text-2xl text-ink">{asha.phone}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {/* A call is the fastest thing available to somebody standing
              in a courtyard with a sick child, so the number is printed
              in full and the call is the primary action. */}
          {asha.phone ? (
            <Btn as="a" href={`tel:${asha.phone}`} variant="asha" size="lg">
              <Phone size={18} aria-hidden="true" />
              {t('Call her now', 'अभी कॉल करें')}
            </Btn>
          ) : null}
          <Btn as={Link} href="/messages" variant="outline" size="lg">
            <MessageSquare size={18} aria-hidden="true" />
            {t('Write to her instead', 'लिखकर भेजें')}
          </Btn>
        </div>
      </Card>

      {alsoCovering.length ? (
        <Card className="p-5">
          <Eyebrow>{t('Also covering your village', 'आपके गाँव में और भी')}</Eyebrow>
          <ul className="mt-3 space-y-2.5">
            {alsoCovering.map((worker) => (
              <li
                key={worker.userId || worker.ashaCode || worker.fullName}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-[0.95rem] text-ink">{worker.fullName}</span>
                {worker.phone ? (
                  <Btn as="a" href={`tel:${worker.phone}`} variant="outline">
                    <Phone size={15} aria-hidden="true" />
                    {worker.phone}
                  </Btn>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {contact?.source ? (
        <p className="font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {t('Source: ', 'स्रोत: ')}
          {contact.source}
        </p>
      ) : null}
    </div>
  );
}

export function Profile() {
  const { language, userProfile, profileLoading, profileError, updateProfile, refreshProfile } =
    useAppState();
  const { isAuthenticated } = useAuth();

  const t = getT(language);
  const deva = t.isHindi;

  const [consentOpen, setConsentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // null until a save has been attempted, then {ok} or {ok:false, error}.
  const [saveOutcome, setSaveOutcome] = useState(null);

  /* null means "not seeded yet". The form is seeded once, when the
     profile request settles, and never again: re-seeding on every
     change to userProfile would take the field out from under
     somebody's thumb mid-sentence. */
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profileLoading) return;
    setForm((prev) => (prev === null ? formFrom(userProfile) : prev));
  }, [profileLoading, userProfile]);

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const blank = isBlankProfile(userProfile);

  const contact = useAsync(() => getAshaContact(), [userProfile?.village ?? ''], {
    skip: !isAuthenticated,
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form) return;

    setSaving(true);
    setSaveOutcome(null);

    const result = await updateProfile({
      name: form.name.trim(),
      phone: form.phone.trim(),
      age: numberOrNull(form.age),
      gender: form.gender,
      state: form.state.trim(),
      district: form.district.trim(),
      village: form.village.trim(),
      ration_card_type: form.ration_card_type,
      family_members: numberOrNull(form.family_members),
      is_pregnant_or_lactating: form.is_pregnant_or_lactating,
      chronic_conditions: listFrom(form.chronic_conditions),
    });

    setSaving(false);
    setSaveOutcome(result ?? { ok: true });
  };

  const saveConsents = useCallback((consents) => updateProfile({ consents }), [updateProfile]);

  /* profileError covers both a failed load and a failed save. When a
     save just failed, the alert beside the button already says so, and
     repeating it as a page-level error reads as two problems. */
  const loadError = saveOutcome?.ok === false ? null : profileError;

  return (
    <main
      className={`shell reg-paper pad-bottom-nav pt-8 sm:pt-12 ${deva ? 'is-deva' : ''}`}
      lang={deva ? 'hi' : 'en'}
    >
      {/* ================= Head ================= */}
      <header className="border-b border-rule pb-10">
        <Eyebrow>{t('Register · My details', 'रजिस्टर · मेरा विवरण')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-3xl">{t('My details', 'मेरा विवरण')}</h1>
        <p className="lede mt-5 max-w-2xl">
          {t(
            'Two things use what you enter here: the scheme checks, which compare your answers against the published rules, and your village, which decides who your ASHA worker is. Nothing here is shared with anyone else.',
            'यहाँ भरी बातें दो जगह काम आती हैं: योजनाओं की जाँच, जो आपके उत्तरों को नियमों से मिलाती है, और आपका गाँव, जिससे तय होता है कि आपकी आशा कार्यकर्ता कौन हैं। यह जानकारी किसी और के साथ साझा नहीं की जाती।',
          )}
        </p>
      </header>

      {/* ================= 01 · Your details ================= */}
      <section className="mt-10">
        <SectionHead
          index="01"
          eyebrow={t('Your answers', 'आपके उत्तर')}
          title={t('What you have told us', 'आपने क्या बताया है')}
          sub={t(
            'These are your own answers, as you typed them. None of it has been checked against a government record, and this app does not hold your Aadhaar.',
            'ये आपके ही उत्तर हैं, जैसे आपने लिखे। इनमें से कुछ भी किसी सरकारी रिकॉर्ड से मिलाया नहीं गया है, और यह ऐप आपका आधार नहीं रखता।',
          )}
        />

        {loadError ? (
          <ErrorState
            className="mt-6"
            title={t('Your saved details did not load', 'आपका सहेजा विवरण लोड नहीं हुआ')}
            body={t(
              `${loadError} What you type below can still be saved.`,
              `${loadError} नीचे भरी बातें फिर भी सहेजी जा सकती हैं।`,
            )}
            onRetry={refreshProfile}
            retryLabel={t('Try again', 'फिर कोशिश करें')}
          />
        ) : null}

        {profileLoading || !form ? (
          <LoadingState
            className="mt-6"
            label={t('Loading your details', 'आपका विवरण लोड हो रहा है')}
            rows={3}
          />
        ) : (
          <>
            {blank ? (
              <Card tone="seal" className="mt-6 p-5">
                <Eyebrow>{t('Nothing filled in yet', 'अभी कुछ भरा नहीं है')}</Eyebrow>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">
                  {t(
                    'This record is empty, which is normal for a new account. Fill in what you know — you can leave anything blank, and a blank stays blank rather than becoming a guess.',
                    'यह रिकॉर्ड खाली है, जो नए खाते के लिए सामान्य है। जो पता है वही भरें — कुछ भी खाली छोड़ सकते हैं, और खाली खाना खाली ही रहेगा, अनुमान नहीं बनेगा।',
                  )}
                </p>
              </Card>
            ) : null}

            <form onSubmit={handleSave} className="mt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('Full name', 'पूरा नाम')}>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => set('name')(e.target.value)}
                    autoComplete="name"
                    className="field mt-2"
                  />
                </Field>

                <Field
                  label={t('Phone number', 'फ़ोन नंबर')}
                  hint={t(
                    'Used so an ASHA worker can call you back.',
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
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('Age in years', 'उम्र (वर्ष)')}>
                  <input
                    type="number"
                    min="0"
                    max="120"
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
                    <option value="">{t('Not stated', 'नहीं बताया')}</option>
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {t(g.en, g.dev)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t('People in the household', 'परिवार में सदस्य')}>
                  <input
                    type="number"
                    min="1"
                    max="40"
                    value={form.family_members}
                    onChange={(e) => set('family_members')(e.target.value)}
                    inputMode="numeric"
                    className="field mt-2"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('State', 'राज्य')}>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => set('state')(e.target.value)}
                    className="field mt-2"
                  />
                </Field>

                <Field label={t('District', 'ज़िला')}>
                  <input
                    type="text"
                    value={form.district}
                    onChange={(e) => set('district')(e.target.value)}
                    className="field mt-2"
                  />
                </Field>

                <Field
                  label={t('Village or town', 'गाँव या कस्बा')}
                  hint={t(
                    'This decides which ASHA worker is yours.',
                    'इससे तय होता है कि आपकी आशा कार्यकर्ता कौन हैं।',
                  )}
                >
                  <input
                    type="text"
                    value={form.village}
                    onChange={(e) => set('village')(e.target.value)}
                    className="field mt-2"
                  />
                </Field>
              </div>

              <Field
                label={t('Ration card your household holds', 'आपके घर का राशन कार्ड')}
                hint={t(
                  'Several schemes use this. Leave it as “Not stated” if you are unsure — a guess would be checked against the SECC list and fail there.',
                  'कई योजनाएँ इसे देखती हैं। पक्का न हो तो “नहीं बताया” ही रहने दें — अनुमान SECC सूची से मिलाने पर टिकता नहीं।',
                )}
              >
                <select
                  value={form.ration_card_type}
                  onChange={(e) => set('ration_card_type')(e.target.value)}
                  className="field mt-2"
                >
                  <option value="">{t('Not stated', 'नहीं बताया')}</option>
                  {RATION_CARDS.map((card) => (
                    <option key={card.value} value={card.value}>
                      {t(card.en, card.dev)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={t('Long-term conditions', 'पुरानी बीमारियाँ')}
                hint={t(
                  'Separate them with commas, for example: high blood pressure, asthma.',
                  'कॉमा लगाकर लिखें, जैसे: उच्च रक्तचाप, दमा।',
                )}
              >
                <input
                  type="text"
                  value={form.chronic_conditions}
                  onChange={(e) => set('chronic_conditions')(e.target.value)}
                  className="field mt-2"
                />
              </Field>

              <label className="flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-sm border border-rule bg-paper-2 p-4">
                <input
                  type="checkbox"
                  checked={form.is_pregnant_or_lactating}
                  onChange={(e) => set('is_pregnant_or_lactating')(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-asha"
                />
                <span className="min-w-0">
                  <span className="block text-[0.95rem] font-semibold text-ink">
                    {t(
                      'Someone in this household is pregnant or breastfeeding',
                      'इस घर में कोई गर्भवती या स्तनपान कराने वाली हैं',
                    )}
                  </span>
                  <span className="mt-1 block text-[0.85rem] leading-relaxed text-ink-faint">
                    {t(
                      'Maternity schemes are checked only when this is ticked.',
                      'मातृत्व योजनाओं की जाँच तभी होती है जब यह चुना हो।',
                    )}
                  </span>
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-4">
                <Btn type="submit" size="lg" disabled={saving} data-testid="btn-save-profile">
                  {saving ? (
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size={18} aria-hidden="true" />
                  )}
                  {saving ? t('Saving…', 'सहेज रहे हैं…') : t('Save my details', 'मेरा विवरण सहेजें')}
                </Btn>

                {saveOutcome?.ok ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-[0.9rem] font-semibold text-seal"
                  >
                    <CheckCircle2 size={17} aria-hidden="true" />
                    {t('Saved.', 'सहेज लिया गया।')}
                  </p>
                ) : null}
              </div>

              {saveOutcome?.ok === false ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-sm border border-siren bg-siren-soft p-4 text-[0.9rem] leading-relaxed text-ink"
                >
                  <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-siren"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-semibold">
                      {t('Not saved.', 'सहेजा नहीं गया।')}{' '}
                    </span>
                    {saveOutcome.error ||
                      t(
                        'The server did not accept the change.',
                        'सर्वर ने यह बदलाव स्वीकार नहीं किया।',
                      )}{' '}
                    {t(
                      'What you typed is still on screen — press Save again when the connection is back.',
                      'आपने जो लिखा वह स्क्रीन पर है — कनेक्शन आने पर फिर सहेजें दबाएँ।',
                    )}
                  </span>
                </div>
              ) : null}
            </form>
          </>
        )}
      </section>

      {/* ================= 02 · Your ASHA worker ================= */}
      <section className="mt-14">
        <SectionHead
          index="02"
          eyebrow={t('Who covers your village', 'आपके गाँव की कार्यकर्ता')}
          title={t('Your ASHA worker', 'आपकी आशा कार्यकर्ता')}
          sub={t(
            'Her name and number come from the ASHA village assignment in this app. If nobody is assigned to your village, this says so — a worker from a neighbouring village is never shown in her place.',
            'उनका नाम और नंबर इस ऐप में दर्ज आशा-गाँव नियुक्ति से आते हैं। अगर आपके गाँव के लिए कोई दर्ज नहीं है, तो यहाँ वही लिखा होगा — पड़ोस के गाँव की कार्यकर्ता कभी उनकी जगह नहीं दिखाई जाती।',
          )}
        />
        <div className="mt-6">
          <AshaContact
            contact={contact.data}
            loading={contact.loading}
            error={contact.error}
            onRetry={contact.reload}
            signedIn={isAuthenticated}
            t={t}
          />
        </div>
      </section>

      {/* ================= 03 · Permissions ================= */}
      <section className="mt-14">
        <SectionHead
          index="03"
          eyebrow={t('Permissions', 'अनुमतियाँ')}
          title={t('What this app may do', 'यह ऐप क्या कर सकता है')}
          sub={t(
            'Four separate answers: sending your voice to be transcribed, sharing your location with the hospital search, seeing guidance no doctor has checked, and passing a referral to your ASHA worker.',
            'चार अलग-अलग उत्तर: आवाज़ को लिखाई में बदलने के लिए भेजना, अस्पताल खोज में अपनी जगह बताना, ऐसी सलाह देखना जिसे किसी डॉक्टर ने नहीं देखा, और आशा कार्यकर्ता तक रेफरल भेजना।',
          )}
          action={
            <Btn variant="outline" onClick={() => setConsentOpen(true)}>
              <ShieldCheck size={17} aria-hidden="true" />
              {t('Review permissions', 'अनुमतियाँ देखें')}
            </Btn>
          }
        />
      </section>

      <ConsentDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        consents={userProfile?.consents}
        onSaveConsents={saveConsents}
        language={language}
      />
    </main>
  );
}
