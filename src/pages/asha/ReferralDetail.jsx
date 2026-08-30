import React, { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Phone, Hospital, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import {
  getReferral,
  updateReferral,
  REFERRAL_STATUSES,
  statusMeta,
  severityMeta,
} from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Stamp,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';
import {
  StatusBadge,
  SeverityBadge,
  Detail,
  formatDate,
  relativeTime,
} from '@/components/asha/parts';

/* =============================================================
   /asha/referrals/:id — one referral, its history, and the next
   status it can move to.
   ============================================================= */

export function AshaReferralDetail({ params }) {
  const { profile } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const id = params?.id;
  const { data: ref, error, loading, reload, setData } = useAsync(() => getReferral(id), [id]);

  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function move(status) {
    setBusy(true);
    setErr(null);
    try {
      const patch = { status };
      if (note.trim()) patch.notes = note.trim();
      if (status === 'resolved') {
        if (!outcome.trim()) {
          setErr(
            t(
              'Write what happened before closing this. A resolved referral with no outcome is not much use later.',
              'बंद करने से पहले परिणाम लिखें। बिना परिणाम का रेफरल बाद में काम नहीं आता।',
            ),
          );
          setBusy(false);
          return;
        }
        patch.outcome = outcome.trim();
      }
      const next = await updateReferral(id, patch);
      setData((prev) => ({ ...(prev ?? {}), ...(next ?? patch) }));
      setNote('');
    } catch (e) {
      setErr(e.message || t('Could not update.', 'बदलाव सेव नहीं हुआ।'));
    } finally {
      setBusy(false);
    }
  }

  const terminal = ref && ['resolved', 'cancelled'].includes(ref.status);
  const meta = ref ? severityMeta(ref.urgency) : null;

  // What this referral can become next. A worker should not have to
  // read a state diagram to find the right button.
  const nextStates = (() => {
    if (!ref) return [];
    const order = ['pending', 'acknowledged', 'contacted', 'referred', 'in_progress', 'resolved'];
    const at = order.indexOf(ref.status);
    if (at === -1) return ['pending'];
    return order.slice(at + 1);
  })();

  return (
    <AshaShell
      eyebrow={t('Register 003 · Referral', 'रजिस्टर 003 · रेफरल')}
      title={loading ? t('Loading…', 'लोड हो रहा है…') : ref?.patient_name || t('Referral', 'रेफरल')}
      action={
        <Btn as={Link} href="/asha/referrals" variant="outline">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('All referrals', 'सभी रेफरल')}
        </Btn>
      }
    >
      {loading ? (
        <LoadingState label={t('Loading referral', 'रेफरल लोड हो रहा है')} rows={3} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load this referral", 'रेफरल लोड नहीं हुआ')}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : !ref ? (
        <EmptyState
          title={t('Referral not found', 'रेफरल नहीं मिला')}
          body={t(
            'You can only open referrals you raised yourself.',
            'आप केवल अपने बनाए रेफरल खोल सकती हैं।',
          )}
          action={
            <Btn as={Link} href="/asha/referrals" variant="primary">
              {t('Back to referrals', 'रेफरल पर लौटें')}
            </Btn>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <Card tone={meta.tone} className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={ref.status} hi={hi} />
                <SeverityBadge severity={ref.urgency} hi={hi} />
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                  {t('Raised ', 'दर्ज ')}
                  {formatDate(ref.referred_on, hi)}
                </span>
              </div>

              <p className="mt-5 text-[1.05rem] font-semibold leading-snug text-ink">{ref.reason}</p>
              {ref.symptoms ? (
                <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{ref.symptoms}</p>
              ) : null}

              <div className="mt-7 grid gap-5 border-t border-rule pt-6 sm:grid-cols-2">
                <Detail label={t('Name', 'नाम')} value={ref.patient_name} />
                <Detail
                  label={t('Age and gender', 'उम्र और लिंग')}
                  value={[ref.patient_age, ref.patient_gender].filter(Boolean).join(' · ') || null}
                />
                <Detail label={t('Village', 'गाँव')} value={ref.village} />
                <Detail label={t('Facility', 'सुविधा')} value={ref.facility_name} />
                <Detail label={t('Visited on', 'गए')} value={ref.visited_on ? formatDate(ref.visited_on, hi) : null} />
                <Detail label={t('Status', 'स्थिति')} value={hi ? statusMeta(ref.status).label_hi : statusMeta(ref.status).label} />
              </div>

              {ref.outcome ? (
                <div className="mt-6 border-t border-rule pt-6">
                  <Eyebrow>{t('Outcome', 'परिणाम')}</Eyebrow>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink">{ref.outcome}</p>
                </div>
              ) : null}

              {ref.notes ? (
                <div className="mt-6 border-t border-rule pt-6">
                  <Eyebrow>{t('Notes', 'नोट')}</Eyebrow>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{ref.notes}</p>
                </div>
              ) : null}
            </Card>

            {/* History */}
            {Array.isArray(ref.referral_events) && ref.referral_events.length > 0 ? (
              <Card className="p-6">
                <Eyebrow>{t('History', 'इतिहास')}</Eyebrow>
                <ol className="mt-5 space-y-4">
                  {[...ref.referral_events]
                    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                    .map((ev) => (
                      <li key={ev.id} className="flex gap-4">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-asha" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-[0.9rem] font-semibold text-ink">
                            {hi ? statusMeta(ev.to_status).label_hi : statusMeta(ev.to_status).label}
                          </p>
                          <p className="mt-0.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                            {relativeTime(ev.created_at, hi)}
                          </p>
                          {ev.note ? (
                            <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-soft">{ev.note}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                </ol>
              </Card>
            ) : null}

            {/* Move it along */}
            {!terminal ? (
              <Card tone="asha" className="p-6">
                <Eyebrow>{t('Update this referral', 'रेफरल अपडेट करें')}</Eyebrow>

                <label className="mt-5 block">
                  <span className="text-sm font-semibold text-ink-soft">
                    {t('Note (optional)', 'नोट (वैकल्पिक)')}
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="field mt-2 w-full resize-y py-3"
                  />
                </label>

                {nextStates.includes('resolved') ? (
                  <label className="mt-5 block">
                    <span className="text-sm font-semibold text-ink-soft">
                      {t('Outcome — needed to resolve', 'परिणाम — बंद करने के लिए ज़रूरी')}
                    </span>
                    <textarea
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value)}
                      rows={2}
                      className="field mt-2 w-full resize-y py-3"
                      placeholder={t(
                        'Seen at the PHC. Iron tablets given, review in one month.',
                        'PHC पर देखा गया। आयरन की गोलियाँ दी गईं, एक महीने में जाँच।',
                      )}
                    />
                  </label>
                ) : null}

                {err ? (
                  <p className="mt-4 text-sm font-semibold text-siren" role="alert">
                    {err}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap gap-3 border-t border-rule pt-6">
                  {nextStates.map((s) => {
                    const m = REFERRAL_STATUSES.find((x) => x.value === s);
                    return (
                      <Btn
                        key={s}
                        variant={s === 'resolved' ? 'primary' : 'outline'}
                        onClick={() => move(s)}
                        disabled={busy}
                      >
                        {s === 'resolved' ? <Check size={16} aria-hidden="true" /> : null}
                        {hi ? m.label_hi : m.label}
                      </Btn>
                    );
                  })}
                  <Btn
                    variant="outline"
                    onClick={() => move('cancelled')}
                    disabled={busy}
                    className="ml-auto"
                  >
                    {t('Cancel referral', 'रेफरल रद्द करें')}
                  </Btn>
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <Stamp kind={ref.status === 'resolved' ? 'verified' : 'none'} label={hi ? statusMeta(ref.status).label_hi : statusMeta(ref.status).label} />
                <p className="mt-4 text-[0.9rem] leading-relaxed text-ink-soft">
                  {ref.status === 'resolved'
                    ? t(
                        'This referral is closed. The record stays so you can refer back to it.',
                        'यह रेफरल बंद है। रिकॉर्ड बना रहता है ताकि बाद में देख सकें।',
                      )
                    : t(
                        'This referral was cancelled. The record stays rather than being deleted.',
                        'यह रेफरल रद्द हुआ। रिकॉर्ड मिटाया नहीं जाता।',
                      )}
                </p>
              </Card>
            )}
          </div>

          <aside className="space-y-4">
            {ref.patient_phone ? (
              <Card tone="seal" className="p-5">
                <Eyebrow>{t('Reach them', 'संपर्क करें')}</Eyebrow>
                <Btn
                  as="a"
                  href={`tel:${ref.patient_phone.replace(/[^\d+]/g, '')}`}
                  variant="primary"
                  className="mt-4 w-full"
                >
                  <Phone size={17} aria-hidden="true" />
                  {ref.patient_phone}
                </Btn>
              </Card>
            ) : null}

            {ref.facility_name ? (
              <Card className="p-5">
                <Eyebrow>{t('Facility', 'सुविधा')}</Eyebrow>
                <p className="mt-2 flex items-start gap-2 text-[0.95rem] font-semibold leading-snug text-ink">
                  <Hospital size={16} className="mt-0.5 shrink-0 text-seal" aria-hidden="true" />
                  {ref.facility_name}
                </p>
                <Btn as={Link} href="/asha/healthcare" variant="outline" className="mt-4 w-full">
                  {t('Facility details', 'सुविधा का विवरण')}
                </Btn>
              </Card>
            ) : null}

            <Card className="p-5">
              <Stamp kind="verified" label={t('Audit logged', 'ऑडिट दर्ज')} />
              <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
                {t(
                  'Status changes are recorded by the database itself, with who changed them and when.',
                  'स्थिति के बदलाव डेटाबेस में दर्ज होते हैं — किसने और कब बदला, दोनों।',
                )}
              </p>
            </Card>
          </aside>
        </div>
      )}
    </AshaShell>
  );
}
