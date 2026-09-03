import React, { useState } from 'react';
import {
  Volume2,
  VolumeX,
  ShieldAlert,
  ArrowUpRight,
  Phone,
  ClipboardList,
  ListChecks,
  HeartPulse,
  MapPinOff,
  Info,
} from 'lucide-react';
import { Link } from 'wouter';
import { speakText, stopSpeaking } from '@/services/voice';
import { ActionChips } from '@/components/assistant/ActionChips';
import { HospitalCard } from '@/components/care/HospitalCard';
import { getT, isHindiLang } from '@/services/i18n';
import { Card, Eyebrow, Stamp } from '@/components/ds';

/* =============================================================
   One turn of the conversation.

   READS THE RESPONSE CONTRACT OF POST /api/assistant/message.
   The server always returns camelCase:

     response          the spoken/primary answer
     summary           { documentsRequired, nextSteps, healthGuidance }
     relatedSchemes    [{ id, title, benefitSummary, link }]
     nearbyHospitals   rows straight from the hospital registry,
                       already in HospitalCard's shape
     hospitalsNote     why that list is short, empty or wide
     locationShared    boolean
     sourceType, sources, confidence, disclaimer

   Older aliases (`related_schemes`, `nearby_hospitals`,
   `source_type`) are still accepted below so a screen that has not
   been migrated does not go blank, but nothing new should send them.

   Four things this component must always do, because they are the
   difference between guidance and a rumour:

     · The written summary is rendered, not just spoken. Someone
       standing at a hospital counter needs to read what papers to
       carry; a sentence that has already been read aloud and
       vanished is no use to them.
     · Every assistant answer carries its sources in the footer. An
       answer with no source at all says so with a "no source
       attached" stamp rather than quietly omitting the line.
     · A hospital list is never shown without its note. If the list
       is empty because no location was shared, that reason appears
       on screen, and so does the button that fixes it. We never
       silently substitute a guessed location.
     · An emergency answer switches to vermilion and puts a real
       tel: link to 108 inside the message, because at that moment
       the person should not have to navigate anywhere.
   ============================================================= */

function asList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/* One block of the written summary. Ruled left edge and a number per
   line, so it reads as a checklist someone can work through rather
   than a paragraph they skim. */
function SummaryBlock({ icon: Icon, label, items, tone = 'seal' }) {
  if (!items.length) return null;

  const accent =
    tone === 'siren' ? 'text-siren' : tone === 'amber' ? 'text-amber' : 'text-seal';
  const edge =
    tone === 'siren' ? 'border-siren' : tone === 'amber' ? 'border-amber' : 'border-seal';

  return (
    <div className={`border-l-2 ${edge} pl-3.5`}>
      <div className="flex items-center gap-2">
        <Icon size={14} className={`shrink-0 ${accent}`} aria-hidden="true" />
        <Eyebrow className={accent}>{label}</Eyebrow>
      </div>
      <ol className="mt-2.5 space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex gap-2.5">
            <span
              className="mt-[0.15rem] shrink-0 font-mono text-[0.68rem] tabular-nums text-ink-faint"
              aria-hidden="true"
            >
              {String(idx + 1).padStart(2, '0')}
            </span>
            <span className="text-[0.87rem] leading-relaxed text-ink-soft">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AssistantMessage({
  message,
  language = 'English',
  onActionClick,
  onShareLocation,
}) {
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

  const sourceType = message.sourceType ?? message.source_type ?? null;

  const sourced =
    sources.length > 0 &&
    (sourceType === 'curated' || sourceType === 'verified' || sourceType === 'official');

  const relatedSchemes = Array.isArray(message.relatedSchemes)
    ? message.relatedSchemes
    : Array.isArray(message.related_schemes)
      ? message.related_schemes
      : [];

  const nearbyHospitals = Array.isArray(message.nearbyHospitals)
    ? message.nearbyHospitals
    : Array.isArray(message.nearby_hospitals)
      ? message.nearby_hospitals
      : [];

  const documentsRequired = asList(message.summary?.documentsRequired);
  const nextSteps = asList(message.summary?.nextSteps);
  const healthGuidance = asList(message.summary?.healthGuidance);
  const hasSummary =
    documentsRequired.length > 0 || nextSteps.length > 0 || healthGuidance.length > 0;

  const hospitalsNote = message.hospitalsNote || null;
  /* `undefined` means the turn predates the field — only an explicit
     false is a claim that location was withheld. */
  const locationMissing = message.locationShared === false;

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

        {/* ---------- The written summary ----------
            Papers to carry, steps to take, care to follow. Spoken
            answers disappear; this is the part someone can read back
            at a counter or show to a family member. */}
        {hasSummary ? (
          <section
            className="mt-5 rounded-sm border border-rule bg-paper-2 p-4 sm:p-5"
            aria-label={hi ? 'लिखित सारांश' : 'Written summary'}
            data-testid="assistant-summary"
          >
            <Eyebrow>{hi ? 'लिखित सारांश' : 'Written summary'}</Eyebrow>
            <div className="mt-4 space-y-5">
              <SummaryBlock
                icon={ClipboardList}
                label={hi ? 'ज़रूरी कागज़ात' : 'Documents required'}
                items={documentsRequired}
              />
              <SummaryBlock
                icon={ListChecks}
                label={hi ? 'अगले कदम' : 'Next steps'}
                items={nextSteps}
              />
              <SummaryBlock
                icon={HeartPulse}
                label={hi ? 'स्वास्थ्य सलाह' : 'Health guidance'}
                items={healthGuidance}
                tone={isEmergency ? 'siren' : 'amber'}
              />
            </div>
          </section>
        ) : null}

        {/* Schemes the answer referred to */}
        {relatedSchemes.length ? (
          <div className="mt-5">
            <Eyebrow>{t.relatedSchemesTitle}</Eyebrow>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {relatedSchemes.map((scheme, idx) => (
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
                  {scheme.benefitSummary || scheme.benefit_summary ? (
                    <span className="mt-1.5 line-clamp-2 text-[0.78rem] leading-relaxed text-ink-faint">
                      {scheme.benefitSummary || scheme.benefit_summary}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* ---------- Hospitals near the person ----------
            Attached by the server from the PM-JAY registry, never by
            the model. The note is rendered whether or not there are
            rows, because "nothing within 25 km" and "you did not
            share a location" are different facts and the person
            needs to know which one they are looking at. */}
        {nearbyHospitals.length || hospitalsNote || locationMissing ? (
          <div className="mt-5 rounded-sm border border-rule-soft bg-paper-2 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Eyebrow className="text-seal">
                {hi
                  ? 'पास के PM-JAY सूचीबद्ध अस्पताल'
                  : 'PM-JAY empanelled hospitals near you'}
              </Eyebrow>
              <Link
                href="/care"
                className="inline-flex items-center gap-1 text-[0.75rem] font-bold text-seal hover:underline"
              >
                <span>{hi ? 'सभी देखें' : 'View all'}</span>
                <ArrowUpRight size={11} aria-hidden="true" />
              </Link>
            </div>

            {nearbyHospitals.length ? (
              <div className="mt-3 space-y-3">
                {nearbyHospitals.map((hospital, idx) => (
                  <HospitalCard
                    key={hospital.id || hospital.facilityId || idx}
                    hospital={hospital}
                    language={language}
                    index={String(idx + 1).padStart(2, '0')}
                  />
                ))}
              </div>
            ) : null}

            {/* Why the list looks the way it does. */}
            {hospitalsNote ? (
              <p className="mt-3 flex gap-2 text-[0.8rem] leading-relaxed text-ink-faint">
                <Info size={13} className="mt-[0.15rem] shrink-0" aria-hidden="true" />
                <span>{hospitalsNote}</span>
              </p>
            ) : null}

            {/* The fix, next to the reason. No guessed coordinates. */}
            {locationMissing ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
                <p className="flex min-w-0 flex-1 gap-2 text-[0.8rem] leading-relaxed text-ink-soft">
                  <MapPinOff size={13} className="mt-[0.15rem] shrink-0 text-amber" aria-hidden="true" />
                  <span>
                    {hi
                      ? 'आपकी लोकेशन साझा नहीं की गई, इसलिए दूरी नहीं बताई जा सकती।'
                      : 'Your location was not shared, so distances cannot be worked out.'}
                  </span>
                </p>
                {onShareLocation ? (
                  <button
                    type="button"
                    onClick={onShareLocation}
                    className="inline-flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-full border-[1.5px] border-seal px-4 text-[0.8rem] font-bold text-seal transition-colors hover:bg-seal-soft"
                    data-testid="btn-share-location-inline"
                  >
                    {hi ? 'लोकेशन साझा करें' : 'Share my location'}
                  </button>
                ) : null}
              </div>
            ) : null}
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

        {/* The server's own disclaimer, printed as sent. Paraphrasing
            it here would let the wording drift away from what the
            backend believes it said. */}
        {message.disclaimer ? (
          <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-faint">
            {message.disclaimer}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
