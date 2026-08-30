import React from 'react';
import { Siren, Phone, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { getMySosBroadcasts } from '@/services/platform';
import { getT } from '@/services/i18n';
import { Eyebrow, Pill, Stamp } from '@/components/ds';

/* =============================================================
   The live-emergency surface, and the vocabulary for saying what
   a broadcast actually did.

   Four things share this module because they have to agree with
   each other word for word: the banner that says an emergency is
   still open, the status words for an SOS, the per-recipient
   delivery report, and the two time formats. The citizen screen
   and the worker screen both render the same delivery rows, and
   if each kept its own copy of the wording then one of them would
   eventually describe an accepted text message as a delivered
   one. There is one copy, and it is here.

   That is the rule this module exists to hold: `status: 'sent'` on
   an SMS row means Twilio accepted the message for delivery.
   Nothing in this system is ever told that a handset rang, so
   nothing here renders "delivered".

   Vermilion is reserved for exactly this path in the whole design
   system — 108, 112 and a live emergency. If it appeared anywhere
   ordinary it would stop meaning anything here.
   ============================================================= */

/** The statuses an SOS is still live in. Mirrors ACTIVE_STATUSES on the server. */
export const LIVE_SOS_STATUSES = ['open', 'acknowledged'];

export const isLiveSos = (row) => LIVE_SOS_STATUSES.includes(row?.status);

const SOS_STATUS = {
  open: { en: 'Open', hi: 'खुला', tone: 'siren' },
  acknowledged: { en: 'Acknowledged', hi: 'देख लिया गया', tone: 'amber' },
  resolved: { en: 'Resolved', hi: 'निपटाया गया', tone: 'seal' },
  cancelled: { en: 'Cancelled', hi: 'रद्द किया गया', tone: 'neutral' },
};

/**
 * An unrecognised status is printed exactly as the server sent it
 * rather than mapped to the nearest familiar word. A new status added
 * server-side should look unfamiliar on screen, not quietly wrong.
 */
export function sosStatusLabel(status, hi = false) {
  const meta = SOS_STATUS[status];
  if (!meta) return status || '—';
  return hi ? meta.hi : meta.en;
}

export function SosStatus({ status, hi = false, className = '' }) {
  return (
    <Pill tone={SOS_STATUS[status]?.tone ?? 'neutral'} className={className}>
      {sosStatusLabel(status, hi)}
    </Pill>
  );
}

/**
 * The outcomes an SOS can be closed with.
 *
 * The server requires a non-empty outcome and stores whatever string it
 * is given, so the wording has to be fixed somewhere or the same event
 * gets recorded six different ways. The English value is what is sent
 * from both the family's screen and the worker's screen — a record that
 * changes wording with the reader's language cannot be counted later —
 * and the Hindi text is a label only.
 */
export const SOS_OUTCOMES = [
  { value: 'Reached hospital', hi: 'अस्पताल पहुँच गए' },
  { value: 'Ambulance took the patient', hi: 'एम्बुलेंस मरीज़ को ले गई' },
  { value: 'Treated at home or by the ASHA worker', hi: 'घर पर या आशा कार्यकर्ता से इलाज हुआ' },
  { value: 'Referred to a facility', hi: 'सुविधा के लिए रेफर किया' },
  { value: 'False alarm, no help needed', hi: 'ग़लत सूचना, मदद की ज़रूरत नहीं थी' },
  { value: 'Could not reach the family', hi: 'परिवार से संपर्क नहीं हो सका' },
  { value: 'Patient died', hi: 'मरीज़ की मृत्यु हो गई' },
];

/* -------------------------------------------------------------
   Time
   ------------------------------------------------------------- */

/** "20 minutes ago" beats a timestamp while you are deciding what to do. */
export function timeAgo(iso, hi = false) {
  if (!iso) return '—';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (Number.isNaN(mins)) return '—';

  if (mins < 1) return hi ? 'अभी' : 'just now';
  if (mins < 60) return hi ? `${mins} मिनट पहले` : `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return hi ? `${hours} घंटे पहले` : `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return hi ? `${days} दिन पहले` : `${days} d ago`;

  return timeStamp(iso, hi);
}

/** The full moment, for a record somebody may have to quote later. */
export function timeStamp(iso, hi = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(hi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Anything a phone dialler would choke on, removed. */
export const telHref = (phone) => `tel:${String(phone ?? '').replace(/[^\d+]/g, '')}`;

/* -------------------------------------------------------------
   The delivery report
   ------------------------------------------------------------- */

const CHANNEL_LABEL = {
  in_app: { en: 'In the ASHA portal', hi: 'आशा पोर्टल में' },
  sms: { en: 'Text messages', hi: 'एसएमएस संदेश' },
};

const KIND_LABEL = {
  asha: { en: 'ASHA worker', hi: 'आशा कार्यकर्ता' },
  emergency_contact: { en: 'Family contact', hi: 'पारिवारिक संपर्क' },
};

/**
 * How one delivery row is described, and the only place the three
 * server status words are turned into English or Hindi.
 *
 * An accepted SMS carries the *inferred* stamp — dashed and hollow,
 * the same mark this app puts on anything a model produced. That is
 * not a stylistic choice. Twilio accepting a message is not evidence
 * that it arrived, so the row gets the mark that means "not
 * confirmed" rather than the sealed one. The in-app row does get the
 * verified stamp, because a row written into her queue in Postgres is
 * something the server watched happen.
 */
function statusWords(row, hi) {
  if (row.status === 'sent') {
    return row.channel === 'sms'
      ? {
          stamp: 'inferred',
          label: hi ? 'ट्विलियो ने स्वीकार किया' : 'Accepted by Twilio',
        }
      : {
          stamp: 'verified',
          label: hi ? 'उनकी सूची में दर्ज' : 'Queued in her portal',
        };
  }
  if (row.status === 'skipped') {
    return { stamp: 'none', label: hi ? 'नहीं भेजा गया' : 'Not sent' };
  }
  if (row.status === 'failed') {
    return { stamp: 'urgent', label: hi ? 'भेजने में विफल' : 'Send failed' };
  }
  // Unknown word from the server: shown as-is.
  return { stamp: 'none', label: row.status || (hi ? 'अज्ञात' : 'Unknown') };
}

function DeliveryRow({ row, hi }) {
  const words = statusWords(row, hi);
  const kind = KIND_LABEL[row.recipientKind];

  return (
    <li className="border-t border-rule-soft py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Eyebrow>{kind ? (hi ? kind.hi : kind.en) : row.recipientKind}</Eyebrow>
          <p className="mt-1.5 text-[0.95rem] font-semibold leading-snug text-ink">
            {row.recipientName || (hi ? 'नाम दर्ज नहीं' : 'No name on record')}
          </p>
          {row.recipientPhone ? (
            <a
              href={telHref(row.recipientPhone)}
              className="mt-1 inline-flex items-center gap-1.5 font-mono text-[0.8rem] text-seal hover:underline"
            >
              <Phone size={12} aria-hidden="true" />
              {row.recipientPhone}
            </a>
          ) : null}
        </div>

        <div className="shrink-0">
          <Stamp kind={words.stamp} label={words.label} />
          {row.sentAt ? (
            <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-faint">
              {timeStamp(row.sentAt, hi)}
            </p>
          ) : null}
        </div>
      </div>

      {/* The server's own sentence. On a skipped row this is not an
          error at all — it is the explanation for a deliberate
          silence, and it is the most useful line on the screen. */}
      {row.reason ? (
        <p className="mt-3 max-w-2xl text-[0.85rem] leading-relaxed text-ink-soft">
          {row.reason}
        </p>
      ) : null}
    </li>
  );
}

function Group({ label, children }) {
  return (
    <div className="mt-6 first:mt-0">
      <Eyebrow>{label}</Eyebrow>
      <ul className="mt-3">{children}</ul>
    </div>
  );
}

/**
 * One row per intended recipient, in the server's own status words.
 *
 * Rendered identically for the family and for the worker. She needs
 * it as much as they do: if the relatives were never texted, she is
 * the only person who knows, and she is the one who can pick up a
 * phone.
 */
export function DeliveryReport({ deliveries, hi = false, className = '' }) {
  const rows = deliveries ?? [];

  if (rows.length === 0) {
    return (
      <p className={`text-[0.9rem] leading-relaxed text-ink-soft ${className}`}>
        {hi
          ? 'इस SOS के लिए कोई डिलीवरी रिकॉर्ड दर्ज नहीं हुआ। हर SOS पर हर इच्छित प्राप्तकर्ता की एक पंक्ति होनी चाहिए, इसलिए यह खालीपन खुद एक गड़बड़ी है — इसकी सूचना दें।'
          : 'No delivery record was written for this SOS. Every SOS should produce one row per intended recipient, so an empty record is itself a fault worth reporting rather than a sign that all was well.'}
      </p>
    );
  }

  const inApp = rows.filter((r) => r.channel === 'in_app');
  const sms = rows.filter((r) => r.channel === 'sms');
  const other = rows.filter((r) => r.channel !== 'in_app' && r.channel !== 'sms');

  const accepted = sms.filter((r) => r.status === 'sent').length;
  const notSent = sms.filter((r) => r.status === 'skipped').length;
  const failed = sms.filter((r) => r.status === 'failed').length;

  return (
    <div className={className}>
      {/* Counted from the rows themselves, never from a summary field,
          so the tally and the list below cannot disagree. */}
      <p className="font-mono text-[0.72rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
        {hi
          ? `${sms.length} एसएमएस · ${accepted} स्वीकृत · ${notSent} नहीं भेजे · ${failed} विफल`
          : `${sms.length} text message(s) · ${accepted} accepted · ${notSent} not sent · ${failed} failed`}
      </p>

      {inApp.length > 0 ? (
        <Group label={hi ? CHANNEL_LABEL.in_app.hi : CHANNEL_LABEL.in_app.en}>
          {inApp.map((row, i) => (
            <DeliveryRow key={row.id ?? `in_app-${i}`} row={row} hi={hi} />
          ))}
        </Group>
      ) : null}

      {sms.length > 0 ? (
        <Group label={hi ? CHANNEL_LABEL.sms.hi : CHANNEL_LABEL.sms.en}>
          {sms.map((row, i) => (
            <DeliveryRow key={row.id ?? `sms-${i}`} row={row} hi={hi} />
          ))}
        </Group>
      ) : null}

      {other.map((row, i) => (
        <Group key={row.channel ?? i} label={row.channel}>
          <DeliveryRow row={row} hi={hi} />
        </Group>
      ))}

      {/* Printed whenever anything was accepted, because "accepted" is
          the word people read as "delivered". */}
      {accepted > 0 ? (
        <p className="mt-6 border-t border-rule pt-5 text-[0.85rem] leading-relaxed text-ink-soft">
          {hi
            ? 'स्वीकृत का अर्थ है संदेश नेटवर्क को सौंप दिया गया। यह ऐप कभी नहीं जान पाता कि किसी का फ़ोन बजा या नहीं, इसलिए कहीं भी "पहुँच गया" नहीं लिखा है। अगर तुरंत ज़रूरत है तो सीधे फ़ोन करें।'
            : 'Accepted means the message was handed to the mobile network. This app is never told whether a phone rang, which is why nothing here says “delivered”. If it matters right now, ring the number yourself.'}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------
   The banner
   ------------------------------------------------------------- */

/**
 * An emergency this account has open, or nothing at all.
 *
 * This used to be a permanent red block on the home page, which made
 * vermilion ordinary and said "someone needs help right now?" to
 * somebody who had opened the app to read about a scheme. It now
 * renders only while an SOS raised by this account is still open or
 * acknowledged, so seeing it means something.
 *
 * While it cannot tell — not signed in, still loading, request failed
 * — it renders nothing. A banner is not the right place to report that
 * we could not check; the emergency page reports that properly.
 */
export function EmergencyBanner({ language }) {
  const { language: accountLanguage, isAuthenticated } = useAuth();
  const t = getT(language || accountLanguage);
  const hi = t.isHindi;

  const { data } = useAsync(() => getMySosBroadcasts(), [], { skip: !isAuthenticated });

  // Newest first from the server, so the first live row is the current
  // emergency rather than an older one somebody forgot to close.
  const live = (data?.sos ?? []).find(isLiveSos);
  if (!live) return null;

  const acknowledged = live.status === 'acknowledged';
  const sms = (live.deliveries ?? []).filter((d) => d.channel === 'sms');
  const accepted = sms.filter((d) => d.status === 'sent').length;

  return (
    <section
      id="banner-emergency-fast-path"
      className="relative overflow-hidden rounded-card border border-siren bg-siren text-paper"
      data-testid="banner-emergency"
      aria-label={t('Emergency in progress', 'चल रहा आपातकाल')}
    >
      <div className="relative z-10 flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-sm bg-paper/15">
            <Siren size={24} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.16em] text-paper/70">
              {t('Emergency in progress', 'चल रहा आपातकाल')}
              {' · '}
              {timeAgo(live.createdAt, hi)}
            </p>

            <h2 className="display-md mt-1.5 text-xl text-paper sm:text-2xl">
              {live.patientName
                ? t(`SOS raised for ${live.patientName}`, `${live.patientName} के लिए SOS दर्ज है`)
                : t('An SOS you raised is still open', 'आपका दर्ज किया SOS खुला है')}
            </h2>

            {live.category ? (
              <p className="mt-1.5 text-[0.85rem] text-paper/80">{live.category}</p>
            ) : null}

            <p className="mt-2 max-w-md text-[0.85rem] leading-relaxed text-paper/80">
              {acknowledged
                ? /* acknowledgedBy is a user id and no name comes back with
                     it, so the worker is not named here rather than guessed. */
                  t(
                    'An ASHA worker has picked this up in her portal. Keep this phone free.',
                    'एक आशा कार्यकर्ता ने इसे पोर्टल में देख लिया है। यह फ़ोन खाली रखें।',
                  )
                : t(
                    'Recorded and waiting for an ASHA worker to pick it up. Nobody has acknowledged it yet.',
                    'दर्ज हो गया है और आशा कार्यकर्ता के देखने का इंतज़ार है। अभी किसी ने इसे नहीं देखा।',
                  )}
              {' '}
              {accepted > 0
                ? t(
                    `${accepted} text message(s) were accepted for delivery.`,
                    `${accepted} एसएमएस भेजने के लिए स्वीकार हुए।`,
                  )
                : t(
                    'No text message has been accepted for delivery.',
                    'कोई एसएमएस भेजने के लिए स्वीकार नहीं हुआ।',
                  )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {/* A real tel: link, not a router link, so it works with no
              session, no data connection and no JavaScript finished. */}
          <a
            href="tel:108"
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-paper px-5 text-[0.95rem] font-bold text-siren transition-transform active:translate-y-px"
            data-testid="btn-banner-call-108"
          >
            <Phone size={17} strokeWidth={2.4} aria-hidden="true" />
            {t('Call 108', '108 पर कॉल')}
          </a>
          <Link
            href="/emergency"
            className="inline-flex min-h-12 items-center gap-1.5 rounded-full border-[1.5px] border-paper/40 px-4 text-[0.85rem] font-semibold text-paper transition-colors hover:border-paper hover:bg-paper/10"
            data-testid="btn-banner-open-emergency"
          >
            {t('See what was sent', 'देखें क्या भेजा गया')}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
