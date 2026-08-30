import React, { useEffect, useState } from 'react';
import { ShieldCheck, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import { getT } from '@/services/i18n';
import { Btn } from '@/components/ds';

/* =============================================================
   The consent sheet — the one place privacy copy belongs.

   There is no separate privacy page in this app, by decision:
   an essay somebody scrolls past is not consent. What is here
   instead is four permissions, each naming the thing that
   actually happens — the service the recording goes to, the
   coordinate that leaves the phone, the person who reads the
   referral — and what stops if the answer is no.

   Two rules this file follows:

   1. Nothing is pre-granted. An earlier version opened with all
      four switches on, so a person who tapped "Save" without
      reading had "agreed" to everything. A missing consent is
      read as a refusal here, which is what the store and the
      server both default to.

   2. A refusal is a real answer. Every switch can be off and the
      app still works: schemes, the hospital register, the
      helpline and 108 do not depend on any of them.
   ============================================================= */

/** The four keys the profile stores. Order is the order on screen. */
const CONSENT_KEYS = [
  'voice_processing',
  'location_access',
  'health_guidance_disclaimer',
  'asha_referral_consent',
];

/**
 * Anything absent is a refusal, never a default yes.
 *
 * Keys are written in a fixed order so the serialised form below is
 * stable, and so a `consents` object arriving from the server with the
 * keys in a different order does not look like a change.
 */
function normaliseConsents(consents) {
  const out = {};
  for (const key of CONSENT_KEYS) out[key] = consents?.[key] === true;
  return out;
}

/**
 * One permission switch, sized for a thumb.
 *
 * The visible track is 44px wide but the tappable box around it is a
 * full 2.75rem square, which is the floor the brief sets for a cheap
 * phone held in one hand.
 */
function ConsentSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="grid min-h-[2.75rem] min-w-[2.75rem] shrink-0 place-items-center rounded-sm"
    >
      <span
        className={`relative block h-7 w-12 rounded-full border-[1.5px] p-0.5 transition-colors ${
          checked ? 'border-seal bg-seal' : 'border-rule bg-paper-3'
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-paper-2 shadow-rest transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

export function ConsentDialog({ open, onClose, consents, onSaveConsents, language = 'English' }) {
  const t = getT(language);
  const deva = t.isHindi;

  const [localConsents, setLocalConsents] = useState(() => normaliseConsents(consents));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  /* Re-read the stored answers each time the sheet is opened. The
     profile hydrates from the server after this component first
     mounts, so state seeded once at mount would show a stale set of
     switches. Keyed on the serialised value rather than the object so
     a caller passing a fresh literal every render cannot reset a
     switch under the user's finger mid-edit. */
  const signature = JSON.stringify(normaliseConsents(consents));

  useEffect(() => {
    if (!open) return;
    setLocalConsents(JSON.parse(signature));
    setError(null);
    setSaving(false);
  }, [open, signature]);

  if (!open) return null;

  const toggle = (key, next) => setLocalConsents((prev) => ({ ...prev, [key]: next }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Callers return {ok:true} or {ok:false, error} from
      // updateProfile. On failure the sheet stays open with the
      // switches as the person set them, because closing it would
      // read as "saved".
      const result = await onSaveConsents(localConsents);
      if (result && result.ok === false) {
        setError(
          result.error ||
            t(
              'Your answers were not saved. Check your connection and try again.',
              'आपके उत्तर सहेजे नहीं गए। कनेक्शन जाँचकर फिर कोशिश करें।',
            ),
        );
        return;
      }
      onClose();
    } catch (e) {
      setError(
        e?.message ||
          t(
            'Your answers were not saved. Check your connection and try again.',
            'आपके उत्तर सहेजे नहीं गए। कनेक्शन जाँचकर फिर कोशिश करें।',
          ),
      );
    } finally {
      setSaving(false);
    }
  };

  /* Each row says the thing that happens, names who receives it, and
     says what is withheld on a refusal. No legal wording: a person
     deciding whether to let a recording leave their phone needs the
     specifics, not a definition of "processing". */
  const ITEMS = [
    {
      key: 'voice_processing',
      title: t('Sending your voice to be turned into text', 'आपकी आवाज़ को लिखाई में बदलने के लिए भेजना'),
      granted: t(
        'When you hold the microphone, the recording is sent to Google’s Gemini service, turned into text, and answered. The audio is not kept afterwards.',
        'जब आप माइक दबाकर बोलते हैं, वह रिकॉर्डिंग गूगल की जेमिनी सेवा को भेजी जाती है, लिखाई में बदली जाती है और उसका जवाब दिया जाता है। ऑडियो बाद में नहीं रखा जाता।',
      ),
      refused: t(
        'Nothing is recorded and nothing is sent. Type your question instead — the answer is the same.',
        'कुछ रिकॉर्ड नहीं होगा और कुछ भेजा नहीं जाएगा। सवाल टाइप कर लें — जवाब वही रहेगा।',
      ),
    },
    {
      key: 'location_access',
      title: t('Sharing where you are with the hospital search', 'अस्पताल खोज के लिए अपनी जगह बताना'),
      granted: t(
        'Your phone’s coordinates go with the hospital search so the distance to each hospital can be measured. They are used for that search and are not saved to your profile.',
        'आपके फ़ोन से मिली स्थिति अस्पताल खोज के साथ जाती है, ताकि हर अस्पताल की दूरी नापी जा सके। यह केवल उस खोज में इस्तेमाल होती है, प्रोफ़ाइल में नहीं सहेजी जाती।',
      ),
      refused: t(
        'No coordinates leave your phone. Hospitals are listed by state and district instead, with no distance shown — the list is still the same registry.',
        'कोई स्थिति आपके फ़ोन से बाहर नहीं जाती। अस्पताल राज्य और ज़िले से दिखते हैं, दूरी के बिना — सूची उसी रजिस्टर से रहती है।',
      ),
    },
    {
      key: 'health_guidance_disclaimer',
      title: t('Health guidance no doctor has checked', 'ऐसी स्वास्थ्य सलाह जिसे किसी डॉक्टर ने नहीं देखा'),
      granted: t(
        'You will see guidance about symptoms written by a computer program. It is not a diagnosis, no clinician has reviewed it, and it can be wrong.',
        'आपको लक्षणों के बारे में सलाह दिखेगी, जो एक कंप्यूटर प्रोग्राम ने लिखी है। यह जाँच या निदान नहीं है, किसी डॉक्टर ने इसे नहीं देखा है, और यह गलत भी हो सकती है।',
      ),
      refused: t(
        'Symptom guidance is withheld. Scheme information and the hospital register still work, and 108 still works without this app.',
        'लक्षणों की सलाह नहीं दिखाई जाएगी। योजनाओं की जानकारी और अस्पताल रजिस्टर चलते रहेंगे, और 108 इस ऐप के बिना भी चलता है।',
      ),
    },
    {
      key: 'asha_referral_consent',
      title: t('Sharing a referral with your ASHA worker', 'आशा कार्यकर्ता को रेफरल भेजना'),
      granted: t(
        'When you send an emergency alert or a message, your name, your village and what you wrote go to the ASHA worker recorded for your village — nobody else.',
        'जब आप आपातकालीन सूचना या संदेश भेजते हैं, तो आपका नाम, गाँव और लिखी बात आपके गाँव के लिए दर्ज आशा कार्यकर्ता तक जाती है — किसी और तक नहीं।',
      ),
      refused: t(
        'Nothing is sent to her from this app. You can still call her yourself; her number is on My details.',
        'इस ऐप से उन्हें कुछ नहीं भेजा जाएगा। आप खुद कॉल कर सकते हैं; उनका नंबर “मेरा विवरण” में है।',
      ),
    },
  ];

  return (
    <div
      id="dialog-user-consent"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-dialog-title"
        className={`max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-card border border-rule bg-paper-2 p-5 shadow-lift sm:rounded-card sm:p-7 ${
          deva ? 'is-deva' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        data-testid="panel-consent-dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-seal-soft text-seal">
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="eyebrow">{t('Permissions', 'अनुमतियाँ')}</p>
              <h2 id="consent-dialog-title" className="display-md mt-1.5 text-2xl">
                {t('What this app may do', 'यह ऐप क्या कर सकता है')}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'बंद करें')}
            className="grid min-h-[2.75rem] min-w-[2.75rem] shrink-0 place-items-center rounded-sm border border-rule text-ink-soft hover:border-ink hover:text-ink"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-5 text-[0.9rem] leading-relaxed text-ink-soft">
          {t(
            'Four things, each one separate. Every one of them can be off — nothing here is required to look up a scheme, find an empanelled hospital, or call 108.',
            'चार बातें, हर एक अलग। इनमें से हर एक बंद रह सकती है — योजना देखने, सूचीबद्ध अस्पताल खोजने या 108 पर कॉल करने के लिए इनमें से कुछ भी ज़रूरी नहीं है।',
          )}
        </p>

        <ul className="mt-5 space-y-3">
          {ITEMS.map((item) => {
            const on = localConsents[item.key] === true;

            return (
              <li
                key={item.key}
                className="rounded-sm border border-rule bg-paper p-4"
                data-testid={`consent-${item.key}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[0.95rem] font-semibold leading-snug text-ink">
                    {item.title}
                  </p>
                  <ConsentSwitch
                    checked={on}
                    onChange={(next) => toggle(item.key, next)}
                    label={item.title}
                  />
                </div>

                <dl className="mt-2.5 space-y-1.5 text-[0.85rem] leading-relaxed">
                  <div className={on ? 'text-ink-soft' : 'text-ink-faint'}>
                    <dt className="eyebrow inline">{t('If you agree', 'सहमत हों तो')}</dt>{' '}
                    <dd className="inline">{item.granted}</dd>
                  </div>
                  <div className={on ? 'text-ink-faint' : 'text-ink-soft'}>
                    <dt className="eyebrow inline">{t('If you do not', 'सहमत न हों तो')}</dt>{' '}
                    <dd className="inline">{item.refused}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>

        <p className="mt-5 text-[0.85rem] leading-relaxed text-ink-faint">
          {t(
            'Your answers are stored on your profile and can be changed here at any time. Turning one off does not remove anything already sent.',
            'आपके उत्तर आपकी प्रोफ़ाइल में रखे जाते हैं और कभी भी यहीं बदले जा सकते हैं। किसी को बंद करने से पहले भेजी गई बात वापस नहीं आती।',
          )}
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-sm border border-siren bg-siren-soft p-3.5 text-[0.875rem] leading-relaxed text-ink"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-siren" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Btn variant="outline" onClick={onClose} disabled={saving}>
            {t('Cancel', 'रद्द करें')}
          </Btn>
          <Btn onClick={handleSave} disabled={saving} data-testid="btn-save-consents">
            {saving ? (
              <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={17} aria-hidden="true" />
            )}
            {saving ? t('Saving…', 'सहेज रहे हैं…') : t('Save my answers', 'मेरे उत्तर सहेजें')}
          </Btn>
        </div>
      </div>
    </div>
  );
}
