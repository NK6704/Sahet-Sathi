import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  Phone,
  MapPin,
  Siren,
  Navigation,
  Info,
  MessageSquare,
  Megaphone,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { useAsync } from '@/lib/useAsync';
import {
  getAshaSOSQueue,
  getAshaThreadSummary,
  getAshaNotifications,
  acknowledgeSOS,
} from '@/services/api';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Figure,
  Eyebrow,
  Pill,
  Stamp,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';
import { relativeTime } from '@/components/asha/parts';

/* =============================================================
   /asha — Today.

   One question this page answers: who needs me, and in what order.

   Every number on it is a number the server sent. The page used to
   call GET /api/asha/dashboard, which answered with an invented
   worker, an invented household count and three named patients;
   that route is retired and answers 410. What replaced it is three
   live reads — the SOS queue, the message-thread summary and the
   notifications this account has sent — and each one is allowed to
   fail, load or come back empty on its own. A section with no data
   says so; it never borrows a figure from somewhere else.
   ============================================================= */

const SOS_STATUS = {
  open: { en: 'Open', hi: 'खुला', tone: 'siren' },
  acknowledged: { en: 'Picked up', hi: 'ले लिया गया', tone: 'amber' },
  resolved: { en: 'Closed', hi: 'बंद', tone: 'seal' },
  cancelled: { en: 'Cancelled', hi: 'रद्द', tone: 'neutral' },
};

/**
 * The server's own `note`, printed word for word. Every response
 * that can come back empty carries one, and it is the sentence that
 * stops an empty list being read as "nothing happened today".
 */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="mt-5 flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

export function AshaDashboard() {
  const { profile } = useAuth();
  const { language } = useAppState();
  /* The portal follows the choice made on the landing page. A saved
     profile language wins once there is one; before that the device
     preference is used rather than assuming Hindi. */
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const queue = useAsync(() => getAshaSOSQueue({ status: 'active' }), []);
  const threads = useAsync(() => getAshaThreadSummary(), []);
  const sent = useAsync(() => getAshaNotifications({ page: 1, size: 3 }), []);

  const [busyId, setBusyId] = useState(null);
  const [ackError, setAckError] = useState(null);

  /* The SOS row carries village_id and no village name, so the name
     comes from this account's own village assignment. Anything not in
     that list stays a bare id rather than being guessed at. */
  const villageName = useMemo(() => {
    const map = {};
    for (const v of profile?.assignedVillages ?? []) {
      if (v?.id && v?.name) map[v.id] = v.name;
    }
    return map;
  }, [profile?.assignedVillages]);

  const rows = queue.data?.sos ?? [];

  async function acknowledge(id) {
    setBusyId(id);
    setAckError(null);
    try {
      await acknowledgeSOS(id);
      await queue.reload();
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

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t('Good morning', 'सुप्रभात');
    if (h < 17) return t('Good afternoon', 'नमस्ते');
    return t('Good evening', 'शुभ संध्या');
  })();

  const firstName = (profile?.full_name || '').split(' ')[0];

  return (
    <AshaShell
      eyebrow={t('Register 001 · Today', 'रजिस्टर 001 · आज')}
      title={firstName ? `${greeting}, ${firstName}` : greeting}
      sub={t(
        'Emergencies raised in the villages assigned to you, newest first.',
        'आपको सौंपे गाँवों में उठाई गई आपात सूचनाएँ, नई पहले।',
      )}
      action={
        <Btn as={Link} href="/asha/alerts" variant="asha">
          {t('Full queue', 'पूरी सूची')}
          <ArrowRight size={16} aria-hidden="true" />
        </Btn>
      }
    >
      {/* ---------------------------------------------------------
          001 — the emergency queue
          --------------------------------------------------------- */}
      <section>
        <div className="reg-rule" />
        <div className="flex flex-wrap items-end justify-between gap-4 pt-5">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="reg-index">001</span>
              <Eyebrow>{t('Emergency queue', 'आपात सूची')}</Eyebrow>
            </div>
            <h2 className="display-md mt-3 text-2xl sm:text-3xl">
              {t('Who needs you', 'किसे आपकी ज़रूरत है')}
            </h2>
          </div>
        </div>

        {queue.loading ? (
          <div className="mt-6">
            <LoadingState
              label={t('Loading your queue', 'आपकी सूची लोड हो रही है')}
              rows={3}
            />
          </div>
        ) : queue.error ? (
          <div className="mt-6">
            <ErrorState
              title={t("Couldn't load your queue", 'सूची लोड नहीं हुई')}
              body={
                queue.error.message ||
                t(
                  'The connection dropped before the queue arrived. Nothing has been lost — try again. If someone needs help right now, call 108.',
                  'सूची आने से पहले कनेक्शन टूट गया। कुछ खोया नहीं है — फिर कोशिश करें। अगर अभी किसी को मदद चाहिए तो 108 पर कॉल करें।',
                )
              }
              onRetry={queue.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4">
              <Figure
                value={String(queue.data?.count ?? 0)}
                label={t('Open right now', 'अभी खुली')}
                tone={(queue.data?.count ?? 0) > 0 ? 'siren' : 'neutral'}
                hint={t('Raised and not yet closed', 'उठाई गईं, अभी बंद नहीं')}
              />
              <Figure
                value={String(queue.data?.villageCount ?? 0)}
                label={t('Villages assigned to you', 'आपको सौंपे गाँव')}
                tone="seal"
                hint={t('Set by your block office', 'ब्लॉक कार्यालय द्वारा तय')}
              />
            </div>

            <ServerNote>{queue.data?.note}</ServerNote>

            {ackError ? (
              <p className="mt-5 text-sm font-semibold text-siren" role="alert">
                {ackError}
              </p>
            ) : null}

            <div className="mt-6 space-y-3">
              {rows.length === 0 ? (
                <EmptyState
                  title={t('Nothing waiting', 'कुछ बाकी नहीं')}
                  body={t(
                    'No emergency is open in your villages. New ones appear here as soon as a family raises them.',
                    'आपके गाँवों में कोई आपात सूचना खुली नहीं है। जैसे ही कोई परिवार उठाएगा, वह यहाँ दिखेगी।',
                  )}
                  action={
                    <Btn variant="outline" onClick={queue.reload}>
                      {t('Check again', 'फिर देखें')}
                    </Btn>
                  }
                />
              ) : (
                rows.slice(0, 5).map((sos) => (
                  <SosRow
                    key={sos.id}
                    sos={sos}
                    hi={hi}
                    villageName={villageName}
                    busy={busyId === sos.id}
                    onAcknowledge={acknowledge}
                  />
                ))
              )}
            </div>

            {queue.data?.hasMore ? (
              <div className="mt-5">
                <Btn as={Link} href="/asha/alerts" variant="outline">
                  {t('See the rest of the queue', 'बाकी सूची देखें')}
                  <ArrowRight size={16} aria-hidden="true" />
                </Btn>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* ---------------------------------------------------------
          002 — messages from households
          --------------------------------------------------------- */}
      <section className="mt-14">
        <div className="reg-rule" />
        <div className="flex items-baseline gap-3 pt-5">
          <span className="reg-index">002</span>
          <Eyebrow>{t('Messages from households', 'परिवारों के संदेश')}</Eyebrow>
        </div>

        {threads.loading ? (
          <div className="mt-6">
            <LoadingState label={t('Loading messages', 'संदेश लोड हो रहे हैं')} rows={1} />
          </div>
        ) : threads.error ? (
          <div className="mt-6">
            <ErrorState
              title={t("Couldn't load your messages", 'संदेश लोड नहीं हुए')}
              body={threads.error.message || undefined}
              onRetry={threads.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              <Figure
                value={String(threads.data?.unreadMessages ?? 0)}
                label={t('Unread messages', 'अपठित संदेश')}
                tone={(threads.data?.unreadMessages ?? 0) > 0 ? 'amber' : 'neutral'}
              />
              <Figure
                value={String(threads.data?.openThreads ?? 0)}
                label={t('Open conversations', 'चालू बातचीत')}
                tone="asha"
              />
              <Figure
                value={String(threads.data?.totalThreads ?? 0)}
                label={t('Conversations in all', 'कुल बातचीत')}
                tone="neutral"
              />
            </div>

            {threads.data?.countsApproximate ? (
              <p className="mt-4 text-[0.85rem] leading-relaxed text-ink-faint">
                {t(
                  'These counts are approximate, as the server reports them.',
                  'ये गिनतियाँ अनुमानित हैं, जैसा सर्वर बताता है।',
                )}
              </p>
            ) : null}

            <ServerNote>{threads.data?.note}</ServerNote>

            <div className="mt-5">
              <Btn as={Link} href="/asha/messages" variant="outline">
                <MessageSquare size={16} aria-hidden="true" />
                {t('Open messages', 'संदेश खोलें')}
              </Btn>
            </div>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------
          003 — what this account has broadcast
          --------------------------------------------------------- */}
      <section className="mt-14">
        <div className="reg-rule" />
        <div className="flex items-baseline gap-3 pt-5">
          <span className="reg-index">003</span>
          <Eyebrow>{t('Notices you have sent', 'आपके भेजे संदेश')}</Eyebrow>
        </div>

        {sent.loading ? (
          <div className="mt-6">
            <LoadingState label={t('Loading notices', 'संदेश लोड हो रहे हैं')} rows={1} />
          </div>
        ) : sent.error ? (
          <div className="mt-6">
            <ErrorState
              title={t("Couldn't load what you have sent", 'आपके भेजे संदेश लोड नहीं हुए')}
              body={sent.error.message || undefined}
              onRetry={sent.reload}
              retryLabel={t('Try again', 'फिर कोशिश करें')}
            />
          </div>
        ) : (
          <>
            <Card className="mt-6 p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <Eyebrow>{t('Notices sent from this account', 'इस खाते से भेजे संदेश')}</Eyebrow>
                  <p className="figure mt-2 text-4xl text-asha">
                    {String(sent.data?.count ?? 0)}
                  </p>
                </div>
                <Btn as={Link} href="/asha/broadcast" variant="outline">
                  <Megaphone size={16} aria-hidden="true" />
                  {t('Send a notice', 'नया संदेश भेजें')}
                </Btn>
              </div>

              {(sent.data?.notifications ?? []).length ? (
                <ul className="mt-6 space-y-3 border-t border-rule pt-5">
                  {(sent.data?.notifications ?? []).map((n) => (
                    <li key={n.id} className="min-w-0">
                      <p className="text-[0.95rem] font-semibold leading-snug text-ink">
                        {hi && n.titleHi ? n.titleHi : n.title}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint">
                        <span>{relativeTime(n.sentAt, hi)}</span>
                        {n.village?.name ? <span>{n.village.name}</span> : null}
                        {typeof n.recipientCount === 'number' ? (
                          <span>
                            {t(
                              `${n.recipientCount} recipients`,
                              `${n.recipientCount} प्राप्तकर्ता`,
                            )}
                          </span>
                        ) : null}
                        {n.expired ? <span>{t('Expired', 'अवधि समाप्त')}</span> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>

            <ServerNote>{sent.data?.note}</ServerNote>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------
          004 — 108. Reachable from anywhere in the portal.
          --------------------------------------------------------- */}
      <section className="mt-14">
        <Card tone="siren" className="flex flex-wrap items-center justify-between gap-5 p-6">
          <div className="min-w-0">
            <Stamp kind="urgent" label={t('Emergency', 'आपातकाल')} />
            <p className="mt-4 max-w-lg text-[0.95rem] leading-relaxed text-ink-soft">
              {t(
                'For anything life-threatening, call 108 first and record it afterwards. Do not wait for this app.',
                'जान का खतरा हो तो पहले 108 पर कॉल करें, दर्ज बाद में करें। ऐप का इंतज़ार न करें।',
              )}
            </p>
          </div>
          <Btn as="a" href="tel:108" variant="siren" size="lg">
            <Siren size={19} aria-hidden="true" />
            {t('Call 108', '108 पर कॉल करें')}
          </Btn>
        </Card>
      </section>
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
            ) : null}
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
