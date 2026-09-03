import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Phone, MapPin, Navigation, Info, Send } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { useAsync } from '@/lib/useAsync';
import { getAshaSOSQueue, acknowledgeSOS } from '@/services/api';
import { AshaShell } from '@/components/asha/AshaShell';
import { Btn, Card, Pill, LoadingState, EmptyState, ErrorState } from '@/components/ds';
import { FilterBar, relativeTime } from '@/components/asha/parts';

/* =============================================================
   /asha/alerts — every emergency raised in the villages assigned
   to this account.

   The rows come from GET /api/asha/sos, which is scoped by
   asha_villages in the database rather than by anything this page
   does. A worker sees her own villages and nothing else, and when
   no village has been mapped to the account the server says so in
   its own words and this page prints that sentence rather than
   showing an unexplained empty list.
   ============================================================= */

const SOS_STATUS = {
  open: { en: 'Open', hi: 'खुला', tone: 'siren' },
  acknowledged: { en: 'Picked up', hi: 'ले लिया गया', tone: 'amber' },
  resolved: { en: 'Closed', hi: 'बंद', tone: 'seal' },
  cancelled: { en: 'Cancelled', hi: 'रद्द', tone: 'neutral' },
};

/** The server's own note, printed verbatim. */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="mb-6 flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

export function AshaAlerts() {
  const { profile } = useAuth();
  const { language } = useAppState();
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [ackError, setAckError] = useState(null);

  const { data, error, loading, reload } = useAsync(() => getAshaSOSQueue({ status }), [status]);

  /* An SOS row carries village_id, not a village name. The name is
     read from this account's own assignment; an id that is not in
     that list is left out rather than guessed at. */
  const villageName = useMemo(() => {
    const map = {};
    for (const v of profile?.assignedVillages ?? []) {
      if (v?.id && v?.name) map[v.id] = v.name;
    }
    return map;
  }, [profile?.assignedVillages]);

  const loaded = data?.sos ?? [];

  /* The queue endpoint has no text search, so this filters the rows
     already on screen and the label below says exactly that. */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return loaded;
    return loaded.filter((s) =>
      [
        s.patientName,
        s.category,
        s.symptoms,
        s.contactPhone,
        s.villageId ? villageName[s.villageId] : null,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [loaded, search, villageName]);

  const options = [
    { value: 'active', label: t('Still open', 'अभी खुली') },
    { value: 'open', label: t('Not picked up', 'किसी ने नहीं ली') },
    { value: 'acknowledged', label: t('Picked up', 'ले ली गई') },
    { value: 'resolved', label: t('Closed', 'बंद') },
    { value: 'cancelled', label: t('Cancelled', 'रद्द') },
    { value: 'all', label: t('All', 'सभी') },
  ];

  async function acknowledge(id) {
    setBusyId(id);
    setAckError(null);
    try {
      await acknowledgeSOS(id);
      await reload();
    } catch (e) {
      setAckError(
        e?.message ||
          t(
            'That could not be marked as picked up. Reload the queue.',
            'इसे "ले लिया" दर्ज नहीं किया जा सका। सूची फिर लोड करें।',
          ),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AshaShell
      eyebrow={t('Register 002 · Emergencies', 'रजिस्टर 002 · आपात सूचनाएँ')}
      title={t('Emergencies', 'आपात सूचनाएँ')}
      sub={t(
        'Raised by families with the emergency button in their app. Only the villages assigned to you appear here.',
        'परिवारों ने अपने ऐप के आपातकालीन बटन से उठाई हैं। यहाँ केवल आपको सौंपे गाँव दिखते हैं।',
      )}
    >
      <FilterBar
        options={options}
        value={status}
        onChange={setStatus}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search the rows below', 'नीचे दी सूची में खोजें')}
        label={t('Filter', 'छाँटें')}
      />

      {loading ? (
        <LoadingState label={t('Loading emergencies', 'आपात सूचनाएँ लोड हो रही हैं')} rows={4} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load the queue", 'सूची लोड नहीं हुई')}
          body={
            error.message ||
            t(
              'The connection dropped before the queue arrived. If someone needs help right now, call 108.',
              'सूची आने से पहले कनेक्शन टूट गया। अगर अभी किसी को मदद चाहिए तो 108 पर कॉल करें।',
            )
          }
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : (
        <>
          <ServerNote>{data?.note}</ServerNote>

          {ackError ? (
            <p className="mb-5 text-sm font-semibold text-siren" role="alert">
              {ackError}
            </p>
          ) : null}

          {loaded.length ? (
            <p className="mb-5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
              {t(
                `Showing ${loaded.length} of ${data?.count ?? loaded.length}`,
                `${data?.count ?? loaded.length} में से ${loaded.length} दिख रही हैं`,
              )}
              {data?.hasMore
                ? t(
                    ' · the rest load as this filter narrows',
                    ' · फ़िल्टर छोटा करने पर बाकी दिखेंगी',
                  )
                : null}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title={
                search
                  ? t('Nothing here matches that', 'इससे कुछ मेल नहीं खाता')
                  : t('Nothing in this group', 'इस समूह में कुछ नहीं')
              }
              body={
                search
                  ? t(
                      'This searches only the rows loaded above. Try a shorter word, or clear it.',
                      'यह खोज केवल ऊपर लोड हुई सूची में होती है। छोटा शब्द आज़माएँ, या खोज हटाएँ।',
                    )
                  : t(
                      'No emergency in your villages has this status. Try another filter.',
                      'आपके गाँवों में इस स्थिति की कोई आपात सूचना नहीं है। दूसरा फ़िल्टर आज़माएँ।',
                    )
              }
              action={
                search ? (
                  <Btn variant="outline" onClick={() => setSearch('')}>
                    {t('Clear search', 'खोज हटाएँ')}
                  </Btn>
                ) : (
                  <Btn variant="outline" onClick={reload}>
                    {t('Check again', 'फिर देखें')}
                  </Btn>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {rows.map((sos) => (
                <SosRow
                  key={sos.id}
                  sos={sos}
                  hi={hi}
                  villageName={villageName}
                  busy={busyId === sos.id}
                  onAcknowledge={acknowledge}
                />
              ))}
            </div>
          )}
        </>
      )}
    </AshaShell>
  );
}

function SosRow({ sos, hi, villageName, busy, onAcknowledge }) {
  const t = (en, dev) => (hi ? dev : en);
  const meta = SOS_STATUS[sos.status] || { en: 'Unknown', hi: 'अज्ञात', tone: 'neutral' };

  const lat = Number(sos.latitude);
  const lng = Number(sos.longitude);
  const mappable = Number.isFinite(lat) && Number.isFinite(lng);
  const village = sos.villageId ? villageName[sos.villageId] : null;

  /* 'sent' means the SMS gateway accepted the message. It is not a
     delivery receipt, so it is never worded as "delivered". */
  const deliveries = Array.isArray(sos.deliveries) ? sos.deliveries : [];
  const sentCount = deliveries.filter((d) => d.status === 'sent').length;

  return (
    <Card tone={meta.tone} lift className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={meta.tone}>{t(meta.en, meta.hi)}</Pill>
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
              {relativeTime(sos.createdAt, hi)}
            </span>
          </div>

          <h3 className="mt-3 text-lg font-semibold leading-snug text-ink">
            {sos.category || t('Emergency', 'आपातकाल')}
          </h3>

          {sos.symptoms ? (
            <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
              {sos.symptoms}
            </p>
          ) : null}

          {sos.outcome ? (
            <p className="mt-3 border-l-2 border-seal pl-3 text-[0.85rem] leading-relaxed text-ink-soft">
              <span className="font-semibold text-seal">{t('Outcome: ', 'परिणाम: ')}</span>
              {sos.outcome}
            </p>
          ) : null}

          {sos.locationNote ? (
            <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">{sos.locationNote}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.85rem] text-ink-faint">
            {sos.patientName ? (
              <span className="font-semibold text-ink-soft">{sos.patientName}</span>
            ) : null}
            {village ? (
              <span className="flex items-center gap-1.5">
                <MapPin size={13} aria-hidden="true" />
                {village}
              </span>
            ) : null}
            {sos.contactPhone ? (
              <a
                href={`tel:${String(sos.contactPhone).replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 font-semibold text-seal hover:underline"
              >
                <Phone size={13} aria-hidden="true" />
                {sos.contactPhone}
              </a>
            ) : (
              <span>{t('No callback number', 'कोई कॉलबैक नंबर नहीं')}</span>
            )}
            {mappable ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 font-semibold text-seal hover:underline"
              >
                <Navigation size={13} aria-hidden="true" />
                {t('Directions', 'रास्ता')}
              </a>
            ) : (
              <span>{t('No location shared', 'जगह साझा नहीं की गई')}</span>
            )}
            {deliveries.length ? (
              <span className="flex items-center gap-1.5">
                <Send size={13} aria-hidden="true" />
                {t(
                  `${sentCount} of ${deliveries.length} messages accepted`,
                  `${deliveries.length} में से ${sentCount} संदेश भेजने के लिए स्वीकार हुए`,
                )}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {sos.status === 'open' ? (
            <Btn variant="siren" onClick={() => onAcknowledge(sos.id)} disabled={busy}>
              {busy ? t('Saving…', 'सेव हो रहा है…') : t('I am on it', 'मैं देख रही हूँ')}
            </Btn>
          ) : null}
          <Btn as={Link} href={`/asha/alerts/${sos.id}`} variant="outline">
            {t('Open', 'खोलें')}
            <ArrowRight size={15} aria-hidden="true" />
          </Btn>
        </div>
      </div>
    </Card>
  );
}
