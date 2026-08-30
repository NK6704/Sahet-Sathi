import React from 'react';
import {
  Phone,
  Navigation,
  MapPin,
  Stethoscope,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { Card, Eyebrow, Pill, Stamp } from '@/components/ds';
import { isHindiLang } from '@/services/i18n';

/* =============================================================
   One hospital from the National Health Authority's PM-JAY
   empanelment registry.

   PROP CONTRACT — other pages import this component, so it does
   not change shape without a note in the build report:

     hospital          A row exactly as /api/hospitals/nearby,
                       /search or /:id sends it, camelCase and
                       unmodified. Only `name` is required. Every
                       other field renders when present and is
                       silently omitted when absent, because the
                       registry is genuinely patchy and an empty
                       line is worse than a missing one.
     language          'English' | 'हिन्दी', as useAuth() returns it.
     hi                Optional boolean override, for the ASHA pages
                       that already hold one.
     specialityLabels  Optional { [code]: name } built from
                       getHospitalMeta().specialities. Without it the
                       speciality codes are not printed: '100005' is
                       a code, not a speciality.
     index             Optional register row number, e.g. '04'.
     className         Passed through to the card.

   Three rules this card exists to keep:

     1. `distanceKm` is printed and never computed. The nearby
        endpoint is the only thing that returns it, because it is
        the only thing that knows which coordinate it was measured
        from. No distance is shown anywhere else.
     2. `contactVerified` is false on every row in the current
        import. The number below is what the registry publishes,
        not a number this app has dialled, and it says so. A family
        ringing a dead number during an emergency is the specific
        harm being avoided.
     3. `source`, `sourceUrl` and `verification` are printed, not
        filtered out. They are the reason someone can trust — or
        sensibly distrust — the row above them.
   ============================================================= */

/**
 * The registry rounds distance to two decimals. Below 10 km one
 * decimal is the honest resolution for a straight-line measurement;
 * above that the decimal is noise.
 */
function formatKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

/**
 * Registry phone fields often carry two numbers in one string,
 * separated by a comma or a slash, and sometimes an extension after
 * them. Stripping the punctuation from the whole string would splice
 * them into one number that dials nowhere, so each part is taken
 * separately and only the leading number token in it is dialled.
 * Anything too short to be a phone number is dropped rather than
 * shown.
 */
function phoneNumbers(...fields) {
  const out = [];

  for (const field of fields) {
    if (!field) continue;
    for (const part of String(field).split(/[,;/|\n]+/)) {
      const shown = part.trim();
      if (!shown) continue;

      const token = shown.match(/\+?\d[\d\s()–-]{4,}/);
      if (!token) continue;

      const dial = token[0].replace(/[^\d+]/g, '');
      if (dial.replace(/\D/g, '').length < 6) continue;
      if (out.some((p) => p.dial === dial)) continue;

      out.push({ shown, dial });
      if (out.length === 2) return out;
    }
  }

  return out;
}

export function HospitalCard({
  hospital,
  language = 'English',
  hi,
  specialityLabels,
  index,
  className = '',
}) {
  const deva = typeof hi === 'boolean' ? hi : Boolean(language) && isHindiLang(language);
  const t = (en, dev) => (deva ? dev : en);

  if (!hospital?.name) return null;

  const official = hospital.verification === 'verified';
  const distance = formatKm(hospital.distanceKm);
  const phones = phoneNumbers(hospital.phone, hospital.mobile);

  const lat = Number(hospital.latitude);
  const lng = Number(hospital.longitude);
  const mappable = Number.isFinite(lat) && Number.isFinite(lng);

  // The registry's own words for the type. An unmapped code is shown
  // as the code rather than guessed at.
  const typeLabel = hospital.type || hospital.typeCode || null;
  const government = hospital.typeCode === 'G';

  // `district` is absent, not empty, when the NHA district list was
  // unreachable at import time. `state` is the denormalised name.
  const place = [hospital.district, hospital.state].filter(Boolean).join(' · ');

  const codes = Array.isArray(hospital.specialityCodes) ? hospital.specialityCodes : [];
  const named = specialityLabels
    ? codes.map((code) => specialityLabels[code]).filter(Boolean)
    : [];
  const shownSpecialities = named.slice(0, 3);
  const moreSpecialities = codes.length - shownSpecialities.length;

  return (
    <Card
      tone={official ? 'seal' : 'amber'}
      lift
      className={`flex flex-col p-5 sm:p-6 ${className}`}
      data-testid={`card-hospital-${hospital.id ?? hospital.facilityId ?? ''}`}
    >
      {/* ---- Row head: type on the left, distance as the headline ---- */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            {index ? <span className="reg-index">{index}</span> : null}
            {typeLabel ? (
              <Pill tone={government ? 'seal' : 'neutral'}>{typeLabel}</Pill>
            ) : null}
          </div>
          {hospital.ownershipSubType || hospital.facilityType ? (
            <Eyebrow className="mt-2.5">
              {hospital.ownershipSubType || hospital.facilityType}
            </Eyebrow>
          ) : null}
        </div>

        {distance ? (
          <p className="shrink-0 text-right">
            <span className="figure text-3xl text-seal sm:text-4xl">{distance}</span>
            <span className="ml-1 font-mono text-sm text-ink-faint">km</span>
            <span className="mt-1 block font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-faint">
              {t('straight line', 'सीधी दूरी')}
            </span>
          </p>
        ) : null}
      </div>

      {/* ---- Name ---- */}
      <h3 className="mt-4 text-xl font-semibold leading-snug text-ink">
        {hospital.name}
      </h3>

      {/* ---- Where it is ---- */}
      {hospital.address || place ? (
        <p className="mt-3 flex items-start gap-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
          <MapPin size={15} className="mt-1 shrink-0 text-ink-faint" aria-hidden="true" />
          <span>
            {hospital.address}
            {hospital.address && place ? <br /> : null}
            {place ? <span className="text-ink-faint">{place}</span> : null}
          </span>
        </p>
      ) : null}

      {/* ---- Specialities, by name only ---- */}
      {shownSpecialities.length || codes.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Stethoscope size={15} className="mr-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
          {shownSpecialities.length ? (
            <>
              {shownSpecialities.map((name) => (
                <Pill key={name}>{name}</Pill>
              ))}
              {moreSpecialities > 0 ? (
                <span className="text-[0.8rem] text-ink-faint">
                  {t(`+${moreSpecialities} more`, `+${moreSpecialities} और`)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[0.8rem] text-ink-faint">
              {t(
                `${codes.length} specialities listed by code only`,
                `${codes.length} विशेषज्ञताएँ केवल कोड में दर्ज हैं`,
              )}
            </span>
          )}
        </div>
      ) : null}

      {/* ---- Actions ---- */}
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap gap-2">
          {phones.map((p) => (
            <a
              key={p.dial}
              href={`tel:${p.dial}`}
              className="inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] border-rule px-4 text-[0.9rem] font-semibold text-ink transition-colors hover:border-ink"
              data-testid={`btn-call-hospital-${hospital.id ?? ''}`}
            >
              <Phone size={15} aria-hidden="true" />
              <span className="truncate font-mono text-[0.85rem]">{p.shown}</span>
            </a>
          ))}

          {mappable ? (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[0.9rem] font-semibold text-paper transition-colors hover:bg-seal"
              data-testid={`btn-directions-hospital-${hospital.id ?? ''}`}
            >
              <Navigation size={15} aria-hidden="true" />
              {t('Directions', 'रास्ता')}
            </a>
          ) : null}
        </div>

        {!phones.length ? (
          <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-faint">
            {t(
              'The registry lists no phone number for this hospital.',
              'रजिस्टर में इस अस्पताल का कोई फ़ोन नंबर दर्ज नहीं है।',
            )}
          </p>
        ) : hospital.contactVerified ? null : (
          <p className="mt-3 flex items-start gap-2 text-[0.82rem] leading-relaxed text-amber">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t(
                'This number is as listed in the registry. Sehat Sathi has not called it to check that it works.',
                'यह नंबर रजिस्टर में दर्ज है। सेहत साथी ने इसे मिलाकर जाँचा नहीं है।',
              )}
            </span>
          </p>
        )}

        {!mappable ? (
          <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-faint">
            {t(
              'No map location is published for this hospital, so directions cannot be opened.',
              'इस अस्पताल का नक्शा-स्थान दर्ज नहीं है, इसलिए रास्ता नहीं खोला जा सकता।',
            )}
          </p>
        ) : null}
      </div>

      {/* ---- Provenance. Not fine print: the reason to trust the row ---- */}
      <div className="mt-5 border-t border-rule pt-4">
        <Stamp
          kind={official ? 'verified' : 'inferred'}
          label={
            official
              ? t('Empanelled under PM-JAY', 'पीएम-जय में सूचीबद्ध')
              : t('Listing not verified', 'सूची असत्यापित')
          }
        />
        {/* Printed only when the row actually carries a source. An
            empty "Source:" line would imply a provenance that is not
            there, which is the opposite of the point. */}
        <p className="mt-3.5 font-mono text-[0.66rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {hospital.source ? t('Source: ', 'स्रोत: ') : null}
          {hospital.source && hospital.sourceUrl ? (
            <a
              href={hospital.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-baseline gap-1 underline decoration-rule underline-offset-2 hover:text-ink"
            >
              {hospital.source}
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          ) : (
            hospital.source
          )}
          {hospital.facilityId ? (
            <span className="mt-1 block">
              {t('Registry ID ', 'रजिस्टर आईडी ')}
              {hospital.facilityId}
            </span>
          ) : null}
        </p>
      </div>
    </Card>
  );
}
