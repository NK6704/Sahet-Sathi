import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowLeft,
  Phone,
  Send,
  Check,
  Navigation,
  Info,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { useAsync } from '@/lib/useAsync';
import { getSOSById, acknowledgeSOS, resolveSOS } from '@/services/api';
import { AshaShell } from '@/components/asha/AshaShell';
import { HospitalCard } from '@/components/care/HospitalCard';
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
import { Detail, relativeTime, formatDate } from '@/components/asha/parts';

/* =============================================================
   /asha/alerts/:id — one emergency, and what to do about it.

   Three things on this page are deliberately not softened:

     1. The hospital list is the snapshot taken when the SOS was
        raised, not a fresh search, so it is what the family was
        actually told at the time. The server says so in its own
        `note` and that sentence is printed as it arrives.
     2. A delivery row with status 'sent' means the SMS gateway
        accepted the message. It is not a delivery receipt, and it
        is never worded as one.
     3. Closing an emergency needs a written outcome. The server
        refuses without one; this page refuses first, and says why.
   ============================================================= */

const SOS_STATUS = {
  open: { en: 'Open', hi: 'खुला', tone: 'siren' },
  acknowledged: { en: 'Picked up', hi: 'ले लिया गया', tone: 'amber' },
  resolved: { en: 'Closed', hi: 'बंद', tone: 'seal' },
  cancelled: { en: 'Cancelled', hi: 'रद्द', tone: 'neutral' },
};

const DELIVERY_STATUS = {
  sent: { en: 'Accepted by the gateway', hi: 'गेटवे ने स्वीकार किया', tone: 'seal' },
  skipped: { en: 'Not sent', hi: 'नहीं भेजा गया', tone: 'neutral' },
  failed: { en: 'Failed', hi: 'विफल', tone: 'siren' },
};

const CHANNEL = {
  in_app: { en: 'In the app', hi: 'ऐप में' },
  sms: { en: 'SMS', hi: 'एसएमएस' },
};

const RECIPIENT_KIND = {
  asha: { en: 'ASHA worker', hi: 'आशा कार्यकर्ता' },
  contact: { en: 'Family contact', hi: 'परिवार का संपर्क' },
  admin: { en: 'Administrator', hi: 'प्रशासक' },
};

/** The server's own note, printed verbatim. */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

export function AshaAlertDetail({ params }) {
  const { profile } = useAuth();
  const { language } = useAppState();
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);
  const [, navigate] = useLocation();

  const id = params?.id;
  const { data, error, loading, reload } = useAsync(() => getSOSById(id), [id], { skip: !id });

  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const sos = data?.sos ?? null;
  const deliveries = Array.isArray(data?.deliveries) ? data.deliveries : [];
  const hospitals = Array.isArray(data?.nearestHospitals) ? data.nearestHospitals : [];

  const villageName = useMemo(() => {
    const map = {};
    for (const v of profile?.assignedVillages ?? []) {
      if (v?.id && v?.name) map[v.id] = v.name;
    }
    return map;
  }, [profile?.assignedVillages]);

  const meta = sos ? SOS_STATUS[sos.status] || { en: 'Unknown', hi: 'अज्ञात', tone: 'neutral' } : null;
  const lat = sos ? Number(sos.latitude) : NaN;
  const lng = sos ? Number(sos.longitude) : NaN;
  const mappable = Number.isFinite(lat) && Number.isFinite(lng);
  const village = sos?.villageId ? villageName[sos.villageId] : null;

  async function acknowledge() {
    setBusy(true);
    setSaveError(null);
    try {
      await acknowledgeSOS(id);
      await reload();
    } catch (e) {
      setSaveError(
        e?.message ||
          t('That could not be recorded. Try again.', 'यह दर्ज नहीं हो सका। फिर कोशिश करें।'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (!outcome.trim()) {
      setSaveError(
        t(
          'Write what happened before closing this. An emergency closed with no outcome records nothing.',
          'बंद करने से पहले लिखें कि क्या हुआ। बिना परिणाम बंद की गई आपात सूचना कुछ दर्ज नहीं करती।',
        ),
      );
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await resolveSOS(id, outcome.trim());
      setOutcome('');
      await reload();
    } catch (e) {
      setSaveError(
        e?.message ||
          t('That could not be recorded. Try again.', 'यह दर्ज नहीं हो सका। फिर कोशिश करें।'),
      );
    } finally {
      setBusy(false);
    }
  }

  const active = sos?.status === 'open' || sos?.status === 'acknowledged';

  return (
    <AshaShell
      eyebrow={t('Register 002 · Emergency', 'रजिस्टर 002 · आपात सूचना')}
      title={
        loading
          ? t('Loading…', 'लोड हो रहा है…')
          : sos?.category || t('Emergency', 'आपात सूचना')
      }
      action={
        <Btn as={Link} href="/asha/alerts" variant="outline">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('All emergencies', 'सभी आपात सूचनाएँ')}
        </Btn>
      }
    >
      {loading ? (
        <LoadingState label={t('Loading this emergency', 'यह आपात सूचना लोड हो रही है')} rows={3} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load this emergency", 'यह आपात सूचना लोड नहीं हुई')}
          body={error.message || undefined}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : !sos ? (
        <EmptyState
          title={t('Not found', 'नहीं मिली')}
          body={t(
            'No emergency with that reference is in a village assigned to you. You can only open the ones raised in your own villages.',
            'इस पहचान की कोई आपात सूचना आपके गाँवों में नहीं है। आप केवल अपने गाँवों की सूचनाएँ खोल सकती हैं।',
          )}
          action={
            <Btn as={Link} href="/asha/alerts" variant="primary">
              {t('Back to emergencies', 'आपात सूचनाओं पर लौटें')}
            </Btn>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <Card tone={meta.tone} className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={meta.tone}>{t(meta.en, meta.hi)}</Pill>
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                  {relativeTime(sos.createdAt, hi)}
                </span>
              </div>

              {sos.symptoms ? (
                <p className="mt-5 text-[1.05rem] leading-relaxed text-ink">{sos.symptoms}</p>
              ) : (
                <p className="mt-5 text-[0.95rem] leading-relaxed text-ink-faint">
                  {t(
                    'No description was typed when this was raised. Call the number below and ask.',
                    'उठाते समय कोई विवरण नहीं लिखा गया। नीचे दिए नंबर पर कॉल कर पूछें।',
                  )}
                </p>
              )}

              {sos.locationNote ? (
                <p className="mt-4 border-l-2 border-rule pl-3 text-[0.9rem] leading-relaxed text-ink-soft">
                  {sos.locationNote}
                </p>
              ) : null}

              <div className="mt-7 grid gap-5 border-t border-rule pt-6 sm:grid-cols-2">
                <Detail label={t('Person', 'व्यक्ति')} value={sos.patientName} />
                <Detail label={t('Callback number', 'कॉलबैक नंबर')} value={sos.contactPhone} mono />
                <Detail label={t('Village', 'गाँव')} value={village} />
                <Detail label={t('What was reported', 'क्या बताया गया')} value={sos.category} />
                <Detail
                  label={t('Raised', 'उठाई गई')}
                  value={sos.createdAt ? formatDate(sos.createdAt, hi) : null}
                />
                <Detail
                  label={t('Picked up', 'ले ली गई')}
                  value={sos.acknowledgedAt ? formatDate(sos.acknowledgedAt, hi) : null}
                />
                <Detail
                  label={t('Closed', 'बंद की गई')}
                  value={sos.resolvedAt ? formatDate(sos.resolvedAt, hi) : null}
                />
                <Detail
                  label={t('Location shared', 'जगह साझा की गई')}
                  value={
                    mappable
                      ? Number.isFinite(Number(sos.accuracyM))
                        ? t(
                            `Yes, accurate to about ${Math.round(Number(sos.accuracyM))} m`,
                            `हाँ, लगभग ${Math.round(Number(sos.accuracyM))} मीटर तक सही`,
                          )
                        : t('Yes', 'हाँ')
                      : t('No', 'नहीं')
                  }
                />
              </div>

              {sos.outcome ? (
                <div className="mt-6 border-t border-rule pt-6">
                  <Eyebrow>{t('Outcome recorded', 'दर्ज परिणाम')}</Eyebrow>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink">{sos.outcome}</p>
                </div>
              ) : null}

              {!mappable ? (
                <p className="mt-6 border-t border-rule pt-6 text-[0.85rem] leading-relaxed text-ink-faint">
                  {t(
                    'No location was shared with this emergency, so no map can be opened and no distance can be measured. The village centre is deliberately not used instead.',
                    'इस आपात सूचना के साथ जगह साझा नहीं हुई, इसलिए न नक्शा खुलेगा न दूरी नापी जा सकती है। गाँव का केंद्र जानबूझकर इसकी जगह नहीं लिया जाता।',
                  )}
                </p>
              ) : null}
            </Card>

            {/* Who was actually messaged, per recipient. */}
            <Card className="p-6">
              <Eyebrow>{t('Who was contacted', 'किसे संदेश गया')}</Eyebrow>
              {deliveries.length === 0 ? (
                <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-faint">
                  {t(
                    'No delivery record is attached to this emergency.',
                    'इस आपात सूचना के साथ कोई भेजने का रिकॉर्ड दर्ज नहीं है।',
                  )}
                </p>
              ) : (
                <>
                  <ul className="mt-5 space-y-4">
                    {deliveries.map((d, i) => {
                      const dm =
                        DELIVERY_STATUS[d.status] || {
                          en: d.status || 'Unknown',
                          hi: 'अज्ञात',
                          tone: 'neutral',
                        };
                      const channel = CHANNEL[d.channel];
                      const kind = RECIPIENT_KIND[d.recipientKind];
                      return (
                        <li
                          key={d.id ?? `${d.channel}-${i}`}
                          className="border-t border-rule pt-4 first:border-0 first:pt-0"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={dm.tone}>{t(dm.en, dm.hi)}</Pill>
                            {channel ? <Pill>{t(channel.en, channel.hi)}</Pill> : null}
                            {kind ? (
                              <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                                {t(kind.en, kind.hi)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-[0.9rem] font-semibold text-ink">
                            {d.recipientName || t('Name not recorded', 'नाम दर्ज नहीं')}
                            {d.recipientPhone ? (
                              <span className="ml-2 font-mono text-[0.8rem] font-normal text-ink-faint">
                                {d.recipientPhone}
                              </span>
                            ) : null}
                          </p>
                          {d.reason ? (
                            <p className="mt-1 text-[0.85rem] leading-relaxed text-ink-soft">
                              {d.reason}
                            </p>
                          ) : null}
                          {d.sentAt ? (
                            <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-faint">
                              {relativeTime(d.sentAt, hi)}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-5 border-t border-rule pt-4 text-[0.82rem] leading-relaxed text-ink-faint">
                    {t(
                      'Accepted means the message was handed to the gateway. It is not a confirmation that anyone read it.',
                      'स्वीकार का मतलब है संदेश गेटवे को दे दिया गया। यह इसकी पुष्टि नहीं है कि किसी ने पढ़ा।',
                    )}
                  </p>
                </>
              )}
            </Card>

            {/* The hospital list as it stood when the SOS was raised. */}
            <section>
              <Eyebrow>
                {t('Hospitals the family was given', 'परिवार को बताए गए अस्पताल')}
              </Eyebrow>
              <div className="mt-4 space-y-4">
                <ServerNote>{data?.note}</ServerNote>
                {hospitals.length === 0 ? (
                  <Card className="p-5">
                    <p className="text-[0.9rem] leading-relaxed text-ink-soft">
                      {t(
                        'No hospital list was attached to this emergency. Nothing has been substituted for it here.',
                        'इस आपात सूचना के साथ कोई अस्पताल सूची नहीं जुड़ी थी। यहाँ उसकी जगह कुछ नहीं रखा गया है।',
                      )}
                    </p>
                  </Card>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {hospitals.map((h, i) => (
                      <HospitalCard
                        key={h.id ?? h.facilityId ?? i}
                        hospital={h}
                        hi={hi}
                        index={String(i + 1).padStart(2, '0')}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Move it along */}
            {active ? (
              <Card tone="asha" className="p-6">
                <Eyebrow>{t('Record what you did', 'आपने क्या किया, दर्ज करें')}</Eyebrow>

                <label className="mt-5 block">
                  <span className="text-sm font-semibold text-ink-soft">
                    {t('Outcome — needed to close this', 'परिणाम — बंद करने के लिए ज़रूरी')}
                  </span>
                  <textarea
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    rows={3}
                    className="field mt-2 w-full resize-y py-3"
                    placeholder={t(
                      'Reached the house, took her to the CHC by shared jeep. Admitted.',
                      'घर पहुँची, साझा जीप से CHC ले गई। भर्ती हो गई।',
                    )}
                  />
                </label>

                {saveError ? (
                  <p className="mt-4 text-sm font-semibold text-siren" role="alert">
                    {saveError}
                  </p>
                ) : null}

                <div className="mt-6 flex flex-wrap gap-3 border-t border-rule pt-6">
                  {sos.status === 'open' ? (
                    <Btn variant="siren" onClick={acknowledge} disabled={busy}>
                      <Check size={16} aria-hidden="true" />
                      {t('I am on it', 'मैं देख रही हूँ')}
                    </Btn>
                  ) : null}
                  <Btn variant="primary" onClick={resolve} disabled={busy}>
                    {busy ? t('Saving…', 'सेव हो रहा है…') : t('Close with this outcome', 'इस परिणाम के साथ बंद करें')}
                  </Btn>
                </div>
              </Card>
            ) : (
              <Card className="p-6">
                <Stamp
                  kind={sos.status === 'resolved' ? 'verified' : 'none'}
                  label={t(meta.en, meta.hi)}
                />
                <p className="mt-4 text-[0.9rem] leading-relaxed text-ink-soft">
                  {sos.status === 'resolved'
                    ? t(
                        'This emergency is closed. The record stays so it can be looked at again.',
                        'यह आपात सूचना बंद है। रिकॉर्ड बना रहता है ताकि फिर देखा जा सके।',
                      )
                    : t(
                        'This emergency was cancelled. The record stays rather than being deleted.',
                        'यह आपात सूचना रद्द हुई। रिकॉर्ड मिटाया नहीं जाता।',
                      )}
                </p>
              </Card>
            )}
          </div>

          {/* Actions rail */}
          <aside className="space-y-4">
            {sos.contactPhone ? (
              <Card tone="seal" className="p-5">
                <Eyebrow>{t('Reach them', 'संपर्क करें')}</Eyebrow>
                <Btn
                  as="a"
                  href={`tel:${String(sos.contactPhone).replace(/[^\d+]/g, '')}`}
                  variant="primary"
                  className="mt-4 w-full"
                >
                  <Phone size={17} aria-hidden="true" />
                  {sos.contactPhone}
                </Btn>
              </Card>
            ) : (
              <Card className="p-5">
                <Eyebrow>{t('Reach them', 'संपर्क करें')}</Eyebrow>
                <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-faint">
                  {t(
                    'No callback number was recorded with this emergency.',
                    'इस आपात सूचना के साथ कोई कॉलबैक नंबर दर्ज नहीं हुआ।',
                  )}
                </p>
              </Card>
            )}

            {mappable ? (
              <Card className="p-5">
                <Eyebrow>{t('Where they are', 'वे कहाँ हैं')}</Eyebrow>
                <Btn
                  as="a"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  variant="outline"
                  className="mt-4 w-full"
                >
                  <Navigation size={16} aria-hidden="true" />
                  {t('Open directions', 'रास्ता खोलें')}
                </Btn>
                <p className="mt-3 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.08em] text-ink-faint">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </p>
              </Card>
            ) : null}

            <Card tone="asha" className="p-5">
              <Eyebrow>{t('Next step', 'अगला कदम')}</Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {t(
                  'If they need to be seen at a facility, raise a referral so it is on record.',
                  'अगर सुविधा पर दिखाना है, तो रेफरल दर्ज करें ताकि रिकॉर्ड रहे।',
                )}
              </p>
              <Btn
                variant="asha"
                className="mt-4 w-full"
                onClick={() => {
                  const p = new URLSearchParams({ new: '1' });
                  if (sos.patientName) p.set('name', sos.patientName);
                  if (village) p.set('village', village);
                  if (sos.contactPhone) p.set('phone', sos.contactPhone);
                  if (sos.category) p.set('reason', sos.category);
                  // The SOS fan-out writes an asha_alerts row, and that is
                  // the id a referral can be tied to. The SOS id itself is
                  // not one, so it is not passed as one.
                  if (sos.alertId) p.set('alert', sos.alertId);
                  navigate(`/asha/referrals?${p.toString()}`);
                }}
              >
                <Send size={16} aria-hidden="true" />
                {t('Raise a referral', 'रेफरल बनाएँ')}
              </Btn>
              <Btn as={Link} href="/asha/messages" variant="outline" className="mt-3 w-full">
                <MessageSquare size={16} aria-hidden="true" />
                {t('Message the household', 'परिवार को संदेश भेजें')}
              </Btn>
            </Card>

            <Card className="p-5">
              <Stamp kind="verified" label={t('Record', 'रिकॉर्ड')} source={t('Audit logged', 'ऑडिट दर्ज')} />
              <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
                {t(
                  'Picking this up and closing it are both recorded against your account, with the time.',
                  'इसे लेना और बंद करना, दोनों समय के साथ आपके खाते में दर्ज होते हैं।',
                )}
              </p>
            </Card>
          </aside>
        </div>
      )}
    </AshaShell>
  );
}
