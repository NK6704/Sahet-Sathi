import React from 'react';
import { CalendarDays, MapPin, Clock, Phone } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { listCamps } from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Pill,
  Stamp,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /asha/camps — upcoming verified health camps.

   This page is deliberately allowed to be empty. The brief is
   explicit: show verified camps only, and when there are none say
   "No verified health camps found." rather than inventing an event.
   A worker who tells twelve families about a camp that does not
   exist loses their trust permanently. An empty page costs nothing.
   ============================================================= */

function formatCampDate(iso, hi) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(hi ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

function daysAway(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function trimTime(t) {
  return typeof t === 'string' ? t.slice(0, 5) : null;
}

export function AshaCamps() {
  const { profile } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const { data, error, loading, reload } = useAsync(() => listCamps({}), []);
  const camps = data ?? [];

  return (
    <AshaShell
      eyebrow={t('Register 006 · Camps', 'रजिस्टर 006 · शिविर')}
      title={t('Upcoming health camps', 'आने वाले स्वास्थ्य शिविर')}
      sub={t(
        'Only camps confirmed with the block office appear here. If the list is empty, there is nothing confirmed — not nothing happening.',
        'यहाँ केवल ब्लॉक कार्यालय से पुष्ट शिविर दिखते हैं। सूची खाली हो तो मतलब कुछ पुष्ट नहीं है।',
      )}
    >
      {loading ? (
        <LoadingState label={t('Loading camps', 'शिविर लोड हो रहे हैं')} rows={2} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load camps", 'शिविर लोड नहीं हुए')}
          body={t(
            'The camp list could not be fetched. Do not announce a camp you cannot see here — check with your ANM instead.',
            'सूची नहीं मिली। जो शिविर यहाँ न दिखे उसकी घोषणा न करें — अपनी ANM से पूछें।',
          )}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : camps.length === 0 ? (
        /* The exact wording is fixed by the brief. Do not soften it,
           and do not fill the space with a plausible-looking camp. */
        <EmptyState
          title={t('No verified health camps found.', 'कोई पुष्ट स्वास्थ्य शिविर नहीं मिला।')}
          body={t(
            'Nothing has been confirmed for your area yet. When the block office confirms a camp it will appear here, with its date, venue and the services on offer.',
            'आपके क्षेत्र के लिए अभी कुछ पुष्ट नहीं है। जब ब्लॉक कार्यालय शिविर पुष्ट करेगा, वह तारीख़, जगह और सेवाओं के साथ यहाँ दिखेगा।',
          )}
          action={
            <Btn variant="outline" onClick={reload}>
              {t('Check again', 'फिर देखें')}
            </Btn>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {camps.map((c) => (
            <CampCard key={c.id} camp={c} hi={hi} />
          ))}
        </div>
      )}

      <Card className="mt-8 p-5">
        <Stamp kind="verified" label={t('Verified only', 'केवल पुष्ट')} />
        <p className="mt-4 max-w-2xl text-[0.85rem] leading-relaxed text-ink-soft">
          {t(
            'Camps are filtered twice — once by the database and again by this page — to verified, uncancelled and still upcoming. A camp that gets cancelled disappears from this list rather than being quietly left behind.',
            'शिविर दो बार छाने जाते हैं — डेटाबेस में और इस पन्ने पर — केवल पुष्ट, रद्द नहीं, और आने वाले। रद्द शिविर सूची से हट जाता है।',
          )}
        </p>
      </Card>
    </AshaShell>
  );
}

function CampCard({ camp: c, hi }) {
  const t = (en, dev) => (hi ? dev : en);
  const away = daysAway(c.camp_date);
  const soon = typeof away === 'number' && away <= 2;
  const from = trimTime(c.start_time);
  const to = trimTime(c.end_time);

  return (
    <Card tone={soon ? 'amber' : 'seal'} lift className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>
            {away === 0
              ? t('Today', 'आज')
              : away === 1
              ? t('Tomorrow', 'कल')
              : t(`In ${away} days`, `${away} दिन में`)}
          </Eyebrow>
          <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">{c.title}</h3>
        </div>
        <Stamp kind="verified" label={t('Verified', 'पुष्ट')} />
      </div>

      {c.description ? (
        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">{c.description}</p>
      ) : null}

      <div className="mt-4 space-y-2 text-[0.875rem] text-ink-soft">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <CalendarDays size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
          {formatCampDate(c.camp_date, hi)}
        </p>

        {from ? (
          <p className="flex items-center gap-2">
            <Clock size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
            {to ? `${from} – ${to}` : from}
          </p>
        ) : null}

        {c.venue || c.village ? (
          <p className="flex items-start gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span>{[c.venue, c.village, c.block, c.district].filter(Boolean).join(', ')}</span>
          </p>
        ) : null}
      </div>

      {c.services?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {c.services.map((s) => (
            <Pill key={s} tone="neutral">
              {s}
            </Pill>
          ))}
        </div>
      ) : null}

      {c.organiser || c.source ? (
        <p className="mt-4 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {c.organiser ? `${t('Organised by ', 'आयोजक ')}${c.organiser}` : null}
          {c.organiser && c.source ? ' · ' : null}
          {c.source}
        </p>
      ) : null}

      {c.contact_phone ? (
        <div className="mt-5 border-t border-rule pt-4">
          <Btn
            as="a"
            href={`tel:${String(c.contact_phone).replace(/[^\d+]/g, '')}`}
            variant="primary"
          >
            <Phone size={16} aria-hidden="true" />
            {t('Confirm by phone', 'फ़ोन पर पुष्टि करें')}
          </Btn>
        </div>
      ) : null}
    </Card>
  );
}
