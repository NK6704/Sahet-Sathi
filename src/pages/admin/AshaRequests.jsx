import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  Check,
  X,
  Upload,
  Copy,
  Info,
  Loader2,
  ShieldCheck,
  Clock,
  ChevronDown,
  RotateCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getAshaRequests,
  approveAshaRequest,
  rejectAshaRequest,
  uploadAshaRoster,
} from '@/services/platform';
import {
  Btn,
  Card,
  Eyebrow,
  EmptyState,
  ErrorState,
  InferenceNote,
  LoadingState,
  Pill,
  SectionHead,
  Stamp,
} from '@/components/ds';

/* =============================================================
   /admin/asha-requests — who becomes a health worker.

   An approval here promotes a citizen account into an ASHA account,
   which means the ability to broadcast to a whole village and to see
   a household's emergency. It is the most consequential button in
   the product, so the screen is built around one question: what can
   the person clicking it actually check?

   Honestly, less than one would like, and the screen says so rather
   than implying otherwise. asha_roster has row-level security on
   with no policy and its grants revoked, so the official roster
   cannot be read from a browser at all — reading it plus guessing a
   short code would be enough to impersonate a worker. Everything in
   a request is therefore what the applicant typed, and it is laid
   out as a list to check against the roster the reviewer holds, not
   dressed up as verified.

   The one comparison this screen can honestly make is against a
   roster uploaded in this session, because those rows came back in
   the upload response. That match matters: if she is on the roster
   already, the right answer is usually to hand her the invite code
   rather than to approve her by hand, which would create the same
   worker twice under one code.
   ============================================================= */

const STATUSES = [
  { key: 'pending', en: 'Waiting', hi: 'प्रतीक्षा में' },
  { key: 'approved', en: 'Approved', hi: 'स्वीकृत' },
  { key: 'rejected', en: 'Not approved', hi: 'अस्वीकृत' },
  { key: 'withdrawn', en: 'Withdrawn', hi: 'वापस लिए गए' },
];

/**
 * The documented column order for a pasted roster. Fixed rather than
 * inferred from a header row: a mis-mapped column would put one
 * worker's invite code against another worker's name.
 */
const ROSTER_COLUMNS = [
  { key: 'ashaCode', en: 'ASHA code', hi: 'आशा कोड', required: true },
  { key: 'fullName', en: 'Full name', hi: 'पूरा नाम', required: true },
  { key: 'phone', en: 'Phone', hi: 'फ़ोन' },
  { key: 'subCentre', en: 'Sub-centre', hi: 'उप-केंद्र' },
  { key: 'block', en: 'Block', hi: 'ब्लॉक' },
  { key: 'district', en: 'District', hi: 'ज़िला' },
  { key: 'state', en: 'State', hi: 'राज्य' },
  { key: 'villageNames', en: 'Villages, separated by |', hi: 'गाँव, | से अलग' },
  { key: 'supervisorName', en: 'Supervisor', hi: 'पर्यवेक्षक' },
  { key: 'supervisorPhone', en: 'Supervisor’s phone', hi: 'पर्यवेक्षक का फ़ोन' },
];

/** The server refuses more than this in one body, and says why. */
const MAX_ROSTER_ROWS = 500;

export function AdminAshaRequests() {
  const { language } = useAuth();
  const t = getT(language);

  const [status, setStatus] = useState('pending');
  const [outcome, setOutcome] = useState(null);

  // Rows from a roster uploaded in this session — the only thing on this
  // screen a request can honestly be compared against.
  const [uploaded, setUploaded] = useState([]);

  const queue = useAsync(() => getAshaRequests({ status }), [status]);
  const requests = queue.data?.requests ?? [];
  const total = queue.data?.total ?? 0;

  return (
    <main className="shell py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <SectionHead
          index="01"
          eyebrow={t('Administration · ASHA registrations', 'प्रशासन · आशा पंजीकरण')}
          title={t('Registration queue', 'पंजीकरण सूची')}
          sub={t(
            'Approving a request turns a citizen account into a health worker account: it can then message a whole village and open a household’s emergency. Check each one against the roster you hold before you approve it.',
            'अनुरोध स्वीकार करने पर नागरिक खाता स्वास्थ्य कार्यकर्ता खाता बन जाता है: फिर वह पूरे गाँव को संदेश भेज सकता है और किसी परिवार की आपात सूचना खोल सकता है। स्वीकृति से पहले हर अनुरोध को अपने पास की रोस्टर सूची से मिलाएँ।',
          )}
          className="mb-8"
        />

        {/* What this screen can and cannot verify, said once, at the top. */}
        <Card className="mb-8 flex items-start gap-3 p-5">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-seal" strokeWidth={2.2} aria-hidden="true" />
          <p className="min-w-0 text-[0.85rem] leading-relaxed text-ink-soft">
            {t(
              'Every value in a request is what the applicant typed. The official roster is not readable from this screen by design, so nothing below has been checked for you.',
              'अनुरोध में हर जानकारी वही है जो आवेदक ने भरी। आधिकारिक रोस्टर इस पन्ने से जान-बूझकर नहीं पढ़ा जा सकता, इसलिए नीचे कुछ भी पहले से जाँचा हुआ नहीं है।',
            )}
          </p>
        </Card>

        {outcome ? <Outcome outcome={outcome} t={t} onDismiss={() => setOutcome(null)} /> : null}

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {STATUSES.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatus(tab.key)}
              aria-pressed={status === tab.key}
              className={`inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.875rem] font-semibold transition-colors ${
                status === tab.key
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule text-ink-soft hover:border-ink hover:text-ink'
              }`}
            >
              {t(tab.en, tab.hi)}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-3">
            {queue.data ? (
              <Pill tone={status === 'pending' && total > 0 ? 'amber' : 'neutral'}>
                {total} {t('in this list', 'इस सूची में')}
              </Pill>
            ) : null}
            <button
              type="button"
              onClick={queue.reload}
              className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-ink-faint transition hover:text-ink"
            >
              <RotateCw size={14} aria-hidden="true" />
              {t('Reload', 'फिर लोड करें')}
            </button>
          </span>
        </div>

        {queue.loading ? (
          <LoadingState label={t('Loading the queue', 'सूची लोड हो रही है')} rows={2} />
        ) : queue.error ? (
          <ErrorState
            title={t('We could not load the queue', 'सूची लोड नहीं हो सकी')}
            body={queue.error.message}
            onRetry={queue.reload}
            retryLabel={t('Try again', 'फिर कोशिश करें')}
          />
        ) : requests.length === 0 ? (
          <EmptyState
            title={
              status === 'pending'
                ? t('Nothing is waiting', 'कुछ भी प्रतीक्षा में नहीं')
                : t('Nothing in this list', 'इस सूची में कुछ नहीं')
            }
            body={
              status === 'pending'
                ? t(
                    'No worker has asked to be registered. Workers on an uploaded roster register themselves with an invite code and never appear here.',
                    'किसी कार्यकर्ता ने पंजीकरण नहीं माँगा है। अपलोड रोस्टर वाली कार्यकर्ता निमंत्रण कोड से स्वयं पंजीकरण करती हैं और यहाँ नहीं दिखतीं।',
                  )
                : null
            }
          />
        ) : (
          <div className="space-y-5">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                uploaded={uploaded}
                t={t}
                onDecided={(result) => {
                  setOutcome(result);
                  queue.reload();
                }}
              />
            ))}
          </div>
        )}

        {/* Only the first page is reachable: getAshaRequests sends page and
            size while this endpoint reads limit and offset, so a pager here
            would move nothing. Said plainly rather than rendered as
            controls that do nothing. */}
        {queue.data?.hasMore ? (
          <p className="mt-6 flex gap-2.5 text-[0.8rem] leading-relaxed text-ink-faint">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {status === 'pending'
                ? t(
                    `The oldest ${requests.length} of ${total} are shown. Work through these and reload — the next ones take their place as each is decided.`,
                    `${total} में से सबसे पुराने ${requests.length} दिख रहे हैं। इन्हें निपटाकर फिर लोड करें — हर निर्णय के बाद अगले आ जाएँगे।`,
                  )
                : t(
                    `The ${requests.length} most recent of ${total} are shown.`,
                    `${total} में से सबसे नए ${requests.length} दिख रहे हैं।`,
                  )}
            </span>
          </p>
        ) : null}

        <RosterUpload t={t} onUploaded={(rows) => setUploaded((prev) => [...rows, ...prev])} />

        <p className="mt-10 text-[0.8rem] text-ink-faint">
          <Link href="/asha" className="font-semibold text-seal underline-offset-2 hover:underline">
            {t('Back to the portal', 'पोर्टल पर वापस')}
          </Link>
        </p>
      </div>
    </main>
  );
}

/* =============================================================
   One request
   ============================================================= */

function RequestCard({ request, uploaded, t }) {
  const [panel, setPanel] = useState(null); // 'approve' | 'reject' | null
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [decided, setDecided] = useState(null);

  // Case-insensitive on the code, because a roster file and a worker
  // writing her own code by hand will not agree on capitals.
  const rosterMatch = useMemo(() => {
    const claimed = String(request.asha_code_claimed ?? '').trim().toLowerCase();
    if (!claimed) return null;
    return uploaded.find((row) => String(row.ashaCode ?? '').trim().toLowerCase() === claimed) ?? null;
  }, [request.asha_code_claimed, uploaded]);

  const pending = request.status === 'pending';

  async function decide(kind) {
    setError(null);

    if (kind === 'reject' && !note.trim()) {
      setError(
        t(
          'Give a reason. The worker sees it, and the next reviewer needs to know why this was turned down.',
          'कारण लिखें। कार्यकर्ता इसे देखती है, और अगले जाँचकर्ता को पता होना चाहिए कि इसे क्यों अस्वीकार किया गया।',
        ),
      );
      return;
    }

    setBusy(true);
    try {
      if (kind === 'approve') {
        const result = await approveAshaRequest(request.id, note.trim() || undefined);
        setDecided({ kind: 'approved', ...result, name: request.full_name });
      } else {
        await rejectAshaRequest(request.id, note.trim());
        setDecided({ kind: 'rejected', name: request.full_name });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (decided) {
    return (
      <Card tone={decided.kind === 'approved' ? 'seal' : 'neutral'} className="p-6">
        <Stamp
          kind={decided.kind === 'approved' ? 'verified' : 'none'}
          label={
            decided.kind === 'approved'
              ? t('Approved', 'स्वीकृत')
              : t('Not approved', 'अस्वीकृत')
          }
        />
        <p className="mt-4 text-[0.95rem] font-semibold text-ink">{decided.name}</p>
        {decided.kind === 'approved' ? (
          <>
            <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">
              {t('Registered under ASHA code ', 'आशा कोड ')}
              <span className="font-semibold text-ink">{decided.ashaCode}</span>
              {t('.', ' के साथ पंजीकृत।')}
            </p>
            {decided.provisional ? (
              <InferenceNote className="mt-4">
                {t(
                  'That code is provisional: she gave no official code, so the database minted a temporary one. Replace it once her block office issues the real number — it is not a block office code and should not be read as one.',
                  'यह कोड अस्थायी है: उन्होंने कोई आधिकारिक कोड नहीं दिया, इसलिए डेटाबेस ने अस्थायी कोड बनाया। ब्लॉक कार्यालय से असली नंबर मिलने पर इसे बदलें — यह ब्लॉक कार्यालय का कोड नहीं है।',
                )}
              </InferenceNote>
            ) : null}
            {decided.note ? (
              <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">{decided.note}</p>
            ) : null}
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <Card tone={pending ? 'amber' : 'neutral'} className="p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Eyebrow>{t('Applicant’s own words', 'आवेदक के दिए विवरण')}</Eyebrow>
          <h3 className="display-md mt-2 text-xl">{request.full_name}</h3>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Stamp
            kind={
              request.status === 'approved'
                ? 'verified'
                : request.status === 'pending'
                  ? 'inferred'
                  : 'none'
            }
            label={statusLabel(request.status, t)}
          />
          <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-faint">
            <Clock size={12} aria-hidden="true" />
            {formatDate(request.created_at, t.isHindi)}
          </span>
        </div>
      </div>

      <dl className="mt-6 space-y-3 border-t border-rule pt-5">
        <Row label={t('Phone', 'फ़ोन')} value={request.phone} />
        <Row label={t('ASHA code claimed', 'बताया गया आशा कोड')} value={request.asha_code_claimed} />
        <Row label={t('Village', 'गाँव')} value={request.village_name} />
        <Row label={t('Sub-centre', 'उप-केंद्र')} value={request.sub_centre} />
        <Row label={t('Block', 'ब्लॉक')} value={request.block} />
        <Row label={t('District', 'ज़िला')} value={request.district} />
        <Row label={t('State', 'राज्य')} value={request.state} />
        <Row label={t('Supervisor', 'पर्यवेक्षक')} value={request.supervisor_name} />
        <Row label={t('Supervisor’s phone', 'पर्यवेक्षक का फ़ोन')} value={request.supervisor_phone} />
      </dl>

      {request.note ? (
        <blockquote className="mt-5 border-l-2 border-rule pl-4 text-[0.85rem] leading-relaxed text-ink-soft">
          {request.note}
        </blockquote>
      ) : null}

      {/* The comparison column. Either there is a roster row from this
          session to hold it against, or the screen says there is not. */}
      <div className="mt-6 border-t border-rule pt-5">
        <Eyebrow>{t('Roster check', 'रोस्टर जाँच')}</Eyebrow>
        {rosterMatch ? (
          <div className="mt-3">
            <Stamp kind="verified" label={t('On the roster you uploaded', 'आपके अपलोड रोस्टर में है')} />
            <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
              {t('That code belongs to ', 'यह कोड ')}
              <span className="font-semibold text-ink">{rosterMatch.fullName}</span>
              {t(
                ' on the roster uploaded in this session. If the names agree, hand her the invite code instead of approving this — approving would register the same worker a second time under the same code, and the roster row would then be unclaimable.',
                ' का है, जो इस सत्र में अपलोड किए रोस्टर में दर्ज है। नाम मिलते हों तो इसे स्वीकार करने के बजाय उन्हें निमंत्रण कोड दें — स्वीकृति से वही कार्यकर्ता उसी कोड से दूसरी बार पंजीकृत होगी और रोस्टर पंक्ति फिर कभी दावा नहीं की जा सकेगी।',
              )}
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <Stamp kind="none" label={t('Nothing to compare', 'मिलाने के लिए कुछ नहीं')} />
            <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">
              {t(
                'The official roster cannot be read from this screen, so check the details above against the roster you hold — or telephone the supervisor named. A request that agrees with nothing should not be approved.',
                'आधिकारिक रोस्टर इस पन्ने से नहीं पढ़ा जा सकता, इसलिए ऊपर के विवरण अपने पास की सूची से मिलाएँ — या दिए गए पर्यवेक्षक को फ़ोन करें। जो अनुरोध किसी से मेल न खाए, उसे स्वीकार न करें।',
              )}
            </p>
          </div>
        )}
      </div>

      {request.review_note ? (
        <div className="mt-6 border-t border-rule pt-5">
          <Eyebrow>{t('Reviewer’s note', 'जाँचकर्ता की टिप्पणी')}</Eyebrow>
          <p className="mt-2.5 text-[0.85rem] leading-relaxed text-ink-soft">{request.review_note}</p>
        </div>
      ) : null}

      {pending ? (
        <div className="mt-7 border-t border-rule pt-6">
          {panel === null ? (
            <div className="flex flex-wrap gap-3">
              <Btn variant="primary" onClick={() => { setPanel('approve'); setNote(''); setError(null); }}>
                <Check size={16} aria-hidden="true" />
                {t('Approve', 'स्वीकार करें')}
              </Btn>
              <Btn variant="outline" onClick={() => { setPanel('reject'); setNote(''); setError(null); }}>
                <X size={16} aria-hidden="true" />
                {t('Do not approve', 'स्वीकार न करें')}
              </Btn>
            </div>
          ) : (
            <div>
              <label className="block">
                <span className="eyebrow">
                  {panel === 'approve'
                    ? t('Note for the record (optional)', 'रिकॉर्ड के लिए टिप्पणी (वैकल्पिक)')
                    : t('Reason (required)', 'कारण (आवश्यक)')}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="field mt-2 w-full resize-y"
                  placeholder={
                    panel === 'approve'
                      ? t('For example: confirmed by telephone with the block office.', 'उदाहरण: ब्लॉक कार्यालय से फ़ोन पर पुष्टि हुई।')
                      : t('For example: name is not on the block roster for this sub-centre.', 'उदाहरण: इस उप-केंद्र की ब्लॉक सूची में नाम नहीं है।')
                  }
                />
              </label>

              {panel === 'approve' ? (
                <InferenceNote className="mt-4">
                  {t(
                    'This promotes the account immediately and binds it to the village named above, which is the village she will be able to message.',
                    'इससे खाता तुरंत पदोन्नत होता है और ऊपर लिखे गाँव से जुड़ जाता है — वही गाँव जिसे वे संदेश भेज सकेंगी।',
                  )}
                </InferenceNote>
              ) : (
                <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
                  {t(
                    'She can read this reason and file a corrected request afterwards.',
                    'वे यह कारण पढ़ सकती हैं और सुधार कर दोबारा अनुरोध भेज सकती हैं।',
                  )}
                </p>
              )}

              {error ? (
                <p className="mt-4 text-sm font-semibold leading-relaxed text-siren" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <Btn
                  variant={panel === 'approve' ? 'primary' : 'siren'}
                  onClick={() => decide(panel)}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                  {panel === 'approve'
                    ? t('Confirm approval', 'स्वीकृति की पुष्टि करें')
                    : t('Confirm rejection', 'अस्वीकृति की पुष्टि करें')}
                </Btn>
                <Btn variant="outline" onClick={() => { setPanel(null); setError(null); }} disabled={busy}>
                  {t('Cancel', 'रद्द करें')}
                </Btn>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The result of the last decision, kept above the list because the row
 * it belongs to leaves the queue as soon as it is decided — and the
 * provisional-code warning has to survive that.
 */
function Outcome({ outcome, t, onDismiss }) {
  return (
    <Card tone={outcome.kind === 'approved' ? 'seal' : 'neutral'} className="mb-6 p-5" role="status">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Stamp
            kind={outcome.kind === 'approved' ? 'verified' : 'none'}
            label={outcome.kind === 'approved' ? t('Approved', 'स्वीकृत') : t('Not approved', 'अस्वीकृत')}
          />
          <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink">{outcome.name}</span>
            {outcome.kind === 'approved'
              ? t(' is now registered as an ASHA worker.', ' अब आशा कार्यकर्ता के रूप में पंजीकृत हैं।')
              : t(' was not approved, and the reason has been recorded.', ' को स्वीकार नहीं किया गया, कारण दर्ज है।')}
          </p>
          {outcome.provisional ? (
            <InferenceNote className="mt-3">
              {t(
                'Her ASHA code is provisional and was generated here, not issued by a block office.',
                'उनका आशा कोड अस्थायी है और यहीं बनाया गया है, किसी ब्लॉक कार्यालय ने जारी नहीं किया।',
              )}
            </InferenceNote>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('Dismiss', 'हटाएँ')}
          className="shrink-0 text-ink-faint transition hover:text-ink"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

/* =============================================================
   Roster upload
   ============================================================= */

function RosterUpload({ t, onUploaded }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(null);

  const parsed = useMemo(() => parseRoster(text), [text]);

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (!parsed.rows.length) {
      setError(t('Paste at least one roster row.', 'कम से कम एक रोस्टर पंक्ति चिपकाएँ।'));
      return;
    }
    if (parsed.problems.length) {
      setError(t('Fix the rows listed below first.', 'पहले नीचे बताई पंक्तियाँ सुधारें।'));
      return;
    }
    if (parsed.rows.length > MAX_ROSTER_ROWS) {
      setError(
        t(
          `Upload at most ${MAX_ROSTER_ROWS} rows at a time. Each invite code is shown once and cannot be recovered, so a smaller batch is easier to hand out without losing any.`,
          `एक बार में अधिकतम ${MAX_ROSTER_ROWS} पंक्तियाँ भेजें। हर निमंत्रण कोड एक ही बार दिखता है और फिर नहीं मिलता, इसलिए छोटे बैच बाँटना आसान रहता है।`,
        ),
      );
      return;
    }

    setBusy(true);
    try {
      const res = await uploadAshaRoster({ rows: parsed.rows, source: source.trim() || undefined });
      setResult(res);
      setText('');
      onUploaded(res.codes ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    const block = (result?.codes ?? [])
      .map((row) => `${row.ashaCode}\t${row.fullName}\t${row.inviteCode}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
    } catch {
      // Clipboard access is refused in plenty of contexts. The codes are
      // in a selectable box below either way, so this only reports.
      setCopied(false);
    }
  }

  return (
    <section className="mt-14">
      <SectionHead
        index="02"
        eyebrow={t('Roster', 'रोस्टर')}
        title={t('Upload the block office roster', 'ब्लॉक कार्यालय रोस्टर अपलोड करें')}
        sub={t(
          'Every row gets one single-use invite code, and a worker who has her code registers herself without waiting for anybody. This is the path that empties the queue above.',
          'हर पंक्ति के लिए एक बार चलने वाला निमंत्रण कोड बनता है, और कोड मिलने पर कार्यकर्ता किसी की प्रतीक्षा किए बिना स्वयं पंजीकरण कर लेती है। यही रास्ता ऊपर की सूची खाली रखता है।',
        )}
        className="mb-6"
      />

      {result ? <RosterResult result={result} t={t} onCopy={copyCodes} copied={copied} /> : null}

      <Card className="p-6 sm:p-7">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <span className="flex items-center gap-3">
            <Upload size={18} className="shrink-0 text-seal" strokeWidth={2.2} aria-hidden="true" />
            <span className="text-[0.95rem] font-semibold text-ink">
              {t('Paste roster rows', 'रोस्टर पंक्तियाँ चिपकाएँ')}
            </span>
          </span>
          <ChevronDown
            size={18}
            className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {open ? (
          <form onSubmit={submit} className="mt-6 space-y-5 border-t border-rule pt-6">
            <div>
              <Eyebrow>{t('One worker per line, in this order', 'हर पंक्ति में एक कार्यकर्ता, इसी क्रम में')}</Eyebrow>
              <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[0.8rem] text-ink-soft sm:grid-cols-2">
                {ROSTER_COLUMNS.map((column, index) => (
                  <li key={column.key} className="flex gap-2">
                    <span className="font-mono text-ink-faint">{index + 1}</span>
                    <span>
                      {t(column.en, column.hi)}
                      {column.required ? (
                        <span className="ml-1.5 font-semibold text-siren">
                          {t('required', 'आवश्यक')}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
                {t(
                  'Fields are separated by commas. A field containing a comma must be wrapped in double quotes. A first line naming the columns is ignored.',
                  'जानकारियाँ अल्पविराम से अलग करें। जिस जानकारी में अल्पविराम हो उसे दोहरे उद्धरण में रखें। स्तंभों के नाम वाली पहली पंक्ति छोड़ दी जाती है।',
                )}
              </p>
            </div>

            <label className="block">
              <span className="eyebrow">{t('Roster rows', 'रोस्टर पंक्तियाँ')}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                spellCheck={false}
                className="field mt-2 w-full resize-y font-mono text-[0.85rem]"
                placeholder={'ASHA-1042, Sunita Devi, 9876543210, Jamalpur SC, Jamalpur, Purnia, Bihar, Jamalpur|Rampur, Kiran Kumari, 9876500000'}
              />
            </label>

            <label className="block">
              <span className="eyebrow">{t('Where this roster came from', 'यह रोस्टर कहाँ से आया')}</span>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="field mt-2 w-full"
                placeholder={t('Block office roster, August 2026', 'ब्लॉक कार्यालय रोस्टर, अगस्त 2026')}
              />
              <span className="mt-2 block text-[0.8rem] leading-relaxed text-ink-faint">
                {t(
                  'Recorded on every row so a later reviewer knows which file a code came from.',
                  'हर पंक्ति पर दर्ज होता है ताकि बाद में जाँचने वाले को पता रहे कि कोड किस फ़ाइल से आया।',
                )}
              </span>
            </label>

            {/* Parsed before anything is sent. The server aborts the whole
                upload on the first bad row, so a mistake found here saves
                the admin a rejection that names row 37 and nothing else. */}
            {text.trim() ? (
              <div className="rounded-[var(--radius-sm)] bg-paper-3 p-4">
                <p className="text-[0.85rem] font-semibold text-ink">
                  {t(`${parsed.rows.length} row(s) read`, `${parsed.rows.length} पंक्ति पढ़ी गईं`)}
                </p>
                {parsed.problems.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {parsed.problems.map((problem) => (
                      <li key={problem.line + problem.kind} className="text-[0.8rem] leading-relaxed text-siren">
                        {t(`Line ${problem.line}: `, `पंक्ति ${problem.line}: `)}
                        {problem.kind === 'missing'
                          ? t('an ASHA code and a full name are both needed.', 'आशा कोड और पूरा नाम दोनों ज़रूरी हैं।')
                          : t(
                              `ASHA code ${problem.value} appears more than once.`,
                              `आशा कोड ${problem.value} एक से अधिक बार आया है।`,
                            )}
                      </li>
                    ))}
                  </ul>
                ) : parsed.rows.length ? (
                  <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-soft">
                    {t('First row reads as: ', 'पहली पंक्ति इस तरह पढ़ी गई: ')}
                    <span className="font-semibold text-ink">{describeRow(parsed.rows[0])}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="flex gap-2.5 text-[0.8rem] leading-relaxed text-amber">
              <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t(
                  'Re-uploading a corrected roster is safe: a row a worker has already claimed keeps its claim and is skipped rather than issued a new code.',
                  'सुधरा हुआ रोस्टर फिर अपलोड करना सुरक्षित है: जिस पंक्ति पर कार्यकर्ता ने दावा कर लिया है, वह वैसी ही रहती है और उसे नया कोड नहीं मिलता।',
                )}
              </span>
            </p>

            {error ? (
              <p className="text-sm font-semibold leading-relaxed text-siren" role="alert">
                {error}
              </p>
            ) : null}

            <Btn type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                  {t('Uploading…', 'अपलोड हो रहा है…')}
                </>
              ) : (
                <>
                  <Upload size={17} aria-hidden="true" />
                  {t('Upload and issue invite codes', 'अपलोड करें और निमंत्रण कोड जारी करें')}
                </>
              )}
            </Btn>
          </form>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * The codes, shown once. The server's own warning is printed verbatim
 * because it is the only accurate statement of what has just happened:
 * these strings exist nowhere else in recoverable form.
 */
function RosterResult({ result, t, onCopy, copied }) {
  const codes = result.codes ?? [];
  const skipped = result.skipped ?? [];

  return (
    <Card tone="siren" className="mb-6 p-6 sm:p-7">
      <Stamp kind="urgent" label={t('Shown once', 'केवल एक बार दिखेगा')} />
      <h3 className="display-md mt-4 text-xl">
        {t('Copy these codes now', 'ये कोड अभी कॉपी कर लें')}
      </h3>
      <p className="mt-3 text-[0.85rem] leading-relaxed text-ink-soft">{result.warning}</p>

      {result.expiresAt ? (
        <p className="mt-3 text-[0.85rem] text-ink-soft">
          {t('They stop working after ', 'ये कोड ')}
          <span className="font-semibold text-ink">{formatDate(result.expiresAt, t.isHindi)}</span>
          {t('.', ' के बाद काम नहीं करेंगे।')}
        </p>
      ) : null}

      {codes.length ? (
        <>
          <textarea
            readOnly
            rows={Math.min(10, codes.length + 1)}
            value={codes.map((row) => `${row.ashaCode}\t${row.fullName}\t${row.inviteCode}`).join('\n')}
            className="field mt-5 w-full resize-y font-mono text-[0.85rem]"
            aria-label={t('Invite codes', 'निमंत्रण कोड')}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Btn variant="outline" onClick={onCopy}>
              <Copy size={16} aria-hidden="true" />
              {t('Copy all', 'सब कॉपी करें')}
            </Btn>
            {copied === true ? (
              <span className="text-[0.8rem] font-semibold text-seal">
                {t('Copied.', 'कॉपी हो गया।')}
              </span>
            ) : null}
            {copied === false ? (
              <span className="text-[0.8rem] font-semibold text-amber">
                {t('This browser refused the clipboard — select the box above instead.', 'इस ब्राउज़र ने क्लिपबोर्ड नहीं दिया — ऊपर के बॉक्स से चुनकर कॉपी करें।')}
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {skipped.length ? (
        <div className="mt-6 border-t border-rule pt-5">
          <Eyebrow>{t('No code issued for these', 'इनके लिए कोई कोड जारी नहीं हुआ')}</Eyebrow>
          <ul className="mt-3 space-y-1.5">
            {skipped.map((row) => (
              <li key={row.rosterId} className="text-[0.85rem] leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">{row.ashaCode}</span>
                {' — '}
                {row.reason === 'already_claimed'
                  ? t('a worker has already registered with this row.', 'इस पंक्ति से कोई कार्यकर्ता पहले ही पंजीकृत है।')
                  : t('the code could not be issued; upload this row again.', 'कोड जारी नहीं हो सका; यह पंक्ति फिर अपलोड करें।')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/* =============================================================
   Small pieces
   ============================================================= */

function Row({ label, value }) {
  const filled = value !== null && value !== undefined && String(value).trim() !== '';
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="eyebrow">{label}</dt>
      <dd className={`text-[0.9rem] ${filled ? 'font-semibold text-ink' : 'text-ink-faint'}`}>
        {filled ? String(value) : '—'}
      </dd>
    </div>
  );
}

function statusLabel(status, t) {
  if (status === 'pending') return t('Waiting for review', 'जाँच के लिए प्रतीक्षा');
  if (status === 'approved') return t('Approved', 'स्वीकृत');
  if (status === 'rejected') return t('Not approved', 'अस्वीकृत');
  if (status === 'withdrawn') return t('Withdrawn', 'वापस लिया गया');
  return status;
}

function formatDate(iso, hindi) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(hindi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function describeRow(row) {
  return [row.ashaCode, row.fullName, (row.villageNames ?? []).join(' | ')]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A comma-separated line, respecting double quotes. Written out rather
 * than split on ',' because a roster export quotes any field containing
 * a comma, and splitting naively would shift every later column by one —
 * which would put one worker's invite code beside another's name.
 */
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);

  return cells.map((value) => value.trim());
}

/**
 * Pasted text to the payload the server expects, plus whatever is wrong
 * with it. Both are returned: the caller shows the problems and refuses
 * to upload while any remain.
 */
function parseRoster(text) {
  const rows = [];
  const problems = [];
  const seen = new Set();

  const lines = String(text ?? '').split('\n');

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    const cells = splitCsvLine(line);

    // A header line is ignored rather than uploaded as a worker called
    // "Full name". Only the first line is treated this way.
    if (index === 0 && /^asha[_ ]?code$/i.test(cells[0] ?? '')) return;

    const [
      ashaCode,
      fullName,
      phone,
      subCentre,
      block,
      district,
      state,
      villages,
      supervisorName,
      supervisorPhone,
    ] = cells;

    if (!ashaCode || !fullName) {
      problems.push({ line: index + 1, kind: 'missing' });
      return;
    }

    const key = ashaCode.toLowerCase();
    if (seen.has(key)) {
      problems.push({ line: index + 1, kind: 'duplicate', value: ashaCode });
      return;
    }
    seen.add(key);

    rows.push({
      ashaCode,
      fullName,
      phone: phone || undefined,
      subCentre: subCentre || undefined,
      block: block || undefined,
      district: district || undefined,
      state: state || undefined,
      villageNames: (villages ?? '')
        .split('|')
        .map((name) => name.trim())
        .filter(Boolean),
      supervisorName: supervisorName || undefined,
      supervisorPhone: supervisorPhone || undefined,
    });
  });

  return { rows, problems };
}
