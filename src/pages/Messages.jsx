import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowLeft,
  ChevronUp,
  Info,
  Loader2,
  MessageSquare,
  Phone,
  RotateCw,
  Send,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getAshaContact,
  getMessageThreads,
  openMessageThread,
  getThreadMessages,
  sendThreadMessage,
} from '@/services/platform';
import {
  Btn,
  Card,
  Eyebrow,
  Pill,
  SectionHead,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ds';

/* =============================================================
   /messages — the two ways to reach the ASHA worker.

   The request was specific: be able to message her through the app,
   AND see her number so you can simply call. Both are here, and the
   number comes first, because a phone call is what somebody reaches
   for when a child has a fever at nine at night.

   Neither half is ever fabricated. /asha/contact answers with a
   worker or with `asha: null` and a sentence explaining why — a
   village missing from the profile, or a village with nobody mapped
   to it. That sentence is printed as it arrived, and a national
   helpline the server itself supplies is offered instead. There is
   no placeholder worker anywhere on this screen.
   ============================================================= */

const MAX_BODY = 2000; // the server's limit; enforced here so a long message is not lost on submit

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
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return deva ? 'आज' : 'Today';

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

/** The server's own explanation, printed word for word. */
function ServerNote({ children }) {
  if (!children) return null;
  return (
    <Card className="flex items-start gap-3 p-5">
      <Info size={17} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
      <p className="min-w-0 text-[0.9rem] leading-relaxed text-ink-soft">{children}</p>
    </Card>
  );
}

/* -------------------------------------------------------------
   Her card: name, sub-centre, and a number you can press.
   ------------------------------------------------------------- */

function ContactPanel({ contact, loading, error, onRetry, t, deva, onStart, starting, startError }) {
  if (loading) {
    return <LoadingState label={t('Finding your ASHA worker', 'आपकी आशा कार्यकर्ता खोज रहे हैं')} rows={1} />;
  }

  if (error) {
    return (
      <ErrorState
        title={t('We could not look her up', 'जानकारी नहीं मिल सकी')}
        body={
          error.message ||
          t(
            'The server could not be reached. This is a connection problem, not a sign that no worker covers your village.',
            'सर्वर तक नहीं पहुँच सके। यह कनेक्शन की समस्या है — इसका मतलब यह नहीं कि आपके गाँव में कोई कार्यकर्ता नहीं है।',
          )
        }
        onRetry={onRetry}
        retryLabel={t('Try again', 'फिर कोशिश करें')}
      />
    );
  }

  const asha = contact?.asha ?? null;

  /* No worker resolved. The server said why; that sentence is the
     whole content of this state. Inventing a name or a number here
     would be the single most harmful thing this screen could do. */
  if (!asha) {
    const helpline = contact?.helpline ?? null;
    return (
      <div className="space-y-4">
        <ServerNote>
          {contact?.note ||
            t(
              'No ASHA worker is recorded for your village yet.',
              'आपके गाँव के लिए अभी कोई आशा कार्यकर्ता दर्ज नहीं है।',
            )}
        </ServerNote>

        {helpline?.number ? (
          <Card tone="seal" className="p-5 sm:p-6">
            <Eyebrow>{t('In the meantime', 'तब तक')}</Eyebrow>
            <h3 className="display-md mt-3 text-xl">
              {helpline.label ||
                t('Government health helpline', 'सरकारी स्वास्थ्य हेल्पलाइन')}
            </h3>
            <p className="figure mt-3 text-4xl">{helpline.number}</p>
            <div className="mt-5">
              <Btn as="a" href={`tel:${helpline.number}`} variant="primary" size="lg">
                <Phone size={18} aria-hidden="true" />
                {t('Call the helpline', 'हेल्पलाइन पर कॉल करें')}
              </Btn>
            </div>
          </Card>
        ) : null}

        <Card className="p-5">
          <p className="text-[0.9rem] leading-relaxed text-ink-soft">
            {t(
              'If your village is missing from your profile, adding it will connect you to the worker who covers it.',
              'अगर आपकी प्रोफ़ाइल में गाँव दर्ज नहीं है, तो उसे जोड़ने पर आप वहाँ की कार्यकर्ता से जुड़ जाएँगे।',
            )}
          </p>
          <div className="mt-4">
            <Btn as={Link} href="/profile" variant="outline">
              {t('Open my profile', 'मेरी प्रोफ़ाइल खोलें')}
            </Btn>
          </div>
        </Card>
      </div>
    );
  }

  const alsoCovering = contact?.alsoCovering ?? [];

  return (
    <div className="space-y-4">
      <Card tone="asha" className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>{t('Your ASHA worker', 'आपकी आशा कार्यकर्ता')}</Eyebrow>
          {asha.isPrimary ? (
            <Pill tone="asha">{t('Primary for your village', 'आपके गाँव की मुख्य कार्यकर्ता')}</Pill>
          ) : null}
        </div>

        <h3 className="display-md mt-3 text-2xl sm:text-3xl">{asha.fullName}</h3>

        <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {contact.village ? (
            <div>
              <Eyebrow>{t('Village', 'गाँव')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">{contact.village}</p>
            </div>
          ) : null}
          {asha.subCentre ? (
            <div>
              <Eyebrow>{t('Sub-centre', 'उपकेंद्र')}</Eyebrow>
              <p className="mt-1.5 text-[0.95rem] text-ink">{asha.subCentre}</p>
            </div>
          ) : null}
          {asha.ashaCode ? (
            <div>
              <Eyebrow>{t('ASHA code', 'आशा कोड')}</Eyebrow>
              <p className="mt-1.5 font-mono text-[0.95rem] text-ink">{asha.ashaCode}</p>
            </div>
          ) : null}
          {asha.phone ? (
            <div>
              <Eyebrow>{t('Phone', 'फ़ोन')}</Eyebrow>
              <p className="figure mt-1.5 text-2xl">{asha.phone}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-7 flex flex-wrap gap-3">
          {/* A call is the fastest thing available to somebody standing
              in a courtyard with a sick child, so it is the primary
              action and the number is shown in full above it. */}
          {asha.phone ? (
            <Btn as="a" href={`tel:${asha.phone}`} variant="asha" size="lg">
              <Phone size={18} aria-hidden="true" />
              {t('Call her now', 'अभी कॉल करें')}
            </Btn>
          ) : null}
          <Btn variant="outline" size="lg" onClick={() => onStart(asha)} disabled={starting}>
            {starting ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare size={18} aria-hidden="true" />
            )}
            {t('Send a message instead', 'संदेश भेजें')}
          </Btn>
        </div>

        {!asha.phone ? (
          <p className="mt-5 text-[0.85rem] leading-relaxed text-ink-faint">
            {t(
              'Her number is not on record, so messaging is the only way to reach her from here.',
              'उनका नंबर दर्ज नहीं है, इसलिए यहाँ से संदेश भेजना ही उन तक पहुँचने का तरीक़ा है।',
            )}
          </p>
        ) : null}

        {startError ? (
          <p className="mt-5 text-[0.9rem] leading-relaxed text-siren" role="alert">
            {startError}
          </p>
        ) : null}
      </Card>

      {alsoCovering.length > 0 ? (
        <Card className="p-5">
          <Eyebrow>{t('Also covering your village', 'आपके गाँव में और भी')}</Eyebrow>
          <ul className="mt-3 space-y-2.5">
            {alsoCovering.map((worker) => (
              <li
                key={worker.userId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
              >
                <span className="text-[0.95rem] text-ink">{worker.fullName}</span>
                {worker.phone ? (
                  <a
                    href={`tel:${worker.phone}`}
                    className="font-mono text-[0.9rem] text-asha underline decoration-rule underline-offset-4"
                  >
                    {worker.phone}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {contact.source ? (
        <p className="text-[0.8rem] text-ink-faint">
          {t('Source', 'स्रोत')}: {contact.source}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------
   One conversation, read like a text-message screen.
   ------------------------------------------------------------- */

function Thread({ threadId, t, deva }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  /* Older pages are held apart from the live payload so that appending
     a sent message does not throw away history already fetched.
     `cursor` and `hasMore` stay undefined until the reader asks for
     older messages, at which point they take over from the first
     response's values. */
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
    setSendError(null);
  }, [threadId]);

  useEffect(() => {
    // A conversation opens at the bottom, the way a message app does.
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  const counterpartyName =
    thread?.counterparty?.fullName ||
    (thread?.counterparty?.side === 'asha'
      ? t('ASHA worker', 'आशा कार्यकर्ता')
      : t('Resident', 'निवासी'));

  async function loadEarlier() {
    if (!before) return;
    setLoadingEarlier(true);
    try {
      const olderPage = await getThreadMessages(threadId, { before });
      setOlder((prev) => ({
        rows: [...(olderPage?.messages ?? []), ...prev.rows],
        cursor: olderPage?.nextBefore ?? null,
        hasMore: Boolean(olderPage?.hasMore),
      }));
    } catch (e) {
      setSendError(e.message);
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSendError(null);
    setSending(true);
    try {
      const result = await sendThreadMessage(threadId, body);
      // The message shown is the row the server stored, so its id and
      // timestamp are real. Nothing is drawn optimistically: a message
      // that appears on screen has been accepted.
      if (result?.message) {
        view.setData((prev) =>
          prev ? { ...prev, messages: [...(prev.messages ?? []), result.message] } : prev,
        );
      }
      setDraft('');
    } catch (e) {
      setSendError(e.message);
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

  const closed = Boolean(thread?.closed);
  let lastDay = null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Btn variant="outline" onClick={() => navigate('/messages')}>
            <ArrowLeft size={17} aria-hidden="true" />
            {t('All conversations', 'सभी बातचीत')}
          </Btn>
          {closed ? <Pill>{t('Closed', 'बंद')}</Pill> : null}
        </div>
        <Btn variant="outline" onClick={view.reload}>
          <RotateCw size={16} aria-hidden="true" />
          {t('Refresh', 'ताज़ा करें')}
        </Btn>
      </div>

      <Card className="p-5">
        <Eyebrow>{t('Conversation with', 'बातचीत')}</Eyebrow>
        <h3 className="display-md mt-2 text-xl">{counterpartyName}</h3>
        {thread?.subject ? (
          <p className="mt-2 text-[0.9rem] text-ink-soft">{thread.subject}</p>
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
            'Write the first message below. Say what the problem is and who it is about.',
            'नीचे पहला संदेश लिखें। बताएँ कि समस्या क्या है और किसे है।',
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
                    <p className="eyebrow">
                      {m.mine ? t('You', 'आप') : counterpartyName}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-[0.95rem] leading-relaxed text-ink">
                      {m.body}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-[0.75rem] text-ink-faint">
                      <span>{clockTime(m.createdAt, deva)}</span>
                      {m.mine ? (
                        /* "Read" only when the server recorded a read
                           timestamp. Anything before that is "sent" —
                           we know it was accepted, not that it arrived
                           in front of anybody. */
                        <span>
                          {m.readAt
                            ? t('Read', 'पढ़ा गया')
                            : t('Sent', 'भेजा गया')}
                        </span>
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
            'This conversation has been closed, so no new messages can be added to it. Start a new one if something else comes up.',
            'यह बातचीत बंद कर दी गई है, इसलिए इसमें नए संदेश नहीं जोड़े जा सकते। कुछ और हो तो नई बातचीत शुरू करें।',
          )}
        </ServerNote>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="reply-body" className="eyebrow block">
            {t('Your message', 'आपका संदेश')}
          </label>
          <textarea
            id="reply-body"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
            rows={4}
            className="field w-full resize-y"
            placeholder={t(
              'What is happening, and who is it about?',
              'क्या हो रहा है, और किसे हो रहा है?',
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[0.8rem] text-ink-faint">
              {draft.length} / {MAX_BODY}
            </span>
            <Btn type="submit" disabled={sending || draft.trim().length === 0}>
              {sending ? (
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
              ) : (
                <Send size={17} aria-hidden="true" />
              )}
              {t('Send', 'भेजें')}
            </Btn>
          </div>
          {sendError ? (
            <p className="text-[0.9rem] leading-relaxed text-siren" role="alert">
              {sendError}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   The list of conversations.
   ------------------------------------------------------------- */

function ThreadList({ threads, note, t, deva }) {
  if (threads.length === 0) {
    return (
      <EmptyState
        title={t('No conversations yet', 'अभी कोई बातचीत नहीं')}
        body={
          note ||
          t(
            'Anything you send will appear here, along with her replies.',
            'आप जो भेजेंगे वह और उनके जवाब यहाँ दिखेंगे।',
          )
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {threads.map((thread, i) => {
        const name =
          thread.counterparty?.fullName ||
          (thread.counterparty?.side === 'asha'
            ? t('ASHA worker', 'आशा कार्यकर्ता')
            : t('Resident', 'निवासी'));

        return (
          <li key={thread.id}>
            <Card
              as={Link}
              href={`/messages/${thread.id}`}
              lift
              tone={thread.unreadCount > 0 ? 'seal' : undefined}
              className="block p-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="reg-index">{String(i + 1).padStart(3, '0')}</span>
                {thread.unreadCount > 0 ? (
                  <Pill tone="seal">
                    {t(`${thread.unreadCount} new`, `${thread.unreadCount} नए`)}
                  </Pill>
                ) : null}
                {thread.closed ? <Pill>{t('Closed', 'बंद')}</Pill> : null}
              </div>

              <h3 className="display-md mt-3 text-lg">{name}</h3>

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

export function Messages({ params }) {
  const { language, isAuthenticated, loading: authLoading } = useAuth();
  const t = getT(language);
  const deva = t.isHindi;
  const [, navigate] = useLocation();

  const threadId = params?.id ?? null;

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  const contact = useAsync(() => getAshaContact(), [], { skip: !isAuthenticated });
  const threads = useAsync(() => getMessageThreads(), [threadId], {
    skip: !isAuthenticated || Boolean(threadId),
  });

  const startConversation = useCallback(
    async (asha) => {
      setStartError(null);
      setStarting(true);
      try {
        // Find-or-create, so pressing this twice does not leave two
        // conversations with the same person.
        const result = await openMessageThread({ ashaId: asha?.userId });
        if (result?.thread?.id) navigate(`/messages/${result.thread.id}`);
      } catch (e) {
        setStartError(e.message);
      } finally {
        setStarting(false);
      }
    },
    [navigate],
  );

  return (
    <main className={`shell reg-paper pad-bottom-nav pt-8 sm:pt-12 ${deva ? 'is-deva' : ''}`}>
      <header className="border-b border-rule pb-10">
        <Eyebrow>{t('Register · Contact', 'रजिस्टर · संपर्क')}</Eyebrow>
        <h1 className="display-lg mt-4 max-w-3xl">
          {t('Reach your ASHA worker', 'अपनी आशा कार्यकर्ता से संपर्क')}
        </h1>
        <p className="lede mt-5 max-w-2xl">
          {t(
            'Call her, or write to her here and she will see it the next time she opens her register. Both go to the worker recorded for your village — nobody else.',
            'उन्हें कॉल करें, या यहाँ लिखें — वे अपना रजिस्टर खोलते ही देख लेंगी। दोनों आपके गाँव के लिए दर्ज कार्यकर्ता तक ही जाते हैं, किसी और तक नहीं।',
          )}
        </p>
      </header>

      {!isAuthenticated && !authLoading ? (
        <section className="mt-10">
          <EmptyState
            stamp={false}
            title={t('Sign in to see her details', 'जानकारी देखने के लिए साइन इन करें')}
            body={t(
              'Which ASHA worker covers you depends on the village on your profile, so we need to know who you are first.',
              'कौन-सी आशा कार्यकर्ता आपके क्षेत्र में है, यह आपकी प्रोफ़ाइल के गाँव पर निर्भर करता है — इसलिए पहले पहचान ज़रूरी है।',
            )}
            action={
              <Btn as={Link} href="/onboarding">
                {t('Sign in', 'साइन इन')}
              </Btn>
            }
          />
        </section>
      ) : threadId ? (
        <section className="mt-10">
          <Thread threadId={threadId} t={t} deva={deva} />
        </section>
      ) : (
        <>
          {/* ================= 01 · Her details ================= */}
          <section className="mt-10">
            <SectionHead
              index="01"
              eyebrow={t('Who covers your village', 'आपके गाँव की कार्यकर्ता')}
              title={t('Her name and her number', 'उनका नाम और नंबर')}
            />
            <div className="mt-6">
              <ContactPanel
                contact={contact.data}
                loading={contact.loading}
                error={contact.error}
                onRetry={contact.reload}
                t={t}
                deva={deva}
                onStart={startConversation}
                starting={starting}
                startError={startError}
              />
            </div>
          </section>

          {/* ================= 02 · Conversations ================= */}
          <section className="mt-14">
            <SectionHead
              index="02"
              eyebrow={t('Messages', 'संदेश')}
              title={t('Your conversations', 'आपकी बातचीत')}
              sub={
                threads.data?.unreadTotal
                  ? t(
                      `${threads.data.unreadTotal} unread`,
                      `${threads.data.unreadTotal} अनपढ़े`,
                    )
                  : undefined
              }
              action={
                <Btn variant="outline" onClick={threads.reload}>
                  <RotateCw size={16} aria-hidden="true" />
                  {t('Refresh', 'ताज़ा करें')}
                </Btn>
              }
            />
            <div className="mt-6">
              {threads.loading ? (
                <LoadingState label={t('Loading conversations', 'बातचीत लोड हो रही है')} rows={2} />
              ) : threads.error ? (
                <ErrorState
                  title={t('Conversations did not load', 'बातचीत लोड नहीं हुई')}
                  body={threads.error.message}
                  onRetry={threads.reload}
                  retryLabel={t('Try again', 'फिर कोशिश करें')}
                />
              ) : (
                <ThreadList
                  threads={threads.data?.threads ?? []}
                  note={threads.data?.note}
                  t={t}
                  deva={deva}
                />
              )}
            </div>
          </section>

          {/* ================= 03 · What this is not ================= */}
          <section className="mt-14">
            <SectionHead
              index="03"
              eyebrow={t('Before you write', 'लिखने से पहले')}
              title={t('This is not an emergency line', 'यह आपातकालीन लाइन नहीं है')}
            />
            <div className="mt-6 space-y-4">
              <Card tone="siren" className="p-5 sm:p-6">
                <p className="text-[0.95rem] leading-relaxed text-ink-soft">
                  {t(
                    'A message waits until she reads it. If somebody cannot breathe, is bleeding heavily, is unconscious, or is in labour with something wrong, do not write here.',
                    'संदेश उनके पढ़ने तक रुका रहता है। अगर किसी को साँस नहीं आ रही, बहुत ख़ून बह रहा है, वे बेहोश हैं, या प्रसव में कोई गड़बड़ है — तो यहाँ न लिखें।',
                  )}
                </p>
                <div className="mt-5">
                  <Btn as={Link} href="/emergency" variant="siren" size="lg">
                    {t('Get emergency help', 'आपातकालीन मदद लें')}
                  </Btn>
                </div>
              </Card>
              <Card className="p-5">
                <Eyebrow>{t('Also on this app', 'इस ऐप में और')}</Eyebrow>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">
                  {t(
                    'Notices she sends to the whole village are kept separately, so this list stays as your own conversation.',
                    'वे पूरे गाँव को जो सूचनाएँ भेजती हैं वे अलग रखी जाती हैं, जिससे यह सूची आपकी अपनी बातचीत रहे।',
                  )}
                </p>
                <div className="mt-4">
                  <Btn as={Link} href="/notifications" variant="outline">
                    {t('Read village notices', 'गाँव की सूचनाएँ पढ़ें')}
                  </Btn>
                </div>
              </Card>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
