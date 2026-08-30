import React, { useMemo, useState } from 'react';
import { Phone, MapPin, Clock, Ambulance, Navigation } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { listFacilities } from '@/services/asha';
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
import { FilterBar } from '@/components/asha/parts';

/* =============================================================
   /asha/healthcare — the facility directory.

   The rule that shapes this page: never fabricate facility
   information. A facility with no confirmed source is shown behind
   a dotted "not confirmed" stamp, not quietly presented as fact.
   Sending someone 22 km to a hospital that isn't there is the worst
   thing this product could do.
   ============================================================= */

const KINDS = [
  { value: 'all', label: 'All', label_hi: 'सभी' },
  { value: 'sub_centre', label: 'Sub-centre', label_hi: 'उप-केंद्र' },
  { value: 'phc', label: 'PHC', label_hi: 'PHC' },
  { value: 'chc', label: 'CHC', label_hi: 'CHC' },
  { value: 'district_hospital', label: 'District hospital', label_hi: 'ज़िला अस्पताल' },
  { value: 'pharmacy', label: 'Pharmacy', label_hi: 'दवा दुकान' },
];

const KIND_LABEL = {
  sub_centre: ['Sub-centre', 'उप-केंद्र'],
  phc: ['Primary Health Centre', 'प्राथमिक स्वास्थ्य केंद्र'],
  chc: ['Community Health Centre', 'सामुदायिक स्वास्थ्य केंद्र'],
  district_hospital: ['District hospital', 'ज़िला अस्पताल'],
  medical_college: ['Medical college', 'मेडिकल कॉलेज'],
  private_clinic: ['Private clinic', 'निजी क्लिनिक'],
  pharmacy: ['Pharmacy', 'दवा दुकान'],
  diagnostic_lab: ['Diagnostic lab', 'जाँच केंद्र'],
};

export function AshaHealthcare() {
  const { profile } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');

  const { data, error, loading, reload } = useAsync(() => listFacilities({}), []);

  const rows = useMemo(() => {
    let out = data ?? [];
    if (kind !== 'all') out = out.filter((f) => f.kind === kind);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((f) =>
        [f.name, f.village, f.block, f.district, ...(f.services || [])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return out;
  }, [data, kind, query]);

  const unverifiedCount = (data ?? []).filter((f) => f.verification !== 'verified').length;

  return (
    <AshaShell
      eyebrow={t('Register 004 · Facilities', 'रजिस्टर 004 · सुविधाएँ')}
      title={t('Where to send people', 'कहाँ भेजें')}
      sub={t(
        'Only facilities on record appear here. Anything not confirmed against an official registry says so.',
        'यहाँ केवल दर्ज सुविधाएँ हैं। जो सरकारी सूची से पुष्ट नहीं, वह साफ़ लिखा है।',
      )}
    >
      {unverifiedCount > 0 && !loading ? (
        <Card tone="amber" className="mb-6 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Stamp kind="inferred" label={t('Not confirmed', 'पुष्ट नहीं')} />
            <p className="min-w-0 flex-1 text-[0.9rem] leading-relaxed text-ink-soft">
              {t(
                `${unverifiedCount} of these have not been checked against the NHM facility registry. Confirm by phone before sending anyone.`,
                `इनमें से ${unverifiedCount} NHM सूची से जाँची नहीं गई हैं। किसी को भेजने से पहले फ़ोन पर पुष्टि करें।`,
              )}
            </p>
          </div>
        </Card>
      ) : null}

      <FilterBar
        options={KINDS.map((k) => ({
          value: k.value,
          label: hi ? k.label_hi : k.label,
          count:
            k.value === 'all'
              ? (data ?? []).length
              : (data ?? []).filter((f) => f.kind === k.value).length,
        }))}
        value={kind}
        onChange={setKind}
        search={query}
        onSearch={setQuery}
        searchPlaceholder={t('Search name or service', 'नाम या सेवा खोजें')}
        label={t('Type', 'प्रकार')}
      />

      {loading ? (
        <LoadingState label={t('Loading facilities', 'सुविधाएँ लोड हो रही हैं')} rows={3} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load the directory", 'सूची लोड नहीं हुई')}
          body={t(
            'The facility list could not be fetched. If someone needs care now, call 108.',
            'सूची नहीं मिली। अगर अभी इलाज चाहिए तो 108 पर कॉल करें।',
          )}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('No facilities found', 'कोई सुविधा नहीं मिली')}
          body={t(
            'Nothing on record matches that. Rather than guess, this page shows nothing — check with your ANM or the block office.',
            'इससे मेल कुछ नहीं मिला। अनुमान लगाने के बजाय यह खाली दिखता है — अपनी ANM या ब्लॉक कार्यालय से पूछें।',
          )}
          action={
            query ? (
              <Btn variant="outline" onClick={() => setQuery('')}>
                {t('Clear search', 'खोज हटाएँ')}
              </Btn>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((f) => (
            <FacilityCard key={f.id} facility={f} hi={hi} />
          ))}
        </div>
      )}
    </AshaShell>
  );
}

function FacilityCard({ facility: f, hi }) {
  const t = (en, dev) => (hi ? dev : en);
  const verified = f.verification === 'verified';
  const kindPair = KIND_LABEL[f.kind] || [f.kind, f.kind];

  return (
    <Card tone={verified ? 'seal' : 'amber'} lift className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{hi ? kindPair[1] : kindPair[0]}</Eyebrow>
          <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">{f.name}</h3>
        </div>
        <Stamp
          kind={verified ? 'verified' : 'inferred'}
          label={verified ? t('Verified', 'पुष्ट') : t('Not confirmed', 'पुष्ट नहीं')}
        />
      </div>

      <div className="mt-4 space-y-2 text-[0.875rem] text-ink-soft">
        {f.address || f.village ? (
          <p className="flex items-start gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span>
              {[f.address, f.village, f.block, f.district].filter(Boolean).join(', ')}
              {typeof f.distance_km === 'number' ? (
                <span className="ml-2 font-mono text-[0.75rem] text-ink-faint">
                  {f.distance_km} km
                </span>
              ) : null}
            </span>
          </p>
        ) : null}

        <p className="flex items-center gap-2">
          <Clock size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
          {f.open_24x7 ? t('Open 24 hours', '24 घंटे खुला') : t('Daytime hours', 'दिन में खुला')}
        </p>

        {f.has_ambulance ? (
          <p className="flex items-center gap-2 font-semibold text-seal">
            <Ambulance size={14} className="shrink-0" aria-hidden="true" />
            {t('Ambulance available', 'एम्बुलेंस उपलब्ध')}
          </p>
        ) : null}
      </div>

      {f.services?.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {f.services.slice(0, 5).map((s) => (
            <Pill key={s} tone="neutral">
              {s}
            </Pill>
          ))}
        </div>
      ) : null}

      {/* The source line is not fine print. It is the reason a worker
          can trust or distrust the row above it. */}
      {f.source ? (
        <p className="mt-4 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
          {t('Source: ', 'स्रोत: ')}
          {f.source}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
        {f.phone ? (
          <Btn as="a" href={`tel:${String(f.phone).replace(/[^\d+]/g, '')}`} variant="primary">
            <Phone size={16} aria-hidden="true" />
            {t('Call', 'कॉल')}
          </Btn>
        ) : (
          <span className="flex items-center text-[0.8rem] text-ink-faint">
            {t('No phone number on record', 'फ़ोन नंबर दर्ज नहीं')}
          </span>
        )}

        {f.latitude && f.longitude ? (
          <Btn
            as="a"
            href={`https://www.google.com/maps/search/?api=1&query=${f.latitude},${f.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            <Navigation size={16} aria-hidden="true" />
            {t('Directions', 'रास्ता')}
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}
