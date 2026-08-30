import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  MessagesSquare,
  Radio,
  RotateCw,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  broadcastNotification,
  getSentNotifications,
  deleteSentNotification,
} from '@/services/platform';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Figure,
  Pill,
  SectionHead,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /asha/broadcast — one notice to a whole village.

   Two rules shape this screen.

   The first is that no number on it is guessed. A broadcast's
   recipient count is only knowable after the fan-out has run, so
   before sending this page states the audience in words — who will
   get it and why — and says plainly that the count will be reported
   afterwards by the server. Nothing here estimates "about 200
   people".

   The second is that a broadcast is stored `verification =
   'unverified'`, because nothing checks what is typed into it. The
   worker is told that before she sends, so she knows her villagers
   will see it presented as her advice rather than as a government
   record. The endpoint refuses a `verification` field outright; this
   form does not have one to send.
   ============================================================= */

const SEND_PAGE_SIZE = 20; // at or below the server's read-count ceiling, so readCount comes back

/** Written to cover what a worker actually broadcasts. */
const CATEGORIES = [
  { value: 'health_advice', en: 'Healthcare advice', hi: 'स्वास्थ्य सलाह' },
  { value: 'new_scheme', en: 'A new scheme', hi: 'नई योजना' },
  { value: 'eligibility', en: 'Eligibility news', hi: 'पात्रता की जानकारी' },
  { value: 'camp', en: 'A health camp', hi: 'स्वास्थ्य शिविर' },
  { value: 'general', en: 'General notice', hi: 'सामान्य सूचना' },
];

const SEVERITIES = [
  { value: 'low', en: 'Routine', hi: 'सामान्य', tone: 'neutral' },
  { value: 'moderate', en: 'Worth reading', hi: 'ध्यान देने योग्य', tone: 'seal' },
  { value: 'high', en: 'Important', hi: 'ज़रूरी', tone: 'amber' },
  { value: 'critical', en: 'Urgent', hi: 'अति आवश्यक', tone: 'siren' },
];

function whenText(iso, deva) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(deva ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function villageLabel(village) {
  if (!village) return null;
  return [village.name, village.block, village.district].filter(Boolean).join(' · ');
}

/** The server's own sentence, printed as it arrived. */
function ServerNote({ tone, icon: Icon = Info, children }) {
  if (!children) return null;
  return (
    <Card tone={tone} className="flex items-start gap-3 p-5">
      <Icon size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

function Field({ label, hint, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="eyebrow block">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-faint">{hint}</p> : null}
    </div>
  );
}

function Choice({ options, value, onChange, name, deva }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.875rem] font-semibold transition-colors ${
              on
                ? 'border-ink bg-ink text-paper'
                : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {deva ? option.hi : option.en}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------
   What the server said happened.
   ------------------------------------------------------------- */

function SendResult({ result, t, deva, villageNameOf }) {
  if (!result) return null;

  const count = Number(result.recipientCount ?? 0);
  const rows = result.notifications ?? [];

  return (
    <div className="space-y-4">
      <Card tone={count > 0 ? 'asha' : 'amber'} className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Check size={18} className="text-asha" aria-hidden="true" />
          <Eyebrow>{t('Saved by the server', 'सर्वर पर दर्ज')}</Eyebrow>
        </div>

        {/* The count is the server's own figure for how many recipient
            rows it wrote. It is reported, never rounded and never
            described as "delivered" — a recipient row means the notice
            is in that person's feed, not that she has seen it. */}
        <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
          {count === 1
            ? t(
                'It was placed in 1 person’s notice list.',
                'यह 1 व्यक्ति की सूचना सूची में रखी गई।',
              )
            : t(
                `It was placed in the notice lists of ${count} people.`,
                `यह ${count} लोगों की सूचना सूची में रखी गई।`,
              )}
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Figure
            value={count}
            label={t('Recipients recorded', 'दर्ज प्राप्तकर्ता')}
            tone={count > 0 ? 'asha' : 'amber'}
          />
          <Figure
            value={rows.length}
            label={t('Notices created', 'बनी सूचनाएँ')}
            hint={
              rows.length > 1
                ? t('One per village', 'हर गाँव के लिए एक')
                : undefined
            }
          />
        </div>
      </Card>

      {result.note ? <ServerNote tone="amber">{result.note}</ServerNote> : null}
      {result.warning ? (
        <ServerNote tone="siren" icon={AlertTriangle}>
          {result.warning}
        </ServerNote>
      ) : null}

      {rows.length > 0 ? (
        <Card className="p-5">
          <Eyebrow>{t('What was created', 'क्या बना')}</Eyebrow>
          <ul className="mt-3 space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="border-t border-rule-soft pt-3 first:border-0 first:pt-0">
                <p className="text-[0.95rem] font-semibold text-ink">{row.title}</p>
                <p className="mt-1 text-[0.85rem] text-ink-faint">
                  {villageNameOf(row.villageId) ||
                    t('One person', 'एक व्यक्ति')}
                  {' · '}
                  {row.recipientCount === 1
                    ? t('1 recipient', '1 प्राप्तकर्ता')
                    : t(`${row.recipientCount} recipients`, `${row.recipientCount} प्राप्तकर्ता`)}
                  {' · '}
                  {whenText(row.sentAt, deva)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------
   The register of what she has already sent.
   ------------------------------------------------------------- */

function SentList({ list, t, deva, onDelete, deletingId, deleteError }) {
  if (list.loading) {
    return <LoadingState label={t('Loading what you have sent', 'भेजी गई सूचनाएँ लोड हो रही हैं')} rows={2} />;
  }
  if (list.error) {
    return (
      <ErrorState
        title={t('This list did not load', 'यह सूची लोड नहीं हुई')}
        body={list.error.message}
        onRetry={list.reload}
        retryLabel={t('Try again', 'फिर कोशिश करें')}
      />
    );
  }

  const rows = list.data?.notifications ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('Nothing sent yet', 'अभी कुछ नहीं भेजा')}
        body={
          list.data?.note ||
          t('Everything you broadcast will be listed here.', 'आप जो भी भेजेंगी वह यहाँ सूचीबद्ध होगा।')
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {list.data?.note ? <ServerNote>{list.data.note}</ServerNote> : null}
      {deleteError ? (
        <ServerNote tone="siren" icon={AlertTriangle}>
          {deleteError}
        </ServerNote>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row, i) => {
          const severity = SEVERITIES.find((s) => s.value === row.severity);
          const category = CATEGORIES.find((c) => c.value === row.category);

          return (
            <li key={row.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="reg-index">{String(i + 1).padStart(3, '0')}</span>
                  {severity && severity.value !== 'low' ? (
                    <Pill tone={severity.tone}>{deva ? severity.hi : severity.en}</Pill>
                  ) : null}
                  {category ? <Pill>{deva ? category.hi : category.en}</Pill> : null}
                  {row.expired ? <Pill>{t('Expired', 'अवधि समाप्त')}</Pill> : null}
                </div>

                <h3 className="display-md mt-3 text-lg">{row.title}</h3>
                <p className="mt-2 whitespace-pre-line text-[0.9rem] leading-relaxed text-ink-soft">
                  {row.body}
                </p>

                <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
                  <div>
                    <Eyebrow>{t('Sent to', 'किसे भेजा')}</Eyebrow>
                    <p className="mt-1.5 text-[0.9rem] text-ink">
                      {villageLabel(row.village) ||
                        (row.targetUserId
                          ? t('One person', 'एक व्यक्ति')
                          : t('Not recorded', 'दर्ज नहीं'))}
                    </p>
                  </div>
                  <div>
                    <Eyebrow>{t('Recipients', 'प्राप्तकर्ता')}</Eyebrow>
                    <p className="figure mt-1.5 text-xl">{row.recipientCount}</p>
                  </div>
                  <div>
                    <Eyebrow>{t('Opened', 'खोला')}</Eyebrow>
                    {/* readCount is absent, not zero, when the server did
                        not compute it. Printing 0 would tell her nobody
                        opened a message she has no data about. */}
                    <p className="mt-1.5 text-[0.9rem] text-ink">
                      {row.readCount === undefined ? (
                        <span className="text-ink-faint">{t('Not counted', 'गिना नहीं गया')}</span>
                      ) : (
                        <span className="figure text-xl">{row.readCount}</span>
                      )}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-[0.8rem] text-ink-faint">
                  {whenText(row.sentAt, deva)}
                  {row.language ? ` · ${row.language}` : ''}
                  {row.source ? ` · ${row.source}` : ''}
                </p>

                <div className="mt-4">
                  <Btn
                    variant="outline"
                    onClick={() => onDelete(row)}
                    disabled={deletingId === row.id}
                  >
                    {deletingId === row.id ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 size={16} aria-hidden="true" />
                    )}
                    {t('Withdraw', 'वापस लें')}
                  </Btn>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AshaBroadcast() {
  const { language, profile } = useAuth();
  const t = getT(language);
  const deva = t.isHindi;

  const villages = useMemo(() => profile?.assignedVillages ?? [], [profile]);
  const hasVillages = villages.length > 0;

  const [audience, setAudience] = useState('village');
  const [villageId, setVillageId] = useState('');
  /* null means "follow the language this portal is in". The worker can
     override it, because a village that reads Hindi does not stop doing
     so when she switches her own interface. */
  const [sendLang, setSendLang] = useState(null);
  const [category, setCategory] = useState('health_advice');
  const [severity, setSeverity] = useState('low');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [result, setResult] = useState(null);

  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const sent = useAsync(() => getSentNotifications({ size: SEND_PAGE_SIZE }), []);

  const effectiveLang = sendLang ?? (deva ? 'Hindi' : 'English');
  const chosenVillage = villages.find((v) => v.id === villageId) ?? null;

  const villageNameOf = (id) => {
    const match = villages.find((v) => v.id === id);
    return match ? match.name || null : null;
  };

  /* Stated in words, from her own assignment. A count would have to be
     invented; the audience does not. */
  const audienceSentence =
    audience === 'all_my_villages'
      ? villages.length === 1
        ? t(
            'Everyone registered on Sehat Sathi in the one village assigned to you.',
            'आपको सौंपे गए एक गाँव में सेहत साथी पर दर्ज हर व्यक्ति।',
          )
        : t(
            `Everyone registered on Sehat Sathi in each of the ${villages.length} villages assigned to you. One notice is created per village, so each record still names a single village.`,
            `आपको सौंपे गए ${villages.length} गाँवों में सेहत साथी पर दर्ज हर व्यक्ति। हर गाँव के लिए एक अलग सूचना बनती है, जिससे हर अभिलेख में एक ही गाँव दर्ज रहे।`,
          )
      : chosenVillage
      ? t(
          `Everyone registered on Sehat Sathi with ${chosenVillage.name} as their village.`,
          `जिनकी सेहत साथी प्रोफ़ाइल में गाँव ${chosenVillage.name} दर्ज है, वे सभी।`,
        )
      : t('Choose a village first.', 'पहले गाँव चुनें।');

  const canSend =
    hasVillages &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === 'all_my_villages' || Boolean(villageId)) &&
    !sending;

  async function submit(event) {
    event.preventDefault();
    if (!canSend) return;

    setSendError(null);
    setResult(null);
    setSending(true);

    const text = { title: title.trim(), body: body.trim() };

    try {
      const payload = {
        audience,
        ...(audience === 'village' ? { villageId } : {}),
        category,
        severity,
        // One language per notification: the table holds a single title,
        // a single body and a single language, and the endpoint refuses a
        // request carrying both pairs rather than storing half of it.
        ...(effectiveLang === 'Hindi'
          ? { titleHi: text.title, bodyHi: text.body }
          : { title: text.title, body: text.body }),
        ...(source.trim() ? { source: source.trim() } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      };

      const response = await broadcastNotification(payload);
      setResult(response);
      setTitle('');
      setBody('');
      setSource('');
      setExpiresAt('');
      sent.reload();
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  }

  async function withdraw(row) {
    setDeleteError(null);
    setDeletingId(row.id);
    try {
      await deleteSentNotification(row.id);
      sent.reload();
    } catch (e) {
      // A 409 here is the server refusing to unsend something people
      // have already read. Its explanation is the whole answer, so it
      // is shown word for word rather than reduced to "failed".
      setDeleteError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AshaShell
      eyebrow={t('Register · Broadcast', 'रजिस्टर · प्रसारण')}
      title={t('Send a notice to your village', 'अपने गाँव को सूचना भेजें')}
      sub={t(
        'Health advice, a new scheme, or news about who is now eligible. It reaches the people registered on Sehat Sathi in the village you name.',
        'स्वास्थ्य सलाह, नई योजना, या किसे अब लाभ मिल सकता है — यह उस गाँव के सेहत साथी पर दर्ज लोगों तक पहुँचती है जिसे आप चुनती हैं।',
      )}
      action={
        <Btn as={Link} href="/asha/messages" variant="outline">
          <MessagesSquare size={17} aria-hidden="true" />
          {t('Conversations', 'बातचीत')}
        </Btn>
      }
    >
      {!hasVillages ? (
        <ServerNote tone="amber" icon={AlertTriangle}>
          {t(
            'No village is mapped to your account, so there is nobody you are authorised to address yet. Ask your block office or an admin to assign your villages, then open this page again.',
            'आपके खाते से कोई गाँव जुड़ा नहीं है, इसलिए अभी आप किसी को सूचना भेजने के लिए अधिकृत नहीं हैं। अपने ब्लॉक कार्यालय या व्यवस्थापक से गाँव जोड़ने को कहें, फिर यह पृष्ठ दोबारा खोलें।',
          )}
        </ServerNote>
      ) : null}

      {/* ================= 01 · Write it ================= */}
      <section>
        <SectionHead
          index="01"
          eyebrow={t('Compose', 'लिखें')}
          title={t('What do you want to tell them?', 'आप उन्हें क्या बताना चाहती हैं?')}
        />

        <form onSubmit={submit} className="mt-6 space-y-7">
          <Card className="space-y-7 p-5 sm:p-7">
            <Field
              label={t('Who should receive it', 'किसे मिलनी चाहिए')}
              htmlFor="broadcast-village"
              hint={audienceSentence}
            >
              <div className="space-y-3">
                {villages.length > 1 ? (
                  <Choice
                    name={t('Audience', 'प्राप्तकर्ता')}
                    deva={deva}
                    value={audience}
                    onChange={setAudience}
                    options={[
                      { value: 'village', en: 'One village', hi: 'एक गाँव' },
                      { value: 'all_my_villages', en: 'All my villages', hi: 'मेरे सभी गाँव' },
                    ]}
                  />
                ) : null}

                {audience === 'village' ? (
                  <select
                    id="broadcast-village"
                    value={villageId}
                    onChange={(e) => setVillageId(e.target.value)}
                    className="field w-full"
                    disabled={!hasVillages}
                  >
                    <option value="">{t('Choose a village', 'गाँव चुनें')}</option>
                    {villages.map((village) => (
                      <option key={village.id} value={village.id}>
                        {villageLabel(village) || village.id}
                        {village.isPrimary ? (deva ? ' (मुख्य)' : ' (primary)') : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </Field>

            <Field
              label={t('Language it will be stored in', 'किस भाषा में दर्ज होगी')}
              hint={t(
                'A notice holds one language. Villagers see exactly what you type, labelled with the language you chose — nothing is translated for them.',
                'एक सूचना में एक ही भाषा रहती है। गाँववालों को वही दिखेगा जो आप लिखेंगी, चुनी हुई भाषा के साथ — उनके लिए कोई अनुवाद नहीं होता।',
              )}
            >
              <Choice
                name={t('Language', 'भाषा')}
                deva={deva}
                value={effectiveLang}
                onChange={setSendLang}
                options={[
                  { value: 'English', en: 'English', hi: 'अंग्रेज़ी' },
                  { value: 'Hindi', en: 'Hindi', hi: 'हिन्दी' },
                ]}
              />
            </Field>

            <Field label={t('What kind of notice', 'किस तरह की सूचना')}>
              <Choice
                name={t('Category', 'श्रेणी')}
                deva={deva}
                value={category}
                onChange={setCategory}
                options={CATEGORIES}
              />
            </Field>

            <Field
              label={t('How pressing is it', 'कितनी ज़रूरी है')}
              hint={t(
                'Only mark something urgent when it needs acting on today. A village that sees every notice marked urgent stops reading any of them.',
                'किसी बात को अति आवश्यक तभी चिह्नित करें जब आज ही कुछ करना हो। जिस गाँव में हर सूचना अति आवश्यक दिखे, वहाँ लोग कोई भी नहीं पढ़ते।',
              )}
            >
              <Choice
                name={t('Severity', 'गंभीरता')}
                deva={deva}
                value={severity}
                onChange={setSeverity}
                options={SEVERITIES}
              />
            </Field>

            <Field label={t('Heading', 'शीर्षक')} htmlFor="broadcast-title">
              <input
                id="broadcast-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field w-full"
                placeholder={
                  effectiveLang === 'Hindi'
                    ? 'मंगलवार को टीकाकरण शिविर'
                    : 'Immunisation camp on Tuesday'
                }
              />
            </Field>

            <Field
              label={t('The notice', 'सूचना')}
              htmlFor="broadcast-body"
              hint={t(
                'Say what it is, who it is for, and what they should do. Write dates and places in full — this is read on a small screen, often once.',
                'बताएँ कि बात क्या है, किसके लिए है, और उन्हें क्या करना है। तारीख़ और जगह पूरी लिखें — यह छोटी स्क्रीन पर, अक्सर एक ही बार पढ़ी जाती है।',
              )}
            >
              <textarea
                id="broadcast-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="field w-full resize-y"
              />
            </Field>

            <Field
              label={t('Where this came from (optional)', 'यह कहाँ से आई (वैकल्पिक)')}
              htmlFor="broadcast-source"
              hint={t(
                'If you are passing on something official, name it — a circular, a block meeting, an ANM. Villagers see this, and it is the difference between advice and hearsay.',
                'अगर आप कोई सरकारी बात आगे पहुँचा रही हैं, तो उसका नाम लिखें — परिपत्र, ब्लॉक बैठक, ए.एन.एम.। गाँववाले इसे देखते हैं, और यही सलाह और सुनी-सुनाई बात का अंतर है।',
              )}
            >
              <input
                id="broadcast-source"
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="field w-full"
              />
            </Field>

            <Field
              label={t('Stops being relevant on (optional)', 'कब तक प्रासंगिक (वैकल्पिक)')}
              htmlFor="broadcast-expires"
              hint={t(
                'Useful for a camp or a deadline. It must be in the future, or the notice would arrive already expired.',
                'शिविर या अंतिम तारीख़ के लिए उपयोगी। यह भविष्य की तारीख़ होनी चाहिए, वरना सूचना पहुँचते ही समाप्त हो जाएगी।',
              )}
            >
              <input
                id="broadcast-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="field w-full sm:max-w-xs"
              />
            </Field>
          </Card>

          {/* --- the honest pre-send statement ------------------------- */}
          <Card tone="seal" className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Radio size={18} className="text-seal" aria-hidden="true" />
              <Eyebrow>{t('Before you send', 'भेजने से पहले')}</Eyebrow>
            </div>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-ink">{audienceSentence}</p>
            <ul className="mt-4 space-y-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
              <li>
                {t(
                  'How many people that is will be reported here the moment you send. It is not estimated beforehand, because the list is built at send time from who is registered right then.',
                  'यह कितने लोग हैं, यह भेजते ही यहाँ बताया जाएगा। इसका पहले से अनुमान नहीं लगाया जाता, क्योंकि सूची भेजने के समय उन लोगों से बनती है जो तब दर्ज हैं।',
                )}
              </li>
              <li>
                {t(
                  'Someone who registers tomorrow will not receive this. Send it again if you need to reach them.',
                  'कल दर्ज होने वाले व्यक्ति को यह नहीं मिलेगी। उन तक पहुँचना हो तो दोबारा भेजें।',
                )}
              </li>
              <li>
                {t(
                  'It is stored unverified, and villagers are told in plain words that it is your advice and has not been checked against a government record.',
                  'यह असत्यापित के रूप में दर्ज होती है, और गाँववालों को साफ़ शब्दों में बताया जाता है कि यह आपकी सलाह है और किसी सरकारी अभिलेख से जाँची नहीं गई है।',
                )}
              </li>
            </ul>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Btn type="submit" variant="asha" size="lg" disabled={!canSend}>
                {sending ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send size={18} aria-hidden="true" />
                )}
                {t('Send the notice', 'सूचना भेजें')}
              </Btn>
              {!canSend && hasVillages && !sending ? (
                <p className="text-[0.85rem] text-ink-faint">
                  {t(
                    'A village, a heading and the notice itself are all needed.',
                    'गाँव, शीर्षक और सूचना — तीनों ज़रूरी हैं।',
                  )}
                </p>
              ) : null}
            </div>

            {sendError ? (
              <p className="mt-5 text-[0.9rem] leading-relaxed text-siren" role="alert">
                {sendError}
              </p>
            ) : null}
          </Card>
        </form>
      </section>

      {/* ================= 02 · What the server did ================= */}
      {result ? (
        <section className="mt-14">
          <SectionHead
            index="02"
            eyebrow={t('Result', 'परिणाम')}
            title={t('What was actually sent', 'वास्तव में क्या भेजा गया')}
          />
          <div className="mt-6">
            <SendResult result={result} t={t} deva={deva} villageNameOf={villageNameOf} />
          </div>
        </section>
      ) : null}

      {/* ================= 03 · Everything sent before ================= */}
      <section className="mt-14">
        <SectionHead
          index={result ? '03' : '02'}
          eyebrow={t('History', 'इतिहास')}
          title={t('Notices you have sent', 'आपकी भेजी सूचनाएँ')}
          sub={t(
            'A notice can be withdrawn only while nobody has read it. Once somebody has, the server refuses — send a correction instead of removing what people were told.',
            'सूचना तभी वापस ली जा सकती है जब किसी ने उसे पढ़ा न हो। किसी ने पढ़ लिया तो सर्वर मना कर देता है — जो लोगों को बताया गया उसे हटाने के बजाय सुधार भेजें।',
          )}
          action={
            <Btn variant="outline" onClick={sent.reload}>
              <RotateCw size={16} aria-hidden="true" />
              {t('Refresh', 'ताज़ा करें')}
            </Btn>
          }
        />
        <div className="mt-6">
          <SentList
            list={sent}
            t={t}
            deva={deva}
            onDelete={withdraw}
            deletingId={deletingId}
            deleteError={deleteError}
          />
        </div>
      </section>
    </AshaShell>
  );
}
