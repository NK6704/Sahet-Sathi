import React, { useState } from 'react';
import { Volume2, VolumeX, ShieldAlert, ArrowUpRight, Phone } from 'lucide-react';
import { Link } from 'wouter';
import { speakText, stopSpeaking } from '@/services/voice';
import { ActionChips } from '@/components/assistant/ActionChips';
import { getT, isHindiLang } from '@/services/i18n';
import { Card, Eyebrow, Stamp } from '@/components/ds';

/* =============================================================
   One turn of the conversation.

   Two things this component must always do, because they are the
   difference between guidance and a rumour:

     · Every assistant answer carries its sources in the footer. If
       the backend hands over an answer with no source at all, the
       footer says so with a "not confirmed" stamp rather than
       quietly omitting the line — an unsourced answer should look
       different from a sourced one.
     · An emergency answer switches to vermilion and puts a real
       tel: link to 108 inside the message, because at that moment
       the person should not have to navigate anywhere.

   The standing "guidance, not a diagnosis" disclaimer lives once on
   the page rather than repeated on every bubble, where it would be
   read as decoration and stop registering.
   ============================================================= */

export function AssistantMessage({ message, language = 'Hindi', onActionClick }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const isUser = message.sender === 'user';
  const isEmergency = message.urgency === 'emergency';
  const t = getT(language);
  const hi = isHindiLang(language);

  const handleToggleVoice = () => {
    if (isPlaying) {
      stopSpeaking();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      speakText(message.text, language, () => setIsPlaying(false));
    }
  };

  /* ---------- What the person said ---------- */
  if (isUser) {
    return (
      <div
        id={`msg-user-${message.id}`}
        className="flex justify-end appear"
        data-testid="msg-user"
      >
        <div className="ink-panel max-w-[86%] rounded-card px-5 py-4 sm:max-w-[70%]">
          <p className="eyebrow text-paper-3/70">{hi ? 'आपने कहा' : 'You said'}</p>
          <p className="mt-2 text-[0.95rem] font-medium leading-relaxed text-paper">
            {message.text}
          </p>
        </div>
      </div>
    );
  }

  /* ---------- What the assistant answered ---------- */
  const sources = Array.isArray(message.sources)
    ? message.sources.filter(Boolean)
    : message.sources
      ? [message.sources]
      : [];

  const sourced =
    sources.length > 0 &&
    (message.source_type === 'curated' ||
      message.source_type === 'verified' ||
      message.source_type === 'official');

  return (
    <div
      id={`msg-assistant-${message.id}`}
      className="appear flex justify-start"
      data-testid="msg-assistant"
    >
      <Card
        tone={isEmergency ? 'siren' : 'seal'}
        className="w-full max-w-[96%] p-5 sm:p-6"
      >
        {/* Header: who is speaking, and the listen control */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {isEmergency ? (
              <ShieldAlert size={17} className="shrink-0 text-siren" aria-hidden="true" />
            ) : null}
            <Eyebrow className={isEmergency ? 'text-siren' : ''}>
              {isEmergency ? t.emergencyAlert : t.sehatSathiReply}
            </Eyebrow>
          </div>

          <button
            type="button"
            onClick={handleToggleVoice}
            aria-label={isPlaying ? t.stopVoice : t.listenVoice}
            aria-pressed={isPlaying}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 text-[0.78rem] font-semibold transition-colors ${
              isPlaying
                ? 'border-asha bg-asha text-white'
                : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {isPlaying ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
            {isPlaying ? t.stopVoice : t.listenVoice}
          </button>
        </div>

        {/* The answer */}
        <div className="mt-4 whitespace-pre-line text-[0.94rem] leading-relaxed text-ink-soft">
          {message.text}
        </div>

        {/* Emergency: the call comes before anything else */}
        {isEmergency ? (
          <a
            href="tel:108"
            className="btn btn-siren mt-5 w-full sm:w-auto"
            data-testid="link-call-108-inline"
          >
            <Phone size={17} aria-hidden="true" />
            {hi ? '108 पर अभी कॉल करें' : 'Call 108 now'}
          </a>
        ) : null}

        {/* Schemes the answer referred to */}
        {message.related_schemes?.length ? (
          <div className="mt-5">
            <Eyebrow>{t.relatedSchemesTitle}</Eyebrow>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {message.related_schemes.map((scheme, idx) => (
                <Link
                  key={scheme.id || idx}
                  href={scheme.link || '/schemes'}
                  className="group flex flex-col rounded-sm border border-rule-soft bg-paper-3 px-3.5 py-3 transition-colors hover:border-seal"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[0.86rem] font-semibold leading-snug text-ink group-hover:text-seal">
                      {scheme.title}
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="mt-0.5 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                  </span>
                  {scheme.benefit_summary ? (
                    <span className="mt-1.5 line-clamp-2 text-[0.78rem] leading-relaxed text-ink-faint">
                      {scheme.benefit_summary}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* Nearest Government Healthcare Facilities */}
        {message.nearby_hospitals?.length ? (
          <div className="mt-5 rounded-sm border border-rule-soft bg-paper-2 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow className="text-seal">
                {hi ? '🏛️ पास के सरकारी स्वास्थ्य केंद्र / अस्पताल' : '🏛️ Nearest Government Healthcare Facilities'}
              </Eyebrow>
              <Link
                href="/care"
                className="text-[0.75rem] font-bold text-seal hover:underline inline-flex items-center gap-1"
              >
                <span>{hi ? 'सभी देखें' : 'View all'}</span>
                <ArrowUpRight size={11} />
              </Link>
            </div>

            <div className="mt-3 space-y-2.5">
              {message.nearby_hospitals.map((fac, idx) => (
                <div
                  key={fac.id || idx}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-rule bg-paper p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[0.86rem] font-semibold text-ink">
                        {hi ? (fac.name_hi || fac.name) : fac.name}
                      </span>
                      {fac.is_24x7 ? (
                        <span className="rounded-full bg-asha/15 px-2 py-0.5 text-[0.7rem] font-bold text-asha">
                          24x7
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[0.76rem] text-ink-soft">
                      <span>{fac.distance_km ? `${fac.distance_km} km` : 'Near you'}</span>
                      <span>·</span>
                      <span>{fac.type || 'Government Facility'}</span>
                      {fac.beds ? (
                        <>
                          <span>·</span>
                          <span>{fac.beds} {hi ? 'बेड' : 'beds'}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {fac.phone ? (
                      <a
                        href={`tel:${fac.phone}`}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-rule bg-paper-3 px-3 text-[0.75rem] font-semibold text-ink hover:border-ink"
                        title={hi ? 'कॉल करें' : 'Call facility'}
                      >
                        <Phone size={12} className="text-seal" />
                        <span>{hi ? 'कॉल' : 'Call'}</span>
                      </a>
                    ) : null}
                    <Link
                      href="/care"
                      className="inline-flex min-h-8 items-center gap-1 rounded-full bg-seal px-3 text-[0.75rem] font-bold text-paper hover:bg-seal-deep transition"
                    >
                      <span>{hi ? 'दिशा' : 'Directions'}</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* What to do next */}
        {message.actions?.length ? (
          <div className="mt-5">
            <ActionChips actions={message.actions} onActionClick={onActionClick} />
          </div>
        ) : null}

        {/* Provenance. An unsourced answer must not look sourced. */}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          {sourced ? (
            <Stamp kind="verified" label={t.verifiedSource} source={sources.join(' · ')} />
          ) : sources.length ? (
            <Stamp
              kind="inferred"
              label={hi ? 'AI द्वारा तैयार' : 'AI-assisted'}
              source={sources.join(' · ')}
            />
          ) : (
            <Stamp kind="inferred" label={hi ? 'स्रोत नहीं जुड़ा' : 'No source attached'} />
          )}
        </div>
      </Card>
    </div>
  );
}
