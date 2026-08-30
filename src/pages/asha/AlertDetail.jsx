import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Phone, Send, Check, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { getAlert, updateAlert, severityMeta } from '@/services/asha';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Stamp,
  InferenceNote,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';
import {
  SeverityBadge,
  AlertStatusBadge,
  Detail,
  relativeTime,
  formatDate,
} from '@/components/asha/parts';

/* =============================================================
   /asha/alerts/:id — one alert, and what to do about it.
   ============================================================= */

export function AshaAlertDetail({ params }) {
  const { profile } = useAuth();
  const hi = (profile?.language ?? 'Hindi') !== 'English';
  const t = (en, dev) => (hi ? dev : en);
  const [, navigate] = useLocation();

  const id = params?.id;
  const { data: alert, error, loading, reload, setData } = useAsync(() => getAlert(id), [id]);

  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  async function move(status) {
    setSaving(true);
    setSaveError(null);
    try {
      const patch = { status };
      if (note.trim()) patch.notes = note.trim();
      const next = await updateAlert(id, patch);
      setData((prev) => ({ ...(prev ?? {}), ...(next ?? patch) }));
      setNote('');
    } catch (e) {
      setSaveError(e.message || t('Could not save.', 'सेव नहीं हो सका।'));
    } finally {
      setSaving(false);
    }
  }

  const meta = alert ? severityMeta(alert.severity) : null;

  return (
    <AshaShell
      eyebrow={t('Register 002 · Alert', 'रजिस्टर 002 · सूचना')}
      title={loading ? t('Loading…', 'लोड हो रहा है…') : alert?.title || t('Alert', 'सूचना')}
      action={
        <Btn as={Link} href="/asha/alerts" variant="outline">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('All alerts', 'सभी सूचनाएँ')}
        </Btn>
      }
    >
      {loading ? (
        <LoadingState label={t('Loading alert', 'सूचना लोड हो रही है')} rows={3} />
      ) : error ? (
        <ErrorState
          title={t("Couldn't load this alert", 'सूचना लोड नहीं हुई')}
          onRetry={reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      ) : !alert ? (
        <EmptyState
          title={t('Alert not found', 'सूचना नहीं मिली')}
          body={t(
            'It may have been closed, or it belongs to another worker. You can only open alerts assigned to you.',
            'यह बंद हो चुकी है, या किसी अन्य कार्यकर्ता की है। आप केवल अपनी सूचनाएँ खोल सकती हैं।',
          )}
          action={
            <Btn as={Link} href="/asha/alerts" variant="primary">
              {t('Back to alerts', 'सूचनाओं पर लौटें')}
            </Btn>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <Card tone={meta.tone} className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={alert.severity} hi={hi} />
                <AlertStatusBadge status={alert.status} hi={hi} />
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                  {relativeTime(alert.created_at, hi)}
                </span>
              </div>

              {alert.body ? (
                <p className="mt-5 text-[1.05rem] leading-relaxed text-ink">{alert.body}</p>
              ) : null}

              {/* Where this came from matters. An alert generated from
                  an assistant conversation is the model's reading of
                  what someone said — not a clinical assessment. */}
              {alert.source === 'assistant' ? (
                <InferenceNote className="mt-6">
                  {t(
                    'This was raised from a voice conversation, so the summary above is the assistant’s reading of what was said. Confirm it with the family before acting on the detail.',
                    'यह आवाज़ बातचीत से बनी है, इसलिए ऊपर का सार सहायक की समझ है। कार्रवाई से पहले परिवार से पुष्टि करें।',
                  )}
                </InferenceNote>
              ) : null}

              <div className="mt-7 grid gap-5 border-t border-rule pt-6 sm:grid-cols-2">
                <Detail label={t('Person', 'व्यक्ति')} value={alert.citizen_name} />
                <Detail label={t('Village', 'गाँव')} value={alert.village} />
                <Detail label={t('Category', 'श्रेणी')} value={alert.category} />
                <Detail
                  label={t('Raised through', 'स्रोत')}
                  value={
                    { emergency_button: t('Emergency button', 'आपातकालीन बटन'),
                      assistant: t('Voice assistant', 'आवाज़ सहायक'),
                      manual: t('Entered by you', 'आपके द्वारा दर्ज') }[alert.source] || alert.source
                  }
                />
                <Detail
                  label={t('Acknowledged', 'देखा गया')}
                  value={alert.acknowledged_at ? formatDate(alert.acknowledged_at, hi) : null}
                />
                <Detail
                  label={t('Closed', 'बंद किया')}
                  value={alert.closed_at ? formatDate(alert.closed_at, hi) : null}
                />
              </div>

              {alert.notes ? (
                <div className="mt-6 border-t border-rule pt-6">
                  <Eyebrow>{t('Your notes', 'आपके नोट')}</Eyebrow>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{alert.notes}</p>
                </div>
              ) : null}
            </Card>

            {/* Record what happened */}
            <Card className="p-6">
              <Eyebrow>{t('Add a note', 'नोट जोड़ें')}</Eyebrow>
              <p className="mt-2 text-sm text-ink-faint">
                {t(
                  'What you did, or what the family said. Saved against this alert.',
                  'आपने क्या किया, या परिवार ने क्या कहा। इस सूचना के साथ सेव होगा।',
                )}
              </p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={t('Spoke to her husband. Going to the PHC today.', 'पति से बात हुई। आज PHC जाएँगे।')}
                className="field mt-4 w-full resize-y py-3"
              />

              {saveError ? (
                <p className="mt-3 text-sm font-semibold text-siren" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                {alert.status === 'new' ? (
                  <Btn variant="primary" onClick={() => move('acknowledged')} disabled={saving}>
                    <Check size={16} aria-hidden="true" />
                    {t('Acknowledge', 'देख लिया')}
                  </Btn>
                ) : null}
                {alert.status !== 'closed' ? (
                  <>
                    <Btn variant="asha" onClick={() => move('actioned')} disabled={saving}>
                      {t('Mark actioned', 'कार्रवाई दर्ज करें')}
                    </Btn>
                    <Btn variant="outline" onClick={() => move('closed')} disabled={saving}>
                      <X size={16} aria-hidden="true" />
                      {t('Close', 'बंद करें')}
                    </Btn>
                  </>
                ) : (
                  <Btn variant="outline" onClick={() => move('acknowledged')} disabled={saving}>
                    {t('Reopen', 'फिर खोलें')}
                  </Btn>
                )}
              </div>
            </Card>
          </div>

          {/* Actions rail */}
          <aside className="space-y-4">
            {alert.citizen_phone ? (
              <Card tone="seal" className="p-5">
                <Eyebrow>{t('Reach them', 'संपर्क करें')}</Eyebrow>
                <Btn
                  as="a"
                  href={`tel:${alert.citizen_phone.replace(/[^\d+]/g, '')}`}
                  variant="primary"
                  className="mt-4 w-full"
                >
                  <Phone size={17} aria-hidden="true" />
                  {alert.citizen_phone}
                </Btn>
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
                onClick={() =>
                  navigate(
                    `/asha/referrals?new=1&name=${encodeURIComponent(alert.citizen_name || '')}` +
                      `&village=${encodeURIComponent(alert.village || '')}` +
                      `&phone=${encodeURIComponent(alert.citizen_phone || '')}` +
                      `&reason=${encodeURIComponent(alert.title || '')}` +
                      `&urgency=${alert.severity}&alert=${alert.id}`,
                  )
                }
              >
                <Send size={16} aria-hidden="true" />
                {t('Raise a referral', 'रेफरल बनाएँ')}
              </Btn>
            </Card>

            <Card className="p-5">
              <Stamp kind="verified" label="Record" source={t('Audit logged', 'ऑडिट दर्ज')} />
              <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
                {t(
                  'Every status change on this alert is timestamped and recorded against your account.',
                  'इस सूचना का हर बदलाव समय के साथ आपके खाते में दर्ज होता है।',
                )}
              </p>
            </Card>
          </aside>
        </div>
      )}
    </AshaShell>
  );
}
