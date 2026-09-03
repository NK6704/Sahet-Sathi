import React from 'react';
import { Link } from 'wouter';
import { Phone, MessageSquare } from 'lucide-react';
import { getT } from '@/services/i18n';
import {
  Btn,
  Card,
  Eyebrow,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
} from '@/components/ds';

/* =============================================================
   The ASHA worker who covers this household.

   Shared by /profile and the citizen home, so there is exactly one
   implementation of the most consequential card in the app. Two
   pages showing this differently is how one of them ends up
   substituting a neighbouring village's worker.

   PROP CONTRACT — feed it GET /api/asha/contact verbatim:

     contact    { asha, alsoCovering, village, helpline, note, source }
                `asha` is null when nobody is mapped, and the server
                sends its own sentence in `note` explaining why.
     loading    the request has not settled
     error      an Error from the request
     onRetry    reload callback
     signedIn   whether there is a session at all
     language   'English' | 'हिन्दी'
     variant    'full'    — every field, for /profile
                'compact' — name, number, call and write, for home

   The rule this card exists to hold: when `asha` is null, NOTHING is
   put in her place. Not a nearby worker, not a district office, not a
   generic "your ASHA worker" placeholder. A worker who does not cover
   this household has no duty of care for it and may be an hour away.
   The national helpline is offered instead because it is a real,
   staffed number.
   ============================================================= */

function villageLabel(village) {
  if (!village) return '';
  if (typeof village === 'string') return village;
  return [village.name, village.block, village.district].filter(Boolean).join(', ');
}

export function AshaContactCard({
  contact,
  loading = false,
  error = null,
  onRetry,
  signedIn = true,
  language = 'English',
  variant = 'full',
}) {
  const t = getT(language);
  const compact = variant === 'compact';

  if (!signedIn) {
    return (
      <EmptyState
        stamp={false}
        title={t(
          'Sign in to see who covers your village',
          'अपने गाँव की कार्यकर्ता देखने के लिए साइन इन करें',
        )}
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
     sentence is the whole content of this state — inventing a name or
     a number here is the most harmful thing this card could do. */
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
          {/* The fix is on the person's own record, so point at it. */}
          {!contact?.villageId ? (
            <div className="mt-5">
              <Btn as={Link} href="/profile" variant="outline">
                {t('Set my village', 'मेरा गाँव दर्ज करें')}
              </Btn>
            </div>
          ) : null}
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
      <Card tone="asha" className={compact ? 'p-5' : 'p-5 sm:p-7'}>
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>{t('Your ASHA worker', 'आपकी आशा कार्यकर्ता')}</Eyebrow>
          {asha.isPrimary ? (
            <Pill tone="asha">
              {t('Primary for your village', 'आपके गाँव की मुख्य कार्यकर्ता')}
            </Pill>
          ) : null}
        </div>

        <h3 className={`display-md mt-3 ${compact ? 'text-xl' : 'text-2xl'}`}>
          {asha.fullName}
        </h3>

        {compact ? (
          /* On the home page the two facts that matter are where she
             works and what number to dial. Everything else is on
             /profile, one tap away. */
          <div className="mt-3 space-y-1.5">
            {village ? (
              <p className="text-[0.85rem] leading-relaxed text-ink-soft">{village}</p>
            ) : null}
            {asha.subCentre ? (
              <p className="text-[0.85rem] leading-relaxed text-ink-faint">{asha.subCentre}</p>
            ) : null}
            {asha.phone ? <p className="figure text-2xl text-ink">{asha.phone}</p> : null}
          </div>
        ) : (
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
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {/* A call is the fastest thing available to somebody standing
              in a courtyard with a sick child, so the number is printed
              in full and the call is the primary action. */}
          {asha.phone ? (
            <Btn
              as="a"
              href={`tel:${asha.phone}`}
              variant="asha"
              size={compact ? 'md' : 'lg'}
              data-testid="btn-call-asha"
            >
              <Phone size={compact ? 16 : 18} aria-hidden="true" />
              {t('Call her now', 'अभी कॉल करें')}
            </Btn>
          ) : null}
          <Btn
            as={Link}
            href="/messages"
            variant="outline"
            size={compact ? 'md' : 'lg'}
            data-testid="btn-message-asha"
          >
            <MessageSquare size={compact ? 16 : 18} aria-hidden="true" />
            {t('Write to her instead', 'लिखकर भेजें')}
          </Btn>
        </div>
      </Card>

      {!compact && alsoCovering.length ? (
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

      {!compact && contact?.source ? (
        <p className="font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {t('Source: ', 'स्रोत: ')}
          {contact.source}
        </p>
      ) : null}
    </div>
  );
}
