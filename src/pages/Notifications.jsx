import React, { useCallback, useState } from 'react';
import { Link } from 'wouter';
import {
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/services/platform';
import {
  Btn,
  Card,
  Eyebrow,
  Pill,
  SectionHead,
  Stamp,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /notifications — what the ASHA worker for this village has said.

   Every row here was written by a person, addressed to a village,
   and stored with the author's own words. Nothing on this screen is
   generated, so the page's job is to make three things legible:

     WHO wrote it        the worker's name when the server could
                         resolve it, and nothing at all when it
                         could not. "ASHA worker" is not a name.
     WHO ELSE got it     a village broadcast and a message meant
                         for one household read very differently,
                         and the reader is entitled to know which
                         she is holding.
     HOW SURE IT IS      a broadcast is stored `unverified` — it is
                         a health worker's advice, not a government
                         record — so this page says so in words
                         rather than putting a verification stamp
                         on somebody's opinion.

   Read state is the server's. The badge in the header listens for
   the event below so it cannot keep showing a count for messages
   that have just been opened.
   ============================================================= */

/**
 * Broadcast to the header badge that read state moved. Both ends use
 * this literal; see the listener in src/components/Header.jsx.
 */
const READ_EVENT = 'sehat:notifications-read';

const PAGE_SIZE = 20;

/**
 * The category codes /asha/broadcast writes. A code that is not in
 * this table is printed as it was stored rather than dropped — it is
 * the worker's own word for what she sent, and hiding it would lose
 * information the reader could use.
 */
const CATEGORY_LABELS = {
  health_advice: ['Health advice', 'स्वास्थ्य सलाह'],
  new_scheme: ['New scheme', 'नई योजना'],
  eligibility: ['Eligibility', 'पात्रता'],
  camp: ['Health camp', 'स्वास्थ्य शिविर'],
  general: ['Notice', 'सूचना'],
};

const SEVERITY = {
  low: { tone: 'neutral', en: 'Routine', hi: 'सामान्य' },
  moderate: { tone: 'seal', en: 'Worth reading', hi: 'ध्यान दें' },
  high: { tone: 'amber', en: 'Important', hi: 'ज़रूरी' },
  critical: { tone: 'siren', en: 'Urgent', hi: 'अति आवश्यक' },
};

function whenText(iso, deva) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return deva ? 'अभी' : 'just now';
  if (mins < 60) return deva ? `${mins} मिनट पहले` : `${mins} min ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return deva ? `${hours} घंटे पहले` : `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return deva ? `${days} दिन पहले` : `${days} d ago`;

  return then.toLocaleDateString(deva ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

function fullDate(iso, deva) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(deva ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The server's own sentence, printed as it arrived. */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

function Notice({ row, index, deva, t, myVillage, onRead, marking }) {
  const severity = SEVERITY[row.severity] ?? null;
  const categoryPair = row.category ? CATEGORY_LABELS[row.category] : null;
  const categoryLabel = categoryPair ? (deva ? categoryPair[1] : categoryPair[0]) : row.category;

  const unread = !row.readAt;
  const sentInHindi = String(row.language ?? '').toLowerCase().startsWith('hindi');
  // The server marks the stored language, so a message written in the
  // other language can be labelled rather than silently presented as
  // though it had been translated. Nothing here translates anything.
  const languageMismatch = sentInHindi !== deva;

  /* The village name is printed only when the notice names the same
     village as the reader's own profile — that name is then the
     reader's own record, not a lookup we do not have. */
  const villageName =
    myVillage?.id && row.villageId === myVillage.id ? myVillage.name || null : null;

  const audience =
    row.audience === 'user'
      ? t('Sent to you only', 'केवल आपको भेजा गया')
      : row.audience === 'village'
      ? villageName
        ? t(`Sent to everyone in ${villageName}`, `${villageName} के सभी लोगों को भेजा गया`)
        : t('Sent to everyone in your village', 'आपके गाँव के सभी लोगों को भेजा गया')
      : null;

  return (
    <Card
      tone={unread ? (severity?.tone === 'neutral' ? 'seal' : severity?.tone) : undefined}
      className="p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="reg-index">{index}</span>
        {unread ? <Pill tone="seal">{t('New', 'नया')}</Pill> : null}
        {row.severity === 'critical' ? (
          <Stamp kind="urgent" label={t('Urgent', 'अति आवश्यक')} />
        ) : severity && row.severity !== 'low' ? (
          <Pill tone={severity.tone}>{deva ? severity.hi : severity.en}</Pill>
        ) : null}
        {categoryLabel ? <Pill>{categoryLabel}</Pill> : null}
        {row.expired ? (
          <Pill tone="neutral">{t('No longer current', 'अवधि समाप्त')}</Pill>
        ) : null}
      </div>

      <h3 className="display-md mt-4 text-xl sm:text-2xl">{row.title}</h3>

      <p className="mt-3 whitespace-pre-line text-[0.95rem] leading-relaxed text-ink-soft">
        {row.body}
      </p>

      {languageMismatch ? (
        <p className="mt-3 text-[0.8rem] text-ink-faint">
          {sentInHindi
            ? t(
                'This message was written in Hindi and is shown exactly as it was sent. It has not been translated.',
                'यह संदेश हिन्दी में लिखा गया था और जैसा भेजा गया वैसा ही दिखाया गया है।',
              )
            : t(
                'यह संदेश अंग्रेज़ी में लिखा गया था और जैसा भेजा गया वैसा ही दिखाया गया है। इसका अनुवाद नहीं किया गया।',
                'This message was written in English and is shown exactly as it was sent.',
              )}
        </p>
      ) : null}

      {/* --- who, when, to whom ------------------------------------- */}
      <div className="mt-5 border-t border-rule-soft pt-4">
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <Eyebrow>{t('Sent by', 'भेजने वाली')}</Eyebrow>
            {/* Absent, not a placeholder. The server omits the name when
                it could not resolve one, and inventing a label here
                would put a person on screen who was never named. */}
            <p className="mt-1.5 text-[0.95rem] text-ink">
              {row.senderName || (
                <span className="text-ink-faint">
                  {t('Name not on record', 'नाम दर्ज नहीं')}
                </span>
              )}
            </p>
          </div>
          <div>
            <Eyebrow>{t('Received', 'मिला')}</Eyebrow>
            <p className="mt-1.5 text-[0.95rem] text-ink">
              {whenText(row.receivedAt, deva) ?? '—'}
              <span className="ml-2 text-[0.8rem] text-ink-faint">
                {fullDate(row.receivedAt, deva)}
              </span>
            </p>
          </div>
          {audience ? (
            <div className="sm:col-span-2">
              <Eyebrow>{t('Audience', 'किसे भेजा')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">{audience}</p>
            </div>
          ) : null}
          {row.expiresAt ? (
            <div className="sm:col-span-2">
              <Eyebrow>{t('Relevant until', 'कब तक')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">
                {fullDate(row.expiresAt, deva)}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* --- provenance ---------------------------------------------
          A broadcast is stored `unverified`, because nothing in the
          system checks what a worker types. That is said in a
          sentence rather than with a verification stamp: stamping
          somebody's advice "verified" is the exact false claim the
          stamp exists to prevent. */}
      <div className="mt-5">
        {row.verification === 'verified' ? (
          <Stamp
            kind="verified"
            label={t('Official record', 'सरकारी अभिलेख')}
            source={row.source || undefined}
          />
        ) : (
          <p className="text-[0.85rem] leading-relaxed text-ink-faint">
            {t(
              'This is the advice of the health worker who wrote it. It has not been checked against a government record, so treat it as her guidance and not as a decision on your case.',
              'यह उस स्वास्थ्य कार्यकर्ता की सलाह है जिसने इसे लिखा। इसे किसी सरकारी अभिलेख से जाँचा नहीं गया है, इसलिए इसे उनकी सलाह मानें, आपके मामले पर निर्णय नहीं।',
            )}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2.5">
        {row.schemeId ? (
          <Btn as={Link} href={`/schemes/${row.schemeId}`} variant="outline">
            {t('Open the scheme', 'योजना खोलें')}
          </Btn>
        ) : null}
        {unread ? (
          <Btn variant="outline" onClick={() => onRead(row)} disabled={marking}>
            {marking ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {t('Mark as read', 'पढ़ा हुआ चिह्नित करें')}
          </Btn>
        ) : (
          <p className="text-[0.8rem] text-ink-faint">
            {t(
              `Read ${whenText(row.readAt, deva) ?? ''}`,
              `${whenText(row.readAt, deva) ?? ''} पढ़ा`,
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

export function Notifications() {
  const { language, profile, isAuthenticated, loading: authLoading } = useAuth();
  const t = getT(language);
  const deva = t.isHindi;

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [markingId, setMarkingId] = useState(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const feed = useAsync(
    () => getNotifications({ unreadOnly: unreadOnly || undefined, page, size: PAGE_SIZE }),
    [unreadOnly, page],
    { skip: !isAuthenticated },
  );

  const rows = feed.data?.notifications ?? [];
  const unreadCount = feed.data?.unreadCount ?? 0;
  const total = feed.data?.count ?? 0;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  /* The reader's own village, straight off their profile. Used only to
     name the village a notice went to when the ids match. */
  const myVillage = profile?.village_id
    ? { id: profile.village_id, name: profile.village || null }
    : null;

  const announce = useCallback(() => {
    window.dispatchEvent(new Event(READ_EVENT));
  }, []);

  async function markOne(row) {
    setActionError(null);
    setMarkingId(row.id);
    try {
      const result = await markNotificationRead(row.notificationId);
      // The read state shown is the server's timestamp, not this
      // client's clock. `notificationId` is the id the endpoint keys
      // on — the row's own `id` is the recipient record and would 404.
      feed.setData((prev) =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map((n) =>
                n.id === row.id ? { ...n, readAt: result?.readAt ?? n.readAt } : n,
              ),
              unreadCount: Math.max((prev.unreadCount ?? 0) - 1, 0),
            }
          : prev,
      );
      announce();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setMarkingId(null);
    }
  }

  async function markAll() {
    setActionError(null);
    setMarkAllBusy(true);
    try {
      await markAllNotificationsRead();
      announce();
      // Reloaded rather than patched: the server marked every unread
      // row this account has, including ones not on this page, so the
      // only honest local state is the one it hands back.
      feed.reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setMarkAllBusy(false);
    }
  }

  const choose = (next) => {
    setUnreadOnly(next);
    setPage(1);
  };

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-8 sm:pt-12 ${deva ? 'is-deva' : ''}`}>
      <header className="border-b border-rule pb-10">
        <Eyebrow>{t('Register · Notices', 'रजिस्टर · सूचनाएँ')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-3xl">
          {t('Notices for your village', 'आपके गाँव की सूचनाएँ')}
        </h1>
        <p className="lede mt-5 max-w-2xl">
          {t(
            'Health advice, new schemes and eligibility news, written by the ASHA worker who covers your village and sent to the households registered there. Every notice below names who wrote it and when it reached you.',
            'स्वास्थ्य सलाह, नई योजनाएँ और पात्रता से जुड़ी ख़बरें — आपके गाँव की आशा कार्यकर्ता द्वारा लिखी और वहाँ दर्ज परिवारों को भेजी गई। नीचे हर सूचना बताती है कि उसे किसने लिखा और वह आपको कब मिली।',
          )}
        </p>
      </header>

      {!isAuthenticated && !authLoading ? (
        <section className="mt-10">
          <EmptyState
            stamp={false}
            title={t('Sign in to read your notices', 'सूचनाएँ पढ़ने के लिए साइन इन करें')}
            body={t(
              'Notices are sent to a person, not to a device, so we can only show yours once you are signed in.',
              'सूचनाएँ किसी व्यक्ति को भेजी जाती हैं, किसी उपकरण को नहीं, इसलिए साइन इन करने पर ही आपकी सूचनाएँ दिख सकती हैं।',
            )}
            action={
              <Btn as={Link} href="/onboarding">
                {t('Sign in', 'साइन इन')}
              </Btn>
            }
          />
        </section>
      ) : (
        <>
          {/* ================= 01 · What to show ================= */}
          <section className="mt-10">
            <SectionHead
              index="01"
              eyebrow={t('Your notices', 'आपकी सूचनाएँ')}
              title={
                unreadOnly
                  ? t('Unread only', 'केवल अनपढ़ी')
                  : t('Everything you have been sent', 'आपको भेजी गई सभी सूचनाएँ')
              }
              action={
                unreadCount > 0 ? (
                  <Btn variant="outline" onClick={markAll} disabled={markAllBusy}>
                    {markAllBusy ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCheck size={16} aria-hidden="true" />
                    )}
                    {t('Mark all as read', 'सभी पढ़ी हुई चिह्नित करें')}
                  </Btn>
                ) : null
              }
            />

            <div
              className="mt-6 flex flex-wrap items-center gap-2"
              role="group"
              aria-label={t('Filter notices', 'सूचनाएँ छाँटें')}
            >
              {[
                { value: false, en: 'All', hi: 'सभी' },
                { value: true, en: 'Unread', hi: 'अनपढ़ी' },
              ].map((option) => {
                const on = unreadOnly === option.value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    onClick={() => choose(option.value)}
                    aria-pressed={on}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.875rem] font-semibold transition-colors ${
                      on
                        ? 'border-ink bg-ink text-paper'
                        : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
                    }`}
                  >
                    {deva ? option.hi : option.en}
                    {option.value && unreadCount > 0 ? (
                      <span
                        className={`font-mono text-[0.7rem] ${on ? 'text-paper/70' : 'text-ink-faint'}`}
                      >
                        {unreadCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {actionError ? (
              <Card
                tone="siren"
                className="mt-6 p-5 text-[0.9rem] leading-relaxed text-ink-soft"
                role="alert"
              >
                {actionError}
              </Card>
            ) : null}
          </section>

          {/* ================= 02 · The feed ================= */}
          <section className="mt-10">
            {feed.loading ? (
              <LoadingState label={t('Loading your notices', 'सूचनाएँ लोड हो रही हैं')} rows={3} />
            ) : feed.error ? (
              <ErrorState
                title={t('Your notices did not load', 'सूचनाएँ लोड नहीं हुईं')}
                body={
                  feed.error.message ||
                  t(
                    'The server could not be reached, so this list is empty because of a connection and not because nothing was sent.',
                    'सर्वर तक नहीं पहुँच सके, इसलिए यह सूची कनेक्शन के कारण खाली है — इसलिए नहीं कि कुछ भेजा नहीं गया।',
                  )
                }
                onRetry={feed.reload}
                retryLabel={t('Try again', 'फिर कोशिश करें')}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={
                  unreadOnly
                    ? t('Nothing is unread', 'कुछ अनपढ़ा नहीं है')
                    : t('No notices yet', 'अभी कोई सूचना नहीं')
                }
                /* The server explains what an empty list means, and it
                   is never "something failed". Printed verbatim. */
                body={
                  feed.data?.note ||
                  t(
                    'Notices appear here when the ASHA worker for your village sends one.',
                    'जब आपके गाँव की आशा कार्यकर्ता कोई सूचना भेजेंगी, वह यहाँ दिखेगी।',
                  )
                }
                action={
                  unreadOnly ? (
                    <Btn variant="outline" onClick={() => choose(false)}>
                      {t('Show everything', 'सभी दिखाएँ')}
                    </Btn>
                  ) : (
                    <Btn as={Link} href="/messages" variant="outline">
                      <MessageSquare size={17} aria-hidden="true" />
                      {t('Message your ASHA worker', 'आशा कार्यकर्ता को संदेश भेजें')}
                    </Btn>
                  )
                }
              />
            ) : (
              <>
                <div className="space-y-4">
                  {rows.map((row, i) => (
                    <Notice
                      key={row.id}
                      row={row}
                      index={String((page - 1) * PAGE_SIZE + i + 1).padStart(3, '0')}
                      deva={deva}
                      t={t}
                      myVillage={myVillage}
                      onRead={markOne}
                      marking={markingId === row.id}
                    />
                  ))}
                </div>

                {pageCount > 1 ? (
                  <nav
                    className="mt-8 flex items-center justify-between gap-4"
                    aria-label={t('Pages', 'पृष्ठ')}
                  >
                    <Btn
                      variant="outline"
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft size={17} aria-hidden="true" />
                      {t('Newer', 'नई')}
                    </Btn>
                    <span className="reg-index">
                      {t(`Page ${page} of ${pageCount}`, `पृष्ठ ${page} / ${pageCount}`)}
                    </span>
                    <Btn
                      variant="outline"
                      onClick={() => setPage((p) => Math.min(p + 1, pageCount))}
                      disabled={page >= pageCount}
                    >
                      {t('Older', 'पुरानी')}
                      <ChevronRight size={17} aria-hidden="true" />
                    </Btn>
                  </nav>
                ) : null}
              </>
            )}
          </section>

          {/* ================= 03 · What this list is ================= */}
          <section className="mt-14">
            <SectionHead
              index="03"
              eyebrow={t('About these notices', 'इन सूचनाओं के बारे में')}
              title={t('Where they come from', 'ये कहाँ से आती हैं')}
            />
            <div className="mt-6 space-y-4">
              <ServerNote>
                {t(
                  'A notice is sent to the households registered to a village at the moment it is written. Somebody who registers tomorrow will not receive a notice sent today, and nothing here is added or removed afterwards.',
                  'सूचना उस समय गाँव में दर्ज परिवारों को भेजी जाती है जब वह लिखी जाती है। कल दर्ज होने वाले व्यक्ति को आज भेजी सूचना नहीं मिलेगी, और बाद में इसमें कुछ जोड़ा या हटाया नहीं जाता।',
                )}
              </ServerNote>
              <div className="flex flex-wrap items-center gap-3">
                <BellRing size={17} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <p className="text-[0.9rem] leading-relaxed text-ink-soft">
                  {t(
                    'If you need to ask something back, open a conversation with her — this list is one-way.',
                    'कुछ पूछना हो तो उनसे बातचीत शुरू करें — यह सूची केवल एक तरफ़ा है।',
                  )}
                </p>
                <Btn as={Link} href="/messages" variant="outline">
                  {t('Open messages', 'संदेश खोलें')}
                </Btn>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
