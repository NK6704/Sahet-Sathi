import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import {
  Siren,
  Phone,
  Crosshair,
  Loader2,
  Info,
  ArrowLeft,
  Users,
  MapPinOff,
  Hospital,
  ChevronRight,
  Check,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getSosConfig,
  broadcastSos,
  getMySosBroadcasts,
  getSos,
  resolveSos,
} from '@/services/platform';
import {
  DeliveryReport,
  SosStatus,
  SOS_OUTCOMES,
  isLiveSos,
  timeAgo,
  timeStamp,
  telHref,
} from '@/components/emergency/EmergencyBanner';
import {
  Btn,
  Card,
  Eyebrow,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
  RegRule,
  SectionHead,
  Stamp,
} from '@/components/ds';

/* =============================================================
   /emergency — the SOS, and an honest account of what it did.

   The page is ordered by what actually works, not by what is most
   impressive. 108 and 112 come first and are plain tel: links,
   because they are dialled by the phone and reach a state ambulance
   service whether or not this app can reach its own server. The SOS
   below them is a second, weaker thing: it writes a critical alert
   into the queue of the ASHA worker covering the village, and it
   asks Twilio to text the numbers the family has saved.

   The delivery report is the reason this page was rebuilt. The old
   version printed "Local ASHA Worker (Radha Bai) notified via
   webhook & SMS" and "District Hospital Sehore Emergency Triage
   alerted" from a hard-coded string, in a build with no SMS sender
   configured, after a request that had already failed. Three false
   claims in a row, in the one place in the product where a false
   claim can get somebody killed. Nothing on this page now says a
   message reached anybody unless a delivery row from the server
   says so, and even then an accepted SMS is called accepted.

   This app dispatches no ambulance and has no way to. That is
   stated on the page rather than left to be assumed.
   ============================================================= */

/**
 * The categories offered, English value first.
 *
 * The value sent to the server is always the English one, in both
 * languages. It ends up in three places that are not the person
 * filling in this form: the title of the worker's alert, the body of
 * the SMS the server composes in English, and the audit record. A
 * Devanagari category would also push the whole SMS into UCS-2, which
 * halves the characters per segment and can cost the callback number
 * its place in the message.
 */
const CATEGORIES = [
  { value: 'Severe chest pain or suspected heart attack', hi: 'सीने में तेज़ दर्द / दिल का दौरा' },
  { value: 'Labour pain or maternal emergency', hi: 'प्रसव पीड़ा / मातृत्व आपातकाल' },
  { value: 'Severe breathing difficulty', hi: 'साँस लेने में गंभीर तकलीफ़' },
  { value: 'Accident, serious injury or heavy bleeding', hi: 'दुर्घटना, गंभीर चोट या तेज़ रक्तस्राव' },
  { value: 'Snakebite or poisoning', hi: 'साँप का काटना या ज़हर' },
  { value: 'Unconscious or having seizures', hi: 'बेहोशी या दौरे' },
  { value: 'High fever or fits in a child', hi: 'बच्चे को तेज़ बुखार या दौरे' },
  { value: 'Something else', hi: 'कुछ और' },
];

/* -------------------------------------------------------------
   Small pieces
   ------------------------------------------------------------- */

/** The server's own sentence, printed verbatim. */
function ServerNote({ children, className = '' }) {
  if (!children) return null;
  return (
    <Card className={`flex items-start gap-3 p-5 ${className}`}>
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

function Field({ label, hint, children, required = false }) {
  return (
    <label className="block">
      <span className="eyebrow">
        {label}
        {required ? <span className="text-siren"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-2 block text-[0.8rem] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/**
 * One hospital from the snapshot stored on the SOS.
 *
 * The listing is official — it is the National Health Authority's
 * PM-JAY empanelment register — but the phone number in it has never
 * been dialled by anything in this app, so the two are stamped
 * differently. Somebody ringing a number at three in the morning
 * should know which of those they are relying on.
 */
function HospitalRow({ hospital, index, t }) {
  const phone = hospital.phone || hospital.mobile;

  return (
    <li className="border-t border-rule-soft py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="reg-index">{index}</span>
            <p className="min-w-0 text-[1rem] font-semibold leading-snug text-ink">
              {hospital.name || t('Name not published', 'नाम दर्ज नहीं')}
            </p>
          </div>
          {hospital.address ? (
            <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-soft">{hospital.address}</p>
          ) : null}
          <p className="mt-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
            {[hospital.district, hospital.state, hospital.facilityType].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {typeof hospital.distanceKm === 'number' ? (
            <p className="figure text-2xl text-seal">
              {t(`${hospital.distanceKm} km`, `${hospital.distanceKm} किमी`)}
            </p>
          ) : null}
          {phone ? (
            <a
              href={telHref(phone)}
              className="mt-2 inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-seal hover:underline"
            >
              <Phone size={12} aria-hidden="true" />
              {phone}
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Stamp
          kind="verified"
          label={t('PM-JAY empanelled', 'पीएम-जय सूचीबद्ध')}
          source={hospital.source || undefined}
        />
        {phone ? (
          <Stamp
            kind={hospital.contactVerified ? 'verified' : 'inferred'}
            label={
              hospital.contactVerified
                ? t('Number checked', 'नंबर जाँचा गया')
                : t('Number never dialled by us', 'नंबर हमने कभी नहीं मिलाया')
            }
          />
        ) : (
          <Stamp kind="none" label={t('No number in the register', 'रजिस्टर में नंबर नहीं')} />
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------
   Record what happened
   ------------------------------------------------------------- */

/**
 * Closing an SOS. The server refuses a resolution with no outcome,
 * which is right: six months from now nobody can tell somebody who
 * reached hospital from a false alarm from somebody who gave up
 * waiting, and an SOS with no outcome records none of those.
 */
function ResolveForm({ sos, t, hi, onResolved }) {
  const [outcome, setOutcome] = useState('');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!outcome || saving) return;
    setSaving(true);
    setError(null);
    try {
      // The canonical outcome first so the record stays countable, with
      // whatever the family added kept after it rather than instead.
      const text = detail.trim() ? `${outcome} — ${detail.trim()}` : outcome;
      const res = await resolveSos(sos.id, text);
      onResolved(res?.sos ?? { ...sos, status: 'resolved', outcome: text });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Eyebrow>{t('Record what happened', 'क्या हुआ, दर्ज करें')}</Eyebrow>
      <p className="mt-2 max-w-xl text-[0.9rem] leading-relaxed text-ink-soft">
        {t(
          'Closing this keeps it out of the worker’s queue. An outcome is required — without one the record says an emergency was raised and nothing else.',
          'इसे बंद करने से यह कार्यकर्ता की सूची से हट जाएगा। नतीजा दर्ज करना ज़रूरी है — इसके बिना रिकॉर्ड में सिर्फ़ यह रहेगा कि आपातकाल दर्ज हुआ था।',
        )}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t('What happened', 'क्या हुआ')} required>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            required
            className="field mt-2 w-full"
          >
            <option value="">{t('Choose one', 'एक चुनें')}</option>
            {SOS_OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {hi ? o.hi : o.value}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('Anything to add', 'कुछ और जोड़ना है')}>
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            className="field mt-2 w-full"
            placeholder={t('Optional', 'ज़रूरी नहीं')}
          />
        </Field>
      </div>

      {error ? (
        <p className="mt-4 text-[0.9rem] font-semibold text-siren" role="alert">
          {error}
        </p>
      ) : null}

      <Btn type="submit" variant="outline" className="mt-5" disabled={!outcome || saving}>
        {saving ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Check size={16} aria-hidden="true" />
        )}
        {t('Close this SOS', 'यह SOS बंद करें')}
      </Btn>
    </form>
  );
}

/* -------------------------------------------------------------
   The delivery report
   ------------------------------------------------------------- */

/**
 * Everything the broadcast did, in the server's own words.
 *
 * `payload` is either the 201 from /sos/broadcast or the body of
 * GET /sos/:id. The two carry different amounts: only the broadcast
 * response knows which worker was alerted and why the hospital list
 * is the size it is, so those blocks appear when they exist and are
 * not reconstructed when they do not.
 */
function SosReport({ payload, t, hi, onBack, onAgain, onResolved }) {
  const sos = payload?.sos;
  if (!sos) return null;

  const deliveries = payload.deliveries ?? [];
  const hospitals = payload.nearestHospitals ?? [];
  // Absent on GET /sos/:id, where the coordinates on the row are the
  // only evidence either way.
  const locationShared =
    typeof payload.locationShared === 'boolean'
      ? payload.locationShared
      : sos.latitude !== null && sos.latitude !== undefined;

  return (
    <div className="space-y-8">
      <SectionHead
        index="02"
        eyebrow={t('What was sent', 'क्या भेजा गया')}
        title={
          sos.patientName
            ? t(`SOS recorded for ${sos.patientName}`, `${sos.patientName} के लिए SOS दर्ज`)
            : t('SOS recorded', 'SOS दर्ज')
        }
        sub={t(
          'This is the record of what this app attempted, recipient by recipient. Nothing below is a claim that help is on its way.',
          'यह उसका रिकॉर्ड है जो इस ऐप ने करने की कोशिश की, एक-एक प्राप्तकर्ता के लिए। नीचे कुछ भी यह दावा नहीं करता कि मदद रवाना हो चुकी है।',
        )}
        action={
          <Btn variant="outline" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('Back', 'वापस')}
          </Btn>
        }
      />

      <Card tone={isLiveSos(sos) ? 'siren' : 'seal'} className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <SosStatus status={sos.status} hi={hi} />
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
            {timeStamp(sos.createdAt, hi)} · {timeAgo(sos.createdAt, hi)}
          </span>
        </div>

        {sos.category ? <h3 className="display-md mt-4 text-2xl">{sos.category}</h3> : null}

        {sos.symptoms ? (
          <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink">{sos.symptoms}</p>
        ) : null}

        <div className="mt-6 grid gap-5 border-t border-rule pt-6 sm:grid-cols-2">
          <div>
            <Eyebrow>{t('Call back on', 'इस नंबर पर कॉल करें')}</Eyebrow>
            {sos.contactPhone ? (
              <a
                href={telHref(sos.contactPhone)}
                className="mt-1.5 inline-flex items-center gap-2 font-mono text-[1rem] text-seal hover:underline"
              >
                <Phone size={14} aria-hidden="true" />
                {sos.contactPhone}
              </a>
            ) : (
              <p className="mt-1.5 text-ink-faint">—</p>
            )}
          </div>
          {sos.locationNote ? (
            <div>
              <Eyebrow>{t('Where to find them', 'कहाँ मिलेंगे')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink">{sos.locationNote}</p>
            </div>
          ) : null}
          {sos.acknowledgedAt ? (
            <div>
              <Eyebrow>{t('Picked up', 'देखा गया')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">
                {timeStamp(sos.acknowledgedAt, hi)}
              </p>
            </div>
          ) : null}
          {sos.outcome ? (
            <div>
              <Eyebrow>{t('Outcome', 'नतीजा')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink">{sos.outcome}</p>
            </div>
          ) : null}
        </div>
      </Card>

      {/* The one sentence the old version of this page never printed. */}
      <Card tone="amber" className="flex items-start gap-4 p-6">
        <Siren size={20} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
        <div className="min-w-0">
          <Eyebrow>{t('What this app did not do', 'यह ऐप क्या नहीं करता')}</Eyebrow>
          <p className="mt-2.5 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
            {t(
              'No ambulance has been called and no hospital has been told to expect anybody. This app cannot do either. 108 is the ambulance service — if one is needed, somebody has to ring it.',
              'कोई एम्बुलेंस नहीं बुलाई गई है और किसी अस्पताल को किसी के आने की सूचना नहीं दी गई है। यह ऐप ये दोनों काम नहीं कर सकता। एम्बुलेंस सेवा 108 है — ज़रूरत हो तो किसी को उस पर कॉल करना होगा।',
            )}
          </p>
          <Btn as="a" href="tel:108" variant="siren" className="mt-5">
            <Phone size={17} aria-hidden="true" />
            {t('Call 108 now', 'अभी 108 पर कॉल करें')}
          </Btn>
        </div>
      </Card>

      {/* The server's own summary. It names every reason nothing was
          sent, and it is the sentence to trust over anything else here. */}
      <ServerNote>{payload.note}</ServerNote>

      {/* Only rendered when the server confirmed both a worker and the
          alert row written into her queue. When it did not, ashaNote
          below says why, and no worker is named. */}
      {payload.alertedAsha ? (
        <Card tone="asha" className="p-6">
          <Eyebrow>{t('This worker has the alert', 'यह कार्यकर्ता को अलर्ट मिला है')}</Eyebrow>
          <p className="mt-3 text-[1.05rem] font-semibold text-ink">
            {payload.alertedAsha.fullName || t('Name not on record', 'नाम दर्ज नहीं')}
          </p>
          <p className="mt-1 font-mono text-[0.72rem] uppercase tracking-[0.1em] text-ink-faint">
            {[payload.alertedAsha.ashaCode, payload.alertedAsha.subCentre]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
          {payload.alertedAsha.phone ? (
            <Btn as="a" href={telHref(payload.alertedAsha.phone)} variant="asha" className="mt-5">
              <Phone size={17} aria-hidden="true" />
              {payload.alertedAsha.phone}
            </Btn>
          ) : (
            <p className="mt-4 text-[0.85rem] leading-relaxed text-ink-soft">
              {t(
                'There is no phone number on record for her, so she can only be reached through the portal.',
                'उनका कोई फ़ोन नंबर दर्ज नहीं है, इसलिए उन तक केवल पोर्टल से पहुँचा जा सकता है।',
              )}
            </p>
          )}
        </Card>
      ) : payload.ashaNote ? (
        <Card tone="amber" className="flex items-start gap-4 p-6">
          <Users size={19} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
          <div className="min-w-0">
            <Eyebrow>{t('No worker was alerted', 'किसी कार्यकर्ता को अलर्ट नहीं गया')}</Eyebrow>
            <p className="mt-2.5 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
              {payload.ashaNote}
            </p>
          </div>
        </Card>
      ) : null}

      {/* Recipient by recipient. */}
      <Card className="p-6 sm:p-8">
        <Eyebrow>{t('Everyone this reached, and everyone it did not', 'यह किन तक पहुँचा और किन तक नहीं')}</Eyebrow>
        <DeliveryReport deliveries={deliveries} hi={hi} className="mt-5" />
      </Card>

      {/* Location and the hospital snapshot. */}
      <Card className="p-6 sm:p-8">
        <Eyebrow>{t('Location and nearest hospitals', 'जगह और नज़दीकी अस्पताल')}</Eyebrow>

        {locationShared && sos.latitude !== null && sos.latitude !== undefined ? (
          <div className="mt-4">
            <p className="font-mono text-[0.95rem] text-ink">
              {Number(sos.latitude).toFixed(5)}, {Number(sos.longitude).toFixed(5)}
            </p>
            {sos.accuracyM ? (
              <InferenceNote className="mt-3 max-w-xl">
                {t(
                  `The phone reported this to about ${Math.round(sos.accuracyM)} m, so treat the distances below as close rather than exact.`,
                  `फ़ोन ने इसे लगभग ${Math.round(sos.accuracyM)} मीटर तक सही बताया, इसलिए नीचे की दूरियाँ लगभग मानें।`,
                )}
              </InferenceNote>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3">
            <MapPinOff size={18} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <p className="min-w-0 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
              {payload.hospitalsNote ||
                t(
                  'No location was shared with this SOS, so no hospital list could be produced and none was guessed from the village.',
                  'इस SOS के साथ कोई जगह साझा नहीं हुई, इसलिए अस्पतालों की सूची नहीं बन सकी और गाँव से कोई अनुमान भी नहीं लगाया गया।',
                )}
            </p>
          </div>
        )}

        {hospitals.length > 0 ? (
          <>
            <ul className="mt-6 border-t border-rule pt-5">
              {hospitals.map((h, i) => (
                <HospitalRow
                  key={h.id ?? h.facilityId ?? i}
                  hospital={h}
                  index={String(i + 1).padStart(2, '0')}
                  t={t}
                />
              ))}
            </ul>
            <p className="mt-5 text-[0.85rem] leading-relaxed text-ink-faint">
              {t(
                'This list was frozen when the SOS was raised, so it is what was on record at the time rather than a fresh search. It covers PM-JAY empanelled hospitals only — a good hospital nearby may simply never have joined the scheme.',
                'यह सूची SOS दर्ज होते समय की है, इसलिए यह उस समय का रिकॉर्ड है, नई खोज नहीं। इसमें केवल पीएम-जय में सूचीबद्ध अस्पताल हैं — पास का अच्छा अस्पताल शायद इस योजना में शामिल ही न हुआ हो।',
              )}
            </p>
          </>
        ) : locationShared && payload.hospitalsNote ? (
          <p className="mt-5 max-w-2xl border-t border-rule pt-5 text-[0.9rem] leading-relaxed text-ink-soft">
            {payload.hospitalsNote}
          </p>
        ) : null}
      </Card>

      {/* Closing it off. */}
      {isLiveSos(sos) ? (
        <Card className="p-6 sm:p-8">
          <ResolveForm sos={sos} t={t} hi={hi} onResolved={onResolved} />
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Btn variant="outline" onClick={onAgain}>
          <Siren size={16} aria-hidden="true" />
          {t('Raise another SOS', 'दूसरा SOS दर्ज करें')}
        </Btn>
        <Btn as={Link} href="/emergency-contacts" variant="outline">
          <Users size={16} aria-hidden="true" />
          {t('Emergency contacts', 'आपातकालीन संपर्क')}
        </Btn>
      </div>
    </div>
  );
}

/* =============================================================
   The page
   ============================================================= */

export function Emergency() {
  const { profile, isAuthenticated, language } = useAuth();
  const t = getT(language);
  const hi = t.isHindi;

  /* ---- 'form' | 'sent' | 'detail' ----------------------------- */
  const [view, setView] = useState('form');
  const [result, setResult] = useState(null);
  const [openId, setOpenId] = useState(null);

  /* ---- The form ------------------------------------------------ */
  const [form, setForm] = useState({
    patientName: '',
    contactPhone: '',
    category: '',
    symptoms: '',
    notes: '',
  });
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // Seeded once, from the profile, and only into boxes that are still
  // empty — an emergency raised for a mother or a neighbour has to be
  // able to type straight over this, and anything typed before the
  // profile arrives must survive it.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    setForm((prev) => ({
      ...prev,
      patientName: prev.patientName || profile.full_name || '',
      contactPhone: prev.contactPhone || profile.phone || '',
    }));
  }, [profile]);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  /* ---- Location ----------------------------------------------- */
  // 'idle' | 'locating' | 'ok' | 'denied' | 'timeout' | 'unsupported' | 'failed'
  const [geo, setGeo] = useState('idle');
  const [coords, setCoords] = useState(null);

  function requestLocation() {
    if (!navigator.geolocation) {
      setGeo('unsupported');
      return;
    }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        });
        setGeo('ok');
      },
      (err) => {
        // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        setGeo(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'failed');
        // No coordinate is invented. The SOS still goes, and the report
        // will say plainly that no hospital list could be produced.
        setCoords(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  /* ---- What the SOS can actually reach ------------------------- */
  // Asked before anything happens. Learning that SMS is unconfigured is
  // worth a great deal while somebody is calm and nothing at all in the
  // middle of an emergency.
  const config = useAsync(() => getSosConfig(), [], { skip: !isAuthenticated });
  const cfg = config.data;

  const history = useAsync(() => getMySosBroadcasts(), [], {
    skip: !isAuthenticated || view !== 'form',
  });
  const past = history.data?.sos ?? [];

  const detail = useAsync(() => getSos(openId), [openId], {
    skip: view !== 'detail' || !openId,
  });

  /* ---- Sending ------------------------------------------------- */
  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    setSendError(null);
    setSending(true);
    try {
      const payload = {
        patientName: form.patientName.trim(),
        contactPhone: form.contactPhone.trim(),
        category: form.category,
        symptoms: form.symptoms.trim(),
      };
      if (form.notes.trim()) payload.notes = form.notes.trim();
      // Sent only as a pair; the server refuses one without the other,
      // because half a coordinate is not a location.
      if (coords) {
        payload.latitude = coords.lat;
        payload.longitude = coords.lng;
      }

      const res = await broadcastSos(payload);
      setResult(res);
      setView('sent');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  function backToForm() {
    setView('form');
    setOpenId(null);
    setResult(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function raiseAnother() {
    setForm((prev) => ({ ...prev, category: '', symptoms: '', notes: '' }));
    backToForm();
  }

  function openPast(id) {
    setOpenId(id);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const geoMessage = {
    denied: t(
      'Location permission was refused. The SOS still works — it will carry no hospital list, and nothing will be guessed from your village.',
      'जगह की अनुमति नहीं मिली। SOS फिर भी काम करेगा — उसमें अस्पतालों की सूची नहीं होगी, और आपके गाँव से कोई अनुमान नहीं लगाया जाएगा।',
    ),
    timeout: t(
      'Your phone did not return a location in time. Send the SOS anyway — it will simply carry no hospital list.',
      'आपके फ़ोन से समय पर जगह नहीं मिली। SOS फिर भी भेजें — उसमें बस अस्पतालों की सूची नहीं होगी।',
    ),
    unsupported: t(
      'This browser does not provide a location, so no hospital list can be attached.',
      'यह ब्राउज़र जगह नहीं देता, इसलिए अस्पतालों की सूची नहीं जोड़ी जा सकती।',
    ),
    failed: t(
      'Your phone could not provide a location just now. Send the SOS anyway.',
      'अभी आपके फ़ोन से जगह नहीं मिल सकी। SOS फिर भी भेजें।',
    ),
  }[geo];

  const showReport = view === 'sent' || view === 'detail';

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-8 sm:pt-12 ${hi ? 'is-deva' : ''}`}>
      {/* ================= Head ================= */}
      <header className="border-b border-rule pb-10">
        <Eyebrow>{t('Register · Emergency', 'रजिस्टर · आपातकाल')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-3xl">
          {t('Emergency help', 'आपातकालीन मदद')}
        </h1>
        <p className="lede mt-5 max-w-2xl">
          {t(
            'Call 108 first. It reaches the state ambulance service from the phone itself and does not need this app, this account or a working internet connection. The SOS below is what this app can add: a critical alert in the queue of the ASHA worker covering your village, and a text message to the family numbers you have saved.',
            'पहले 108 पर कॉल करें। वह फ़ोन से ही राज्य की एम्बुलेंस सेवा तक जाता है और उसे इस ऐप, इस खाते या इंटरनेट की ज़रूरत नहीं। नीचे का SOS वह है जो यह ऐप और कर सकता है: आपके गाँव की आशा कार्यकर्ता की सूची में एक अत्यावश्यक अलर्ट, और आपके सहेजे परिवार के नंबरों पर एसएमएस।',
          )}
        </p>
      </header>

      {/* ================= 01 · Call now ================= */}
      <section className="mt-10">
        <RegRule index="01" label={t('Call now', 'अभी कॉल करें')} />

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <a
            href="tel:108"
            data-testid="btn-call-108"
            className="card card-rail flex min-h-[6.5rem] flex-col justify-center gap-1 p-6 transition-transform active:translate-y-px"
            style={{ '--rail': 'var(--color-siren)' }}
          >
            <span className="flex items-center gap-2.5 text-[1.4rem] font-bold text-siren">
              <Phone size={22} strokeWidth={2.4} aria-hidden="true" />
              108
            </span>
            <span className="text-[0.9rem] leading-relaxed text-ink-soft">
              {t('Ambulance, free of charge, day or night', 'एम्बुलेंस, नि:शुल्क, दिन हो या रात')}
            </span>
          </a>

          <a
            href="tel:112"
            data-testid="btn-call-112"
            className="card card-rail flex min-h-[6.5rem] flex-col justify-center gap-1 p-6 transition-transform active:translate-y-px"
            style={{ '--rail': 'var(--color-siren)' }}
          >
            <span className="flex items-center gap-2.5 text-[1.4rem] font-bold text-siren">
              <Phone size={22} strokeWidth={2.4} aria-hidden="true" />
              112
            </span>
            <span className="text-[0.9rem] leading-relaxed text-ink-soft">
              {t('Every emergency: police, fire, ambulance', 'हर आपातकाल: पुलिस, आग, एम्बुलेंस')}
            </span>
          </a>
        </div>

        <p className="mt-4 text-[0.85rem] leading-relaxed text-ink-faint">
          {t(
            'These two are dialled by your phone, not by this app. They work when everything on this page fails.',
            'ये दोनों नंबर आपका फ़ोन मिलाता है, यह ऐप नहीं। इस पन्ने का सब कुछ नाकाम हो जाए, तब भी ये काम करते हैं।',
          )}
        </p>
      </section>

      {/* ================= The report, when there is one ================= */}
      {showReport ? (
        <section className="mt-14">
          {view === 'sent' ? (
            <SosReport
              payload={result}
              t={t}
              hi={hi}
              onBack={backToForm}
              onAgain={raiseAnother}
              onResolved={(sos) => setResult((prev) => ({ ...prev, sos }))}
            />
          ) : detail.loading ? (
            <LoadingState label={t('Opening the record', 'रिकॉर्ड खुल रहा है')} rows={3} />
          ) : detail.error ? (
            <ErrorState
              title={t('That record did not open', 'वह रिकॉर्ड नहीं खुला')}
              body={detail.error.message}
              onRetry={detail.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          ) : (
            <SosReport
              payload={detail.data}
              t={t}
              hi={hi}
              onBack={backToForm}
              onAgain={raiseAnother}
              onResolved={(sos) => detail.setData((prev) => ({ ...prev, sos }))}
            />
          )}
        </section>
      ) : !isAuthenticated ? (
        /* ============ Signed out ============ */
        <section className="mt-14">
          <EmptyState
            stamp={false}
            title={t('Sign in to raise an SOS', 'SOS दर्ज करने के लिए साइन इन करें')}
            body={t(
              'An SOS goes to the ASHA worker covering your village and to the family numbers on your account, so it needs an account to go from. The two numbers above need nothing at all.',
              'SOS आपके गाँव की आशा कार्यकर्ता और आपके खाते में सहेजे परिवार के नंबरों तक जाता है, इसलिए इसके लिए खाता ज़रूरी है। ऊपर के दो नंबरों के लिए कुछ भी ज़रूरी नहीं।',
            )}
            action={
              <Btn as={Link} href="/onboarding" variant="primary">
                {t('Sign in', 'साइन इन करें')}
              </Btn>
            }
          />
        </section>
      ) : (
        <>
          {/* ================= 02 · Who this reaches ================= */}
          <section className="mt-14">
            <SectionHead
              index="02"
              eyebrow={t('Before you need it', 'ज़रूरत पड़ने से पहले')}
              title={t('Who an SOS actually reaches', 'SOS असल में किन तक पहुँचता है')}
              action={
                <Btn as={Link} href="/emergency-contacts" variant="outline">
                  <Users size={16} aria-hidden="true" />
                  {t('Emergency contacts', 'आपातकालीन संपर्क')}
                  <ChevronRight size={15} aria-hidden="true" />
                </Btn>
              }
            />

            {config.loading ? (
              <LoadingState
                className="mt-8"
                label={t('Checking what is configured', 'जाँच रहे हैं क्या-क्या तैयार है')}
                rows={1}
              />
            ) : config.error ? (
              <ErrorState
                className="mt-8"
                title={t('Could not check the SOS setup', 'SOS की तैयारी जाँची नहीं जा सकी')}
                body={config.error.message}
                onRetry={config.reload}
                retryLabel={t('Try again', 'फिर कोशिश करें')}
              />
            ) : cfg ? (
              <div className="mt-8 space-y-4">
                <Card className="p-6 sm:p-8">
                  <div className="grid gap-7 sm:grid-cols-2">
                    <div>
                      <Eyebrow>{t('In the portal', 'पोर्टल में')}</Eyebrow>
                      <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-soft">
                        {t(
                          'The ASHA worker covering your village gets a critical alert in her queue. This does not use SMS and works even when text messages cannot be sent.',
                          'आपके गाँव की आशा कार्यकर्ता की सूची में एक अत्यावश्यक अलर्ट जाता है। इसमें एसएमएस नहीं लगता, इसलिए यह तब भी काम करता है जब संदेश न भेजे जा सकें।',
                        )}
                      </p>
                    </div>

                    <div>
                      <Eyebrow>{t('By text message', 'एसएमएस से')}</Eyebrow>
                      <p className="mt-2.5 font-mono text-[0.95rem] text-ink">
                        {t(
                          `${cfg.smsContactCount} of ${cfg.contactCount} saved contact(s)`,
                          `सहेजे ${cfg.contactCount} संपर्कों में से ${cfg.smsContactCount}`,
                        )}
                      </p>
                      {cfg.smsContactCount === 0 ? (
                        <p className="mt-2.5 text-[0.95rem] font-semibold leading-relaxed text-siren">
                          {t(
                            'An SOS would text nobody in your family. Add at least one number.',
                            'SOS आपके परिवार में किसी को भी संदेश नहीं भेजेगा। कम से कम एक नंबर जोड़ें।',
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Card>

                {/* The server's own warning, verbatim. It is the only
                    thing that knows whether a message can leave at all. */}
                {cfg.warning ? (
                  <Card tone="amber" className="flex items-start gap-4 p-6">
                    <Info size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
                    <p className="min-w-0 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
                      {cfg.warning}
                    </p>
                  </Card>
                ) : null}

                <ServerNote>{cfg.note}</ServerNote>
              </div>
            ) : null}
          </section>

          {/* ================= 03 · The SOS form ================= */}
          <section className="mt-14">
            <SectionHead
              index="03"
              eyebrow={t('Raise it', 'दर्ज करें')}
              title={t('Broadcast an emergency SOS', 'आपातकालीन SOS भेजें')}
              sub={t(
                'Four things, then one button. Fill in as much as you can and send it — a short description now is better than a complete one in five minutes.',
                'चार बातें, फिर एक बटन। जितना बता सकें भरें और भेज दें — अभी का छोटा विवरण पाँच मिनट बाद के पूरे विवरण से बेहतर है।',
              )}
            />

            <Card tone="siren" className="mt-8 p-6 sm:p-9">
              <form onSubmit={submit} className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label={t('Patient Name', 'मरीज़ का नाम')} required>
                    <input
                      type="text"
                      value={form.patientName}
                      onChange={set('patientName')}
                      required
                      autoComplete="name"
                      className="field mt-2 w-full"
                      data-testid="input-patient-name"
                    />
                  </Field>

                  <Field
                    label={t('Contact Phone Number', 'संपर्क मोबाइल नंबर')}
                    hint={t(
                      'The number the ASHA worker will ring back on.',
                      'इसी नंबर पर आशा कार्यकर्ता वापस कॉल करेंगी।',
                    )}
                    required
                  >
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.contactPhone}
                      onChange={set('contactPhone')}
                      required
                      autoComplete="tel"
                      className="field mt-2 w-full"
                      data-testid="input-contact-phone"
                    />
                  </Field>
                </div>

                <Field label={t('Emergency Category', 'आपातकाल का प्रकार')} required>
                  <select
                    value={form.category}
                    onChange={set('category')}
                    required
                    className="field mt-2 w-full"
                    data-testid="select-emergency-category"
                  >
                    <option value="">{t('Choose one', 'एक चुनें')}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {hi ? c.hi : c.value}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label={t('Symptoms & Patient Condition', 'लक्षण और मरीज़ की हालत')}
                  hint={t(
                    'A few words are enough. This is what the worker reads first.',
                    'कुछ शब्द ही काफ़ी हैं। कार्यकर्ता सबसे पहले यही पढ़ती हैं।',
                  )}
                  required
                >
                  <textarea
                    value={form.symptoms}
                    onChange={set('symptoms')}
                    required
                    rows={3}
                    className="field mt-2 w-full resize-y py-3"
                    data-testid="input-symptoms"
                  />
                </Field>

                <Field
                  label={t('Where to find you', 'आप कहाँ मिलेंगे')}
                  hint={t(
                    'Optional. A landmark someone can find without asking — “by the school, blue gate”.',
                    'ज़रूरी नहीं। कोई पहचान की जगह जो पूछे बिना मिल जाए — “स्कूल के पास, नीला गेट”।',
                  )}
                >
                  <input
                    type="text"
                    value={form.notes}
                    onChange={set('notes')}
                    className="field mt-2 w-full"
                  />
                </Field>

                {/* Location. Offered rather than taken, and the SOS goes
                    without it — the report simply says no hospital list
                    could be produced instead of naming a wrong one. */}
                <div className="border-t border-rule pt-6">
                  <Eyebrow>{t('Your location', 'आपकी जगह')}</Eyebrow>
                  <p className="mt-2 max-w-2xl text-[0.85rem] leading-relaxed text-ink-soft">
                    {t(
                      'Sharing it attaches the five nearest PM-JAY hospitals to this SOS and puts your coordinates in front of the worker. Without it neither is possible, and the village centre is deliberately not used instead.',
                      'इसे साझा करने पर इस SOS के साथ पाँच नज़दीकी पीएम-जय अस्पताल जुड़ जाते हैं और आपके निर्देशांक कार्यकर्ता के सामने आ जाते हैं। इसके बिना दोनों संभव नहीं, और गाँव के केंद्र का इस्तेमाल जानबूझकर नहीं किया जाता।',
                    )}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <Btn
                      type="button"
                      variant="outline"
                      onClick={requestLocation}
                      disabled={geo === 'locating'}
                    >
                      {geo === 'locating' ? (
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Crosshair size={16} aria-hidden="true" />
                      )}
                      {geo === 'ok'
                        ? t('Update my location', 'मेरी जगह बदलें')
                        : t('Share my location', 'मेरी जगह साझा करें')}
                    </Btn>

                    {geo === 'ok' && coords ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Stamp kind="verified" label={t('Location attached', 'जगह जुड़ गई')} />
                        <span className="font-mono text-[0.78rem] text-ink-faint">
                          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                          {coords.accuracy ? ` · ±${Math.round(coords.accuracy)} m` : ''}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {geoMessage ? (
                    <p className="mt-3 max-w-2xl text-[0.85rem] leading-relaxed text-amber">
                      {geoMessage}
                    </p>
                  ) : null}
                </div>

                {sendError ? (
                  <Card tone="siren" className="p-5" role="alert">
                    <Eyebrow>{t('Not sent', 'नहीं भेजा गया')}</Eyebrow>
                    <p className="mt-2 text-[0.9rem] leading-relaxed text-ink">{sendError}</p>
                    <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
                      {t(
                        'Nothing was broadcast. If this is urgent, call 108 now rather than trying again.',
                        'कुछ भी नहीं भेजा गया। अगर बात ज़रूरी है तो दोबारा कोशिश करने के बजाय अभी 108 पर कॉल करें।',
                      )}
                    </p>
                  </Card>
                ) : null}

                <Btn
                  type="submit"
                  variant="siren"
                  size="lg"
                  className="w-full"
                  disabled={sending}
                  data-testid="btn-submit-emergency-sos"
                >
                  {sending ? (
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Siren size={18} aria-hidden="true" />
                  )}
                  {sending
                    ? t('Broadcasting…', 'भेजा जा रहा है…')
                    : t('Broadcast Emergency SOS Alert', 'आपातकालीन SOS अलर्ट भेजें')}
                </Btn>

                <p className="text-center text-[0.8rem] leading-relaxed text-ink-faint">
                  {t(
                    'The next screen lists every intended recipient and what happened to each one.',
                    'अगली स्क्रीन पर हर इच्छित प्राप्तकर्ता और उनके साथ क्या हुआ, दोनों दर्ज होंगे।',
                  )}
                </p>
              </form>
            </Card>
          </section>

          {/* ================= 04 · Past broadcasts ================= */}
          <section className="mt-14">
            <SectionHead
              index="04"
              eyebrow={t('On record', 'रिकॉर्ड में')}
              title={t('Emergencies you have raised', 'आपके दर्ज किए आपातकाल')}
            />

            {history.loading ? (
              <LoadingState className="mt-8" label={t('Loading', 'लोड हो रहा है')} rows={2} />
            ) : history.error ? (
              <ErrorState
                className="mt-8"
                title={t('Could not load your history', 'आपका रिकॉर्ड लोड नहीं हुआ')}
                body={history.error.message}
                onRetry={history.reload}
                retryLabel={t('Try again', 'फिर कोशिश करें')}
              />
            ) : past.length === 0 ? (
              <EmptyState
                className="mt-8"
                title={t('You have not raised an SOS', 'आपने कोई SOS दर्ज नहीं किया')}
                body={t(
                  'Nothing has been broadcast from this account. When something is, every recipient and every outcome appears here.',
                  'इस खाते से कुछ नहीं भेजा गया। जब भेजा जाएगा, तब हर प्राप्तकर्ता और हर नतीजा यहाँ दिखेगा।',
                )}
              />
            ) : (
              <ul className="mt-8 space-y-3">
                {past.map((row, i) => {
                  const sms = (row.deliveries ?? []).filter((d) => d.channel === 'sms');
                  const accepted = sms.filter((d) => d.status === 'sent').length;
                  return (
                    <li key={row.id}>
                      <Card
                        as="button"
                        type="button"
                        tone={isLiveSos(row) ? 'siren' : 'neutral'}
                        lift
                        onClick={() => openPast(row.id)}
                        className="w-full p-5 text-left"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="reg-index">{String(i + 1).padStart(2, '0')}</span>
                              <SosStatus status={row.status} hi={hi} />
                              <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                                {timeAgo(row.createdAt, hi)}
                              </span>
                            </div>
                            <p className="mt-3 text-[1rem] font-semibold leading-snug text-ink">
                              {row.patientName || t('No name recorded', 'नाम दर्ज नहीं')}
                            </p>
                            {row.category ? (
                              <p className="mt-1 text-[0.9rem] text-ink-soft">{row.category}</p>
                            ) : null}
                            <p className="mt-2.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
                              {t(
                                `${accepted} of ${sms.length} text(s) accepted`,
                                `${sms.length} में से ${accepted} एसएमएस स्वीकृत`,
                              )}
                            </p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1.5 text-[0.85rem] font-semibold text-seal">
                            {t('Open the record', 'रिकॉर्ड खोलें')}
                            <ChevronRight size={15} aria-hidden="true" />
                          </span>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ================= First aid ================= */}
      <section className="mt-16">
        <SectionHead
          index="05"
          eyebrow={t('While you wait', 'इंतज़ार के दौरान')}
          title={t('First aid until help arrives', 'मदद आने तक प्राथमिक उपचार')}
        />

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card className="p-6">
            <Eyebrow>{t('Chest pain or breathlessness', 'सीने में दर्द या साँस फूलना')}</Eyebrow>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
              {t(
                'Sit them upright, loosen tight clothing and let air in. Do not give food or a large drink. Do not let them walk to the vehicle if it can be brought to them.',
                'उन्हें सीधा बैठाएँ, तंग कपड़े ढीले करें और हवा आने दें। खाना या ज़्यादा पानी न दें। अगर गाड़ी उनके पास लाई जा सके तो उन्हें चलकर जाने न दें।',
              )}
            </p>
          </Card>

          <Card className="p-6">
            <Eyebrow>{t('Heavy bleeding', 'तेज़ रक्तस्राव')}</Eyebrow>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
              {t(
                'Press hard on the wound with the cleanest cloth to hand and keep pressing — do not lift it to look. Raise the legs if they feel faint.',
                'जो सबसे साफ़ कपड़ा मिले उससे घाव पर ज़ोर से दबाएँ और दबाए रखें — देखने के लिए हटाएँ नहीं। कमज़ोरी लगे तो पैर ऊपर उठाएँ।',
              )}
            </p>
          </Card>
        </div>

        <InferenceNote className="mt-6 max-w-2xl">
          {t(
            'General first-aid guidance, not advice about this patient. Nobody here has seen them. Follow what the 108 operator tells you over anything on this page.',
            'यह आम प्राथमिक उपचार की जानकारी है, इस मरीज़ के बारे में सलाह नहीं। यहाँ किसी ने उन्हें देखा नहीं है। इस पन्ने की किसी भी बात से पहले 108 ऑपरेटर की बात मानें।',
          )}
        </InferenceNote>
      </section>
    </main>
  );
}
