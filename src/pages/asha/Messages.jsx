import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronUp,
  Info,
  Loader2,
  Radio,
  RotateCw,
  Send,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getAshaThreadSummary,
  getMessageThreads,
  getThreadMessages,
  sendThreadMessage,
} from '@/services/platform';
import { AshaShell } from '@/components/asha/AshaShell';
import {
  Btn,
  Card,
  Eyebrow,
  Figure,
  Pill,
  SectionHead,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /asha/messages — what her villagers have asked her.

   The summary endpoint returns counts and nothing else: how many
   conversations are open, how many messages are unread. It does not
   return the conversations themselves, so this page reads the thread
   list separately rather than deriving an inbox from a number.

   Opening a conversation is the read receipt — the server marks the
   incoming messages read as a side effect of the GET. So the unread
   figure above drops on its own once she has actually looked, and
   this page never marks anything read that she has not opened.
   ============================================================= */

const MAX_BODY = 2000; // the server's limit, enforced here so nothing is lost on submit

function clockTime(iso, deva) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(deva ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso, deva) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  if (d.toDateString() === today.toDateString()) return deva ? 'आज' : 'Today';
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return deva ? 'कल' : 'Yesterday';

  return d.toLocaleDateString(deva ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function relative(iso, deva) {
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
  return dayLabel(iso, deva);
}

/** The server's own sentence, printed as it arrived. */
function ServerNote({ tone, icon: Icon = Info, children }) {
  if (!children) return null;
  return (
    <Card tone={tone} className="flex items-start gap-3 p-5">
      <Icon size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

/**
 * A villager's name when the server resolved one, and the side she is
 * on when it did not. Naming the side is a fact the payload carries;
 * inventing a name would not be.
 */
function nameOf(counterparty, t) {
  if (counterparty?.fullName) return counterparty.fullName;
  return counterparty?.side === 'asha'
    ? t('ASHA worker', 'आशा कार्यकर्ता')
    : t('Resident of your village', 'आपके गाँव का निवासी');
}

/* -------------------------------------------------------------
   One conversation.
   ------------------------------------------------------------- */

function Conversation({ threadId, t, deva }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(null);
  /* Older pages held apart from the live payload, so appending a reply
     does not discard history already fetched. */
  const [older, setOlder] = useState({ rows: [], cursor: undefined, hasMore: undefined });
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const endRef = useRef(null);

  const view = useAsync(() => getThreadMessages(threadId), [threadId]);

  const thread = view.data?.thread ?? null;
  const messages = [...older.rows, ...(view.data?.messages ?? [])];
  const before = older.cursor !== undefined ? older.cursor : (view.data?.nextBefore ?? null);
  const hasMore = older.hasMore !== undefined ? older.hasMore : Boolean(view.data?.hasMore);

  useEffect(() => {
    setOlder({ rows: [], cursor: undefined, hasMore: undefined });
    setDraft('');
    setActionError(null);
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  async function loadEarlier() {
    if (!before) return;
    setLoadingEarlier(true);
    try {
      const page = await getThreadMessages(threadId, { before });
      setOlder((prev) => ({
        rows: [...(page?.messages ?? []), ...prev.rows],
        cursor: page?.nextBefore ?? null,
        hasMore: Boolean(page?.hasMore),
      }));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setActionError(null);
    setSending(true);
    try {
      const result = await sendThreadMessage(threadId, text);
      // Only the row the server stored is drawn, so a reply on screen is
      // a reply that was accepted — never an optimistic one.
      if (result?.message) {
        view.setData((prev) =>
          prev ? { ...prev, messages: [...(prev.messages ?? []), result.message] } : prev,
        );
      }
      setDraft('');
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (view.loading) {
    return <LoadingState label={t('Opening the conversation', 'बातचीत खुल रही है')} rows={3} />;
  }

  if (view.error) {
    return (
      <ErrorState
        title={t('This conversation did not open', 'यह बातचीत नहीं खुली')}
        body={view.error.message}
        onRetry={view.reload}
        retryLabel={t('Try again', 'फिर कोशिश करें')}
      />
    );
  }

  const villager = nameOf(thread?.counterparty, t);
  const closed = Boolean(thread?.closed);
  let lastDay = null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Btn variant="outline" onClick={() => navigate('/asha/messages')}>
            <ArrowLeft size={17} aria-hidden="true" />
            {t('Inbox', 'इनबॉक्स')}
          </Btn>
          {closed ? <Pill>{t('Closed', 'बंद')}</Pill> : null}
        </div>
        <Btn variant="outline" onClick={view.reload}>
          <RotateCw size={16} aria-hidden="true" />
          {t('Refresh', 'ताज़ा करें')}
        </Btn>
      </div>

      <Card tone="asha" className="p-5">
        <Eyebrow>{t('Conversation with', 'बातचीत')}</Eyebrow>
        <h2 className="display-md mt-2 text-xl">{villager}</h2>
        {thread?.subject ? (
          <p className="mt-2 text-[0.9rem] text-ink-soft">{thread.subject}</p>
        ) : null}
        {view.data?.markedRead ? (
          <p className="mt-3 text-[0.8rem] text-ink-faint">
            {t(
              'Opening this marked her messages read on her side.',
              'इसे खोलने से उनकी तरफ़ संदेश पढ़े हुए चिह्नित हो गए।',
            )}
          </p>
        ) : null}
      </Card>

      {view.data?.note ? <ServerNote>{view.data.note}</ServerNote> : null}

      {hasMore ? (
        <div className="flex justify-center">
          <Btn variant="outline" onClick={loadEarlier} disabled={loadingEarlier}>
            {loadingEarlier ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <ChevronUp size={16} aria-hidden="true" />
            )}
            {t('Show earlier messages', 'पहले के संदेश दिखाएँ')}
          </Btn>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState
          stamp={false}
          title={t('Nothing said yet', 'अभी कोई संदेश नहीं')}
          body={t(
            'This conversation is open but empty. Write the first message below.',
            'यह बातचीत खुली है पर खाली है। नीचे पहला संदेश लिखें।',
          )}
        />
      ) : (
        <ol className="space-y-3">
          {messages.map((m) => {
            const day = dayLabel(m.createdAt, deva);
            const showDay = day && day !== lastDay;
            lastDay = day;

            return (
              <React.Fragment key={m.id}>
                {showDay ? (
                  <li className="pt-3 text-center">
                    <span className="reg-index">{day}</span>
                  </li>
                ) : null}
                <li className={m.mine ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={`max-w-[85%] rounded-2xl border-[1.5px] px-4 py-3 sm:max-w-[70%] ${
                      m.mine ? 'border-rule bg-paper-3' : 'border-rule-soft bg-paper-2'
                    }`}
                  >
                    <p className="eyebrow">{m.mine ? t('You', 'आप') : villager}</p>
                    <p className="mt-2 whitespace-pre-line text-[0.95rem] leading-relaxed text-ink">
                      {m.body}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-[0.75rem] text-ink-faint">
                      <span>{clockTime(m.createdAt, deva)}</span>
                      {m.mine ? (
                        /* "Read" only once the server recorded a read
                           timestamp. Before that it is "sent" — accepted
                           by the server, not seen by anybody. */
                        <span>{m.readAt ? t('Read', 'पढ़ा गया') : t('Sent', 'भेजा गया')}</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              </React.Fragment>
            );
          })}
          <li ref={endRef} aria-hidden="true" />
        </ol>
      )}

      {closed ? (
        <ServerNote>
          {t(
            'This conversation is closed, so no new messages can be added to it.',
            'यह बातचीत बंद है, इसलिए इसमें नए संदेश नहीं जोड़े जा सकते।',
          )}
        </ServerNote>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="asha-reply" className="eyebrow block">
            {t('Your reply', 'आपका जवाब')}
          </label>
          <textarea
            id="asha-reply"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
            rows={4}
            className="field w-full resize-y"
            placeholder={t(
              'Answer plainly. Say what to do and where to go.',
              'सीधा जवाब दें। बताएँ क्या करना है और कहाँ जाना है।',
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[0.8rem] text-ink-faint">
              {draft.length} / {MAX_BODY}
            </span>
            <Btn type="submit" variant="asha" disabled={sending || draft.trim().length === 0}>
              {sending ? (
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
              ) : (
                <Send size={17} aria-hidden="true" />
              )}
              {t('Send reply', 'जवाब भेजें')}
            </Btn>
          </div>
          {actionError ? (
            <p className="text-[0.9rem] leading-relaxed text-siren" role="alert">
              {actionError}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   The inbox.
   ------------------------------------------------------------- */

function Inbox({ threads, note, t, deva }) {
  if (threads.length === 0) {
    return (
      <EmptyState
        title={t('No conversations yet', 'अभी कोई बातचीत नहीं')}
        body={
          note ||
          t(
            'When somebody in one of your villages writes to you, the conversation appears here.',
            'जब आपके किसी गाँव का कोई व्यक्ति आपको लिखेगा, बातचीत यहाँ दिखेगी।',
          )
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {threads.map((thread, i) => {
        const villager = nameOf(thread.counterparty, t);
        const unread = Number(thread.unreadCount ?? 0);

        return (
          <li key={thread.id}>
            <Card
              as={Link}
              href={`/asha/messages/${thread.id}`}
              lift
              tone={unread > 0 ? 'asha' : undefined}
              className="block p-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="reg-index">{String(i + 1).padStart(3, '0')}</span>
                {unread > 0 ? (
                  <Pill tone="asha">
                    {unread === 1
                      ? t('1 unread', '1 अनपढ़ा')
                      : t(`${unread} unread`, `${unread} अनपढ़े`)}
                  </Pill>
                ) : null}
                {thread.closed ? <Pill>{t('Closed', 'बंद')}</Pill> : null}
              </div>

              <h3 className="display-md mt-3 text-lg">{villager}</h3>

              {thread.lastMessage ? (
                <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">
                  {thread.lastMessage.mine ? `${t('You', 'आप')}: ` : ''}
                  {thread.lastMessage.preview}
                  {thread.lastMessage.truncated ? '…' : ''}
                </p>
              ) : (
                <p className="mt-2 text-[0.9rem] text-ink-faint">
                  {t('No messages in this conversation yet.', 'इस बातचीत में अभी कोई संदेश नहीं।')}
                </p>
              )}

              <p className="mt-3 text-[0.8rem] text-ink-faint">
                {relative(thread.lastMessageAt || thread.createdAt, deva)}
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function AshaMessages({ params }) {
  const { language } = useAuth();
  const t = getT(language);
  const deva = t.isHindi;

  const threadId = params?.id ?? null;

  const summary = useAsync(() => getAshaThreadSummary(), [threadId]);
  /* The summary endpoint returns counts only, so the inbox itself comes
     from the thread list. Both are re-read when a conversation closes,
     because opening one changes its unread count on the server. */
  const threads = useAsync(() => getMessageThreads(), [threadId], { skip: Boolean(threadId) });

  const counts = summary.data ?? null;
  const approximate = Boolean(counts?.countsApproximate);

  const refreshAll = () => {
    summary.reload();
    threads.reload();
  };

  return (
    <AshaShell
      eyebrow={t('Register · Conversations', 'रजिस्टर · बातचीत')}
      title={
        threadId
          ? t('A conversation', 'एक बातचीत')
          : t('Messages from your villages', 'आपके गाँवों से संदेश')
      }
      sub={
        threadId
          ? undefined
          : t(
              'Anyone registered in a village you cover can write to you here. Opening a conversation marks her messages read, so open one only when you are ready to answer.',
              'आपके क्षेत्र के किसी भी गाँव में दर्ज व्यक्ति आपको यहाँ लिख सकता है। बातचीत खोलने से उनके संदेश पढ़े हुए चिह्नित हो जाते हैं, इसलिए तभी खोलें जब जवाब देने को तैयार हों।',
            )
      }
      action={
        <Btn as={Link} href="/asha/broadcast" variant="outline">
          <Radio size={17} aria-hidden="true" />
          {t('Send a notice', 'सूचना भेजें')}
        </Btn>
      }
    >
      {threadId ? (
        <Conversation threadId={threadId} t={t} deva={deva} />
      ) : (
        <>
          {/* ================= 01 · Where things stand ================= */}
          <section>
            <SectionHead
              index="01"
              eyebrow={t('Today', 'आज')}
              title={t('Where things stand', 'स्थिति')}
              action={
                <Btn variant="outline" onClick={refreshAll}>
                  <RotateCw size={16} aria-hidden="true" />
                  {t('Refresh', 'ताज़ा करें')}
                </Btn>
              }
            />

            <div className="mt-6 space-y-4">
              {summary.loading ? (
                <LoadingState label={t('Counting', 'गिन रहे हैं')} rows={1} />
              ) : summary.error ? (
                <ErrorState
                  title={t('The counts did not load', 'संख्याएँ लोड नहीं हुईं')}
                  body={summary.error.message}
                  onRetry={summary.reload}
                  retryLabel={t('Try again', 'फिर कोशिश करें')}
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Figure
                      value={counts?.unreadMessages ?? 0}
                      label={t('Unread messages', 'अनपढ़े संदेश')}
                      tone={Number(counts?.unreadMessages ?? 0) > 0 ? 'siren' : 'neutral'}
                    />
                    <Figure
                      value={counts?.openThreads ?? 0}
                      label={t('Open conversations', 'खुली बातचीत')}
                      tone="asha"
                    />
                    <Figure
                      value={counts?.closedThreads ?? 0}
                      label={t('Closed', 'बंद')}
                    />
                  </div>

                  {/* When the server says its own counts are approximate,
                      that is said on screen rather than presented as a
                      hard number. */}
                  {approximate ? (
                    <ServerNote tone="amber" icon={AlertTriangle}>
                      {counts?.note ||
                        t(
                          'The server reported these counts as approximate.',
                          'सर्वर ने इन संख्याओं को अनुमानित बताया है।',
                        )}
                    </ServerNote>
                  ) : counts?.note ? (
                    <ServerNote>{counts.note}</ServerNote>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {/* ================= 02 · The inbox ================= */}
          <section className="mt-14">
            <SectionHead
              index="02"
              eyebrow={t('Inbox', 'इनबॉक्स')}
              title={t('Who is waiting on you', 'कौन आपके जवाब की राह में है')}
              sub={
                threads.data?.unreadTotal
                  ? t(
                      `${threads.data.unreadTotal} unread across all conversations.`,
                      `सभी बातचीत में ${threads.data.unreadTotal} अनपढ़े।`,
                    )
                  : undefined
              }
            />
            <div className="mt-6">
              {threads.loading ? (
                <LoadingState label={t('Loading conversations', 'बातचीत लोड हो रही है')} rows={3} />
              ) : threads.error ? (
                <ErrorState
                  title={t('The inbox did not load', 'इनबॉक्स लोड नहीं हुआ')}
                  body={threads.error.message}
                  onRetry={threads.reload}
                  retryLabel={t('Try again', 'फिर कोशिश करें')}
                />
              ) : (
                <Inbox
                  threads={threads.data?.threads ?? []}
                  note={threads.data?.note}
                  t={t}
                  deva={deva}
                />
              )}
            </div>
          </section>
        </>
      )}
    </AshaShell>
  );
}
