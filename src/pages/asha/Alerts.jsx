import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Phone, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { listAlerts, updateAlert, severityMeta } from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import { Btn, Card, LoadingState, EmptyState, ErrorState } from '@/components/ds';
import {
  SeverityBadge,
  AlertStatusBadge,
  FilterBar,
  relativeTime,
} from '@/components/asha/parts';

/* =============================================================
   /asha/alerts — everything routed to this worker.
   ============================================================= */

export function AshaAlerts() {
  const { profile, user } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);
  const ashaId = user?.id;

  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');

  const {
    data,
    error,
    loading: fetching,
    reload,
    setData,
  } = useAsync(() => listAlerts(ashaId), [ashaId], { skip: !ashaId });

  // No id yet means auth is still resolving. Showing "No alerts here"
  // to a worker who has six is worse than showing a spinner.
  const loading = fetching || !ashaId;

  const rows = useMemo(() => {
    let out = data ?? [];
    if (status === 'open') out = out.filter((a) => a.status === 'new' || a.status === 'acknowledged');
    else if (status !== 'all') out = out.filter((a) => a.status === status);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((a) =>
        [a.citizen_name, a.village, a.title, a.body]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(q)),
      );
    }
    return out;
  }, [data, status, search]);

  const count = (fn) => (data ?? []).filter(fn).length;

  const options = [
    { value: 'open', label: t('Open', 'खुली'), count: count((a) => a.status === 'new' || a.status === 'acknowledged') },
    { value: 'new', label: t('New', 'नई'), count: count((a) => a.status === 'new') },
    { value: 'actioned', label: t('Actioned', 'कार्रवाई हुई'), count: count((a) => a.status === 'actioned') },
    { value: 'closed', label: t('Closed', 'बंद'), count: count((a) => a.status === 'closed') },
    { value: 'all', label: t('All', 'सभी'), count: (data ?? []).length },
  ];

  async function acknowledge(id) {
    setData((prev) => prev?.map((a) => (a.id === id ? { ...a, status: 'acknowledged' } : a)));
    try {
      await updateAlert(id, { status: 'acknowledged' });
    } catch {
      reload();
    }
  }

  return (
    <AshaShell
      eyebrow={t('Register 002 · Alerts', 'रजिस्टर 002 · सूचनाएँ')}
      title={t('Alerts', 'सूचनाएँ')}
      sub={t(
        'Raised by families through the emergency button or the voice assistant, and by you.',
        'परिवारों द्वारा आपातकालीन बटन या आवाज़ सहायक से, और आपके द्वारा दर्ज।',
      )}
    >
      <FilterBar
        options={options}
        value={status}
        onChange={setStatus}
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('Search name or village', 'नाम या गाँव खोजें')}
        label={t('Filter', 'छाँटें')}
      />

      {loading ? (
        <LoadingState label={t('Loading alerts', 'सूचनाएँ लोड हो रही हैं')} rows={4} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load alerts", 'सूचनाएँ लोड नहीं हुईं')}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={
            search
              ? t('No alerts match that', 'कोई मेल नहीं मिला')
              : t('No alerts here', 'यहाँ कोई सूचना नहीं')
          }
          body={
            search
              ? t('Try a shorter search, or clear it to see everything.', 'छोटा शब्द आज़माएँ, या खोज हटाएँ।')
              : t(
                  'Nothing in this group right now. Try another filter.',
                  'इस समूह में कुछ नहीं। दूसरा फ़िल्टर आज़माएँ।',
                )
          }
          action={
            search ? (
              <Btn variant="outline" onClick={() => setSearch('')}>
                {t('Clear search', 'खोज हटाएँ')}
              </Btn>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((alert) => (
            <AlertRow key={alert.id} alert={alert} hi={hi} onAcknowledge={acknowledge} />
          ))}
        </div>
      )}
    </AshaShell>
  );
}

function AlertRow({ alert, hi, onAcknowledge }) {
  const t = (en, dev) => (hi ? dev : en);
  const meta = severityMeta(alert.severity);

  return (
    <Card tone={meta.tone} lift className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={alert.severity} hi={hi} />
            <AlertStatusBadge status={alert.status} hi={hi} />
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
              {relativeTime(alert.created_at, hi)}
            </span>
          </div>

          <h3 className="mt-3 text-lg font-semibold leading-snug text-ink">{alert.title}</h3>

          {alert.body ? (
            <p className="mt-2 max-w-2xl text-[0.9rem] leading-relaxed text-ink-soft">
              {alert.body}
            </p>
          ) : null}

          {alert.notes ? (
            <p className="mt-3 border-l-2 border-rule pl-3 text-[0.85rem] italic leading-relaxed text-ink-faint">
              {alert.notes}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.85rem] text-ink-faint">
            <span className="font-semibold text-ink-soft">{alert.citizen_name || '—'}</span>
            {alert.village ? (
              <span className="flex items-center gap-1.5">
                <MapPin size={13} aria-hidden="true" />
                {alert.village}
              </span>
            ) : null}
            {alert.citizen_phone ? (
              <a
                href={`tel:${alert.citizen_phone.replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 font-semibold text-seal hover:underline"
              >
                <Phone size={13} aria-hidden="true" />
                {alert.citizen_phone}
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {alert.status === 'new' ? (
            <Btn variant="outline" onClick={() => onAcknowledge(alert.id)}>
              {t('Acknowledge', 'देख लिया')}
            </Btn>
          ) : null}
          <Btn as={Link} href={`/asha/alerts/${alert.id}`} variant="outline">
            {t('Open', 'खोलें')}
            <ArrowRight size={15} aria-hidden="true" />
          </Btn>
        </div>
      </div>
    </Card>
  );
}
