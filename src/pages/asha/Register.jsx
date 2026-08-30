import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  KeyRound,
  ClipboardList,
  ShieldCheck,
  Users,
  Clock,
  Undo2,
  Info,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { useAsync } from '@/lib/useAsync';
import {
  getMyAshaRegistrationRequest,
  submitAshaRegistrationRequest,
  withdrawAshaRegistrationRequest,
} from '@/services/platform';
import {
  Btn,
  Card,
  Eyebrow,
  ErrorState,
  InferenceNote,
  LoadingState,
  SectionHead,
  Stamp,
} from '@/components/ds';

/* =============================================================
   /asha/register — the only sanctioned way to become a worker.

   The requirement behind this page is blunt: no regular user may
   register herself into the ASHA section. So nothing on this page
   grants anything. There are exactly two paths and the difference
   between them is who made the decision.

     ROSTER CODE   The block office already decided when it put her
                   on the roster and issued a single-use code. The
                   server checks the code against a bcrypt hash it
                   never sends here, promotes the account and binds
                   it to that roster row's villages in one
                   transaction. No human is in the loop because the
                   decision was made before she arrived.

     REQUEST       For a worker who is genuinely an ASHA but is
                   missing from the uploaded file. Filing it grants
                   nothing at all: the row goes in as her own user
                   with status 'pending', her role stays 'citizen',
                   and an administrator checks her against the
                   official roster before approving.

   The page says both of those out loud. A gate a person cannot see
   reads as a bug; a gate explained is a gate she can satisfy.

   The village she names is load-bearing rather than decorative. It
   is what lets a notice she posts reach every registered resident
   of that village, so the form says so where she types it.
   ============================================================= */

/** Payload keys the server requires before it will accept a request. */
const REQUIRED = ['fullName', 'phone', 'villageName'];

const EMPTY_FORM = {
  fullName: '',
  phone: '',
  ashaCodeClaimed: '',
  state: '',
  district: '',
  block: '',
  villageName: '',
  subCentre: '',
  supervisorName: '',
  supervisorPhone: '',
  note: '',
};

export function AshaRegister() {
  const {
    isAuthenticated,
    profile,
    role,
    loading,
    status,
    error: authError,
    language,
    refreshProfile,
    claimAshaCode,
  } = useAuth();
  const t = getT(language);

  const alreadyWorker = role === 'asha' || role === 'admin';

  // Her own request, if she has ever filed one. Skipped while signed out
  // (the endpoint needs a bearer token) and once she is already a worker.
  const mine = useAsync(
    () => getMyAshaRegistrationRequest(),
    [profile?.id],
    { skip: !isAuthenticated || !profile || alreadyWorker },
  );

  const request = mine.data?.request ?? null;
  const [claimResult, setClaimResult] = useState(null);

  /* ---- the app cannot reach its own backend ----------------------- */
  if (!loading && status === 'error' && authError) {
    return (
      <Page t={t}>
        <ErrorState
          title={t('We cannot reach the server', 'हम सर्वर तक नहीं पहुँच सके')}
          body={authError.message}
        />
      </Page>
    );
  }

  /* ---- signed out ------------------------------------------------- */
  if (!loading && !isAuthenticated) {
    return (
      <Page t={t}>
        <Card tone="asha" className="p-7 sm:p-8">
          <Eyebrow>{t('Step one', 'पहला कदम')}</Eyebrow>
          <h2 className="display-md mt-3 text-2xl">
            {t('Sign in before you register', 'पंजीकरण से पहले साइन इन करें')}
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {t(
              'A registration is attached to an account, so we need to know which account it belongs to. Sign in with your email and password, or with Google if you have no password yet.',
              'पंजीकरण किसी खाते से जुड़ता है, इसलिए यह जानना ज़रूरी है कि वह किस खाते का है। अपने ईमेल और पासवर्ड से साइन इन करें, या पासवर्ड न हो तो Google से।',
            )}
          </p>
          <Btn as={Link} href="/asha/login" variant="asha" size="lg" className="mt-7">
            {t('Go to sign in', 'साइन इन पर जाएँ')}
            <ArrowRight size={17} aria-hidden="true" />
          </Btn>
        </Card>
        <HowThisIsChecked t={t} />
      </Page>
    );
  }

  /* ---- the roster code was just accepted -------------------------- */
  if (claimResult) {
    return (
      <Page t={t}>
        <Card tone="seal" className="p-7 sm:p-8">
          <Stamp kind="verified" label={t('Roster code accepted', 'रोस्टर कोड स्वीकृत')} />
          <h2 className="display-md mt-4 text-2xl">
            {t('You are registered', 'आपका पंजीकरण हो गया')}
          </h2>

          {/* Only what the server sent back. Nothing about her posting is
              filled in from the form, because the roster row is the
              record of it and the form is only what she typed. */}
          <dl className="mt-6 space-y-3 border-t border-rule pt-6">
            <Row label={t('ASHA code', 'आशा कोड')} value={claimResult.ashaCode} />
            <Row label={t('Sub-centre', 'उप-केंद्र')} value={claimResult.subCentre} />
            <Row label={t('Block', 'ब्लॉक')} value={claimResult.block} />
            <Row label={t('District', 'ज़िला')} value={claimResult.district} />
            <Row label={t('State', 'राज्य')} value={claimResult.state} />
            <Row
              label={t('Villages you may address', 'जिन गाँवों को आप संदेश भेज सकती हैं')}
              value={(claimResult.villages ?? []).join(', ')}
            />
          </dl>

          {claimResult.note ? (
            <p className="mt-6 flex gap-2.5 border-t border-rule pt-6 text-[0.85rem] leading-relaxed text-ink-soft">
              <Info size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden="true" />
              <span>{claimResult.note}</span>
            </p>
          ) : null}

          <Btn as={Link} href="/asha" variant="asha" size="lg" className="mt-7">
            {t('Open my register', 'मेरा रजिस्टर खोलें')}
            <ArrowRight size={17} aria-hidden="true" />
          </Btn>
        </Card>
      </Page>
    );
  }

  /* ---- already a worker ------------------------------------------- */
  if (alreadyWorker) {
    return (
      <Page t={t}>
        <Card tone="seal" className="p-7 sm:p-8">
          <Stamp kind="verified" label={t('Registered', 'पंजीकृत')} />
          <h2 className="display-md mt-4 text-2xl">
            {t('This account is already registered', 'यह खाता पहले से पंजीकृत है')}
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {t(
              'There is nothing to do here. Your register is open in the worker portal.',
              'यहाँ कुछ करने की ज़रूरत नहीं है। आपका रजिस्टर कार्यकर्ता पोर्टल में खुला है।',
            )}
          </p>
          <Btn as={Link} href="/asha" variant="asha" size="lg" className="mt-7">
            {t('Open my register', 'मेरा रजिस्टर खोलें')}
            <ArrowRight size={17} aria-hidden="true" />
          </Btn>
        </Card>
      </Page>
    );
  }

  /* ---- loading her request ---------------------------------------- */
  // `!profile` here means signed in but the profile row has not come back
  // yet, so the role is still unknown. Showing the registration forms in
  // that gap would put them in front of workers who are already
  // registered, so the screen waits instead.
  if (loading || !profile || mine.loading) {
    return (
      <Page t={t}>
        <LoadingState label={t('Checking your registration', 'आपका पंजीकरण जाँचा जा रहा है')} rows={2} />
      </Page>
    );
  }

  if (mine.error) {
    return (
      <Page t={t}>
        <ErrorState
          title={t('We could not check your registration', 'हम आपका पंजीकरण जाँच नहीं सके')}
          body={mine.error.message}
          onRetry={mine.reload}
          retryLabel={t('Try again', 'फिर कोशिश करें')}
        />
      </Page>
    );
  }

  /* ---- a request is waiting, approved or refused ------------------ */
  if (request && request.status === 'pending') {
    return (
      <Page t={t}>
        <PendingRequest request={request} t={t} onWithdrawn={(row) => mine.setData({ request: row })} />
      </Page>
    );
  }

  if (request && request.status === 'approved') {
    // Approved server-side but this browser is still holding the old
    // profile. Say that plainly instead of showing her the forms again.
    return (
      <Page t={t}>
        <Card tone="seal" className="p-7 sm:p-8">
          <Stamp kind="verified" label={t('Approved', 'स्वीकृत')} />
          <h2 className="display-md mt-4 text-2xl">
            {t('Your registration was approved', 'आपका पंजीकरण स्वीकृत हुआ')}
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {t(
              'This app reads your role from your profile rather than from the sign-in you are holding, so refresh it — or sign out and back in — before the portal will open.',
              'यह ऐप आपकी भूमिका आपकी प्रोफ़ाइल से पढ़ता है, न कि आपके मौजूदा साइन-इन से। इसलिए प्रोफ़ाइल ताज़ा करें — या साइन आउट कर फिर साइन इन करें — तब पोर्टल खुलेगा।',
            )}
          </p>
          <Btn variant="asha" size="lg" className="mt-7" onClick={() => refreshProfile()}>
            {t('Refresh my account', 'मेरा खाता ताज़ा करें')}
          </Btn>
        </Card>
      </Page>
    );
  }

  /* ---- the two paths ---------------------------------------------- */
  return (
    <Page t={t}>
      {request && request.status === 'rejected' ? <RejectedNotice request={request} t={t} /> : null}
      {request && request.status === 'withdrawn' ? (
        <p className="mb-6 flex gap-2.5 text-[0.85rem] leading-relaxed text-ink-faint">
          <Undo2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('You withdrew an earlier request. You can file a new one below.', 'आपने पहले का अनुरोध वापस लिया था। नीचे नया अनुरोध भेज सकती हैं।')}
          </span>
        </p>
      ) : null}

      <HowThisIsChecked t={t} />

      <RosterCodePath
        t={t}
        claimAshaCode={claimAshaCode}
        onClaimed={(result) => setClaimResult(result)}
      />

      <RequestPath
        t={t}
        profile={profile}
        onFiled={(row) => mine.setData({ request: row })}
      />
    </Page>
  );
}

/* =============================================================
   Page chrome. Deliberately not the worker shell: that carries a
   worker's navigation and sign-out, and whoever is on this page is
   not a worker yet.
   ============================================================= */

function Page({ t, children }) {
  return (
    <main className="shell py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <SectionHead
          index="01"
          eyebrow={t('ASHA worker registration · आशा पंजीकरण', 'आशा कार्यकर्ता पंजीकरण')}
          title={t('Register as an ASHA worker', 'आशा कार्यकर्ता के रूप में पंजीकरण')}
          sub={t(
            'The worker portal holds other families’ health records, so it does not open on request. Either the code issued with your sub-centre roster opens it, or an administrator checks your name against the official roster first.',
            'कार्यकर्ता पोर्टल में दूसरे परिवारों के स्वास्थ्य रिकॉर्ड होते हैं, इसलिए यह माँगने पर नहीं खुलता। या तो आपकी उप-केंद्र सूची के साथ मिला कोड इसे खोलता है, या प्रशासक पहले आपका नाम आधिकारिक सूची में जाँचता है।',
          )}
          className="mb-10"
        />
        {children}
        <p className="mt-10 text-[0.8rem] text-ink-faint">
          <Link href="/asha/login" className="font-semibold text-seal underline-offset-2 hover:underline">
            {t('Back to sign in', 'साइन इन पर वापस')}
          </Link>
        </p>
      </div>
    </main>
  );
}

/**
 * The gate, in words. This is the part of the requirement that cannot
 * be met by a check alone: a worker has to be able to see what is being
 * checked, where her code comes from, and that filing a request is not
 * the same as being let in.
 */
function HowThisIsChecked({ t }) {
  const points = [
    {
      icon: KeyRound,
      title: t('Where a roster code comes from', 'रोस्टर कोड कहाँ से मिलता है'),
      body: t(
        'Your block office issues one code per row of the sub-centre roster and hands it to you through your supervisor. It is not printed in this app and nobody here can look it up for you.',
        'आपका ब्लॉक कार्यालय उप-केंद्र सूची की प्रत्येक पंक्ति के लिए एक कोड जारी करता है और वह आपकी पर्यवेक्षक के ज़रिये आपको मिलता है। यह कोड इस ऐप में नहीं दिखता और यहाँ कोई इसे खोज कर नहीं दे सकता।',
      ),
    },
    {
      icon: ShieldCheck,
      title: t('What an administrator checks', 'प्रशासक क्या जाँचता है'),
      body: t(
        'A request is read against the official roster the block office uploaded — your name, your code and your posting. It is approved only when those agree.',
        'अनुरोध को ब्लॉक कार्यालय द्वारा अपलोड की गई आधिकारिक सूची से मिलाकर पढ़ा जाता है — आपका नाम, आपका कोड और आपकी तैनाती। ये मिलने पर ही स्वीकृति मिलती है।',
      ),
    },
    {
      icon: Clock,
      title: t('Filing a request grants nothing', 'अनुरोध भेजने से पहुँच नहीं मिलती'),
      body: t(
        'Your account stays a citizen account while a request is waiting. The worker portal does not open, and no household appears, until an administrator approves it.',
        'अनुरोध विचाराधीन रहने तक आपका खाता नागरिक खाता ही रहता है। प्रशासक की स्वीकृति तक कार्यकर्ता पोर्टल नहीं खुलता और कोई परिवार नहीं दिखता।',
      ),
    },
  ];

  return (
    <Card className="mb-8 p-6 sm:p-7">
      <Eyebrow>{t('How this is checked', 'यह कैसे जाँचा जाता है')}</Eyebrow>
      <ul className="mt-5 space-y-5">
        {points.map((point) => {
          const Icon = point.icon;
          return (
            <li key={point.title} className="flex gap-3.5">
              <Icon size={18} className="mt-0.5 shrink-0 text-seal" strokeWidth={2.2} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[0.9rem] font-semibold text-ink">{point.title}</p>
                <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-soft">{point.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* =============================================================
   Path one — the roster code
   ============================================================= */

function RosterCodePath({ t, claimAshaCode, onClaimed }) {
  const [open, setOpen] = useState(true);
  const [ashaCode, setAshaCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (!ashaCode.trim() || !inviteCode.trim()) {
      setError(
        t(
          'Enter both your official ASHA code and the invite code your block office gave you.',
          'अपना आधिकारिक आशा कोड और ब्लॉक कार्यालय से मिला निमंत्रण कोड, दोनों भरें।',
        ),
      );
      return;
    }

    setBusy(true);
    try {
      const result = await claimAshaCode({
        ashaCode: ashaCode.trim(),
        inviteCode: inviteCode.trim(),
      });
      onClaimed(result);
    } catch (err) {
      // The server's message is the honest one: it refuses to say whether
      // the ASHA code exists, and it explains the five-attempt limit when
      // that is what has been hit. Passed through rather than reworded.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="asha" className="mb-6 p-6 sm:p-7">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3.5 text-left"
      >
        <KeyRound size={20} className="mt-0.5 shrink-0 text-asha" strokeWidth={2.2} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="eyebrow">{t('Path one · fastest', 'पहला रास्ता · सबसे तेज़')}</span>
          <span className="display-md mt-2 block text-xl sm:text-2xl">
            {t('I have the code from my roster', 'मेरे पास रोस्टर वाला कोड है')}
          </span>
          <span className="mt-2.5 block text-[0.875rem] leading-relaxed text-ink-soft">
            {t(
              'Accepted immediately. Your account is bound to the villages on that roster row.',
              'तुरंत स्वीकार होता है। आपका खाता उस रोस्टर पंक्ति के गाँवों से जुड़ जाता है।',
            )}
          </span>
        </span>
      </button>

      {open ? (
        <form onSubmit={submit} className="mt-6 space-y-5 border-t border-rule pt-6">
          <TextField
            label={t('Official ASHA code', 'आधिकारिक आशा कोड')}
            hint={t('As it is written on your roster.', 'जैसा आपकी रोस्टर सूची में लिखा है।')}
            value={ashaCode}
            onChange={setAshaCode}
            autoComplete="off"
            required
          />
          <TextField
            label={t('Invite code', 'निमंत्रण कोड')}
            hint={t(
              'Eight characters in two groups, issued with your roster. It can be used once.',
              'दो हिस्सों में आठ अक्षर, रोस्टर के साथ जारी। यह एक ही बार चलता है।',
            )}
            value={inviteCode}
            onChange={setInviteCode}
            placeholder="ABCD-2345"
            autoComplete="off"
            required
          />

          {error ? (
            <p className="text-sm font-semibold leading-relaxed text-siren" role="alert">
              {error}
            </p>
          ) : null}

          <p className="text-[0.8rem] leading-relaxed text-ink-faint">
            {t(
              'For safety this account may try five invite codes every fifteen minutes. If a code keeps failing, ask your block office to confirm it before trying again.',
              'सुरक्षा के लिए इस खाते से हर पंद्रह मिनट में पाँच निमंत्रण कोड आज़माए जा सकते हैं। कोड बार-बार गलत बताए तो फिर कोशिश करने से पहले ब्लॉक कार्यालय से पुष्टि कराएँ।',
            )}
          </p>

          <Btn type="submit" variant="asha" size="lg" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                {t('Checking the code…', 'कोड जाँचा जा रहा है…')}
              </>
            ) : (
              <>
                {t('Register with this code', 'इस कोड से पंजीकरण करें')}
                <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </Btn>
        </form>
      ) : null}
    </Card>
  );
}

/* =============================================================
   Path two — the request an administrator reviews
   ============================================================= */

function RequestPath({ t, profile, onFiled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Prefilled only from her own profile. Every other field starts blank
  // rather than guessed: an administrator is going to check these against
  // a roster, so a plausible-looking guess is worse than an empty box.
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    fullName: profile?.full_name ?? '',
    phone: profile?.phone ?? '',
    state: profile?.state ?? '',
    district: profile?.district ?? '',
    villageName: profile?.village ?? '',
  }));

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const missing = useMemo(
    () => REQUIRED.filter((key) => !String(form[key] ?? '').trim()),
    [form],
  );

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (missing.length) {
      setError(
        t(
          'Your name, a phone number and your village are needed before this can be reviewed.',
          'जाँच से पहले आपका नाम, फ़ोन नंबर और गाँव भरना ज़रूरी है।',
        ),
      );
      return;
    }
    if (String(form.phone).replace(/\D/g, '').length < 10) {
      setError(
        t(
          'Enter the full mobile number your supervisor can reach you on.',
          'पूरा मोबाइल नंबर भरें जिस पर आपकी पर्यवेक्षक आपसे संपर्क कर सकें।',
        ),
      );
      return;
    }

    setBusy(true);
    try {
      const trimmed = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, String(value ?? '').trim()]),
      );
      const result = await submitAshaRegistrationRequest(trimmed);
      onFiled(result.request);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-7">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3.5 text-left"
      >
        <ClipboardList size={20} className="mt-0.5 shrink-0 text-seal" strokeWidth={2.2} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="eyebrow">{t('Path two · reviewed by a person', 'दूसरा रास्ता · व्यक्ति द्वारा जाँच')}</span>
          <span className="display-md mt-2 block text-xl sm:text-2xl">
            {t('I have no code', 'मेरे पास कोड नहीं है')}
          </span>
          <span className="mt-2.5 block text-[0.875rem] leading-relaxed text-ink-soft">
            {t(
              'For a worker who is on the block roster on paper but not in the file uploaded here. An administrator checks your details against the official roster.',
              'उन कार्यकर्ताओं के लिए जो कागज़ पर ब्लॉक रोस्टर में हैं पर यहाँ अपलोड फ़ाइल में नहीं। प्रशासक आपके विवरण आधिकारिक सूची से मिलाता है।',
            )}
          </span>
        </span>
      </button>

      {open ? (
        <form onSubmit={submit} className="mt-6 space-y-6 border-t border-rule pt-6">
          <fieldset className="space-y-5">
            <legend className="eyebrow">{t('Who you are', 'आप कौन हैं')}</legend>
            <TextField
              label={t('Full name', 'पूरा नाम')}
              hint={t('As it appears on the roster.', 'जैसा रोस्टर सूची में लिखा है।')}
              value={form.fullName}
              onChange={set('fullName')}
              autoComplete="name"
              required
            />
            <TextField
              label={t('Mobile number', 'मोबाइल नंबर')}
              hint={t('The number your supervisor can reach you on.', 'वह नंबर जिस पर आपकी पर्यवेक्षक संपर्क कर सकें।')}
              value={form.phone}
              onChange={set('phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
            />
            <TextField
              label={t('Official ASHA code, if you have one', 'आधिकारिक आशा कोड, यदि हो')}
              hint={t(
                'Leave this blank if you have not been given one. An approval without a code issues a temporary code marked as provisional until your block office issues the real one.',
                'न मिला हो तो खाली छोड़ें। कोड के बिना स्वीकृति पर अस्थायी कोड मिलता है, जो ब्लॉक कार्यालय से असली कोड मिलने तक अस्थायी दर्ज रहता है।',
              )}
              value={form.ashaCodeClaimed}
              onChange={set('ashaCodeClaimed')}
              autoComplete="off"
            />
          </fieldset>

          <fieldset className="space-y-5 border-t border-rule-soft pt-6">
            <legend className="eyebrow">{t('Where you are posted', 'आपकी तैनाती कहाँ है')}</legend>

            {/* The one explanation on this form that is not about
                verification: the village decides who her notices reach. */}
            <div className="flex gap-2.5 rounded-[var(--radius-sm)] bg-seal-soft p-4">
              <Users size={17} className="mt-0.5 shrink-0 text-seal" strokeWidth={2.2} aria-hidden="true" />
              <p className="text-[0.85rem] leading-relaxed text-ink-soft">
                {t(
                  'Your village is what lets the app reach people. A health notice or camp date you post goes to every resident of the village named here and to nobody else, so write it exactly as it appears in your sub-centre records.',
                  'आपका गाँव ही तय करता है कि ऐप किन लोगों तक पहुँचेगा। आपके भेजे स्वास्थ्य संदेश या शिविर की सूचना यहाँ लिखे गाँव के सभी निवासियों तक जाती है, और किसी और तक नहीं — इसलिए इसे ठीक वैसे लिखें जैसा आपके उप-केंद्र के रिकॉर्ड में है।',
                )}
              </p>
            </div>

            <TextField
              label={t('Village', 'गाँव')}
              value={form.villageName}
              onChange={set('villageName')}
              required
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField label={t('Sub-centre', 'उप-केंद्र')} value={form.subCentre} onChange={set('subCentre')} />
              <TextField label={t('Block', 'ब्लॉक')} value={form.block} onChange={set('block')} />
              <TextField label={t('District', 'ज़िला')} value={form.district} onChange={set('district')} />
              <TextField label={t('State', 'राज्य')} value={form.state} onChange={set('state')} />
            </div>
          </fieldset>

          <fieldset className="space-y-5 border-t border-rule-soft pt-6">
            <legend className="eyebrow">{t('Who can confirm this', 'कौन इसकी पुष्टि कर सकता है')}</legend>
            <p className="text-[0.85rem] leading-relaxed text-ink-soft">
              {t(
                'A supervisor an administrator can telephone is usually what settles a request that is not on the uploaded roster.',
                'अपलोड सूची में नाम न होने पर अनुरोध आमतौर पर उस पर्यवेक्षक से तय होता है जिन्हें प्रशासक फ़ोन कर सके।',
              )}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label={t('Supervisor’s name', 'पर्यवेक्षक का नाम')}
                value={form.supervisorName}
                onChange={set('supervisorName')}
              />
              <TextField
                label={t('Supervisor’s number', 'पर्यवेक्षक का नंबर')}
                value={form.supervisorPhone}
                onChange={set('supervisorPhone')}
                type="tel"
                inputMode="tel"
              />
            </div>
            <label className="block">
              <span className="eyebrow">{t('Anything else the reviewer should know', 'जाँचने वाले को कुछ और बताना हो')}</span>
              <textarea
                value={form.note}
                onChange={(e) => set('note')(e.target.value)}
                rows={3}
                className="field mt-2 w-full resize-y"
                placeholder={t(
                  'For example: posted here since March, roster still being updated.',
                  'उदाहरण: मार्च से यहाँ तैनात, रोस्टर अभी अद्यतन हो रहा है।',
                )}
              />
            </label>
          </fieldset>

          {error ? (
            <p className="text-sm font-semibold leading-relaxed text-siren" role="alert">
              {error}
            </p>
          ) : null}

          <InferenceNote>
            {t(
              'Sending this does not open the portal. Your account stays a citizen account until an administrator has checked these details against the official roster.',
              'इसे भेजने से पोर्टल नहीं खुलता। जब तक प्रशासक इन विवरणों को आधिकारिक सूची से नहीं मिला लेता, आपका खाता नागरिक खाता ही रहता है।',
            )}
          </InferenceNote>

          <Btn type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                {t('Sending…', 'भेजा जा रहा है…')}
              </>
            ) : (
              <>
                {t('Send for review', 'जाँच के लिए भेजें')}
                <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </Btn>
        </form>
      ) : null}
    </Card>
  );
}

/* =============================================================
   States of an existing request
   ============================================================= */

function PendingRequest({ request, t, onWithdrawn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function withdraw() {
    setError(null);
    setBusy(true);
    try {
      const result = await withdrawAshaRegistrationRequest();
      onWithdrawn(result.request);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="amber" className="p-7 sm:p-8">
      <Stamp kind="inferred" label={t('Waiting for review', 'जाँच के लिए प्रतीक्षा')} />
      <h2 className="display-md mt-4 text-2xl">
        {t('Your request is with an administrator', 'आपका अनुरोध प्रशासक के पास है')}
      </h2>

      {/* No date is promised. Nobody here knows when a reviewer will
          open the queue, and inventing "within two days" would be a
          commitment this app cannot keep. */}
      <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
        {t(
          'It was filed on ', 'यह अनुरोध ',
        )}
        <span className="font-semibold text-ink">{formatDate(request.created_at, t.isHindi)}</span>
        {t(
          '. Until it is approved your account stays a citizen account, so the worker portal will not open and no household will appear.',
          ' को भेजा गया था। स्वीकृति तक आपका खाता नागरिक खाता ही रहता है, इसलिए कार्यकर्ता पोर्टल नहीं खुलेगा और कोई परिवार नहीं दिखेगा।',
        )}
      </p>

      <dl className="mt-6 space-y-3 border-t border-rule pt-6">
        <Row label={t('Name given', 'दिया गया नाम')} value={request.full_name} />
        <Row label={t('Phone given', 'दिया गया फ़ोन')} value={request.phone} />
        <Row label={t('ASHA code claimed', 'बताया गया आशा कोड')} value={request.asha_code_claimed} />
        <Row label={t('Village', 'गाँव')} value={request.village_name} />
        <Row label={t('Sub-centre', 'उप-केंद्र')} value={request.sub_centre} />
        <Row label={t('Block', 'ब्लॉक')} value={request.block} />
        <Row label={t('District', 'ज़िला')} value={request.district} />
        <Row label={t('State', 'राज्य')} value={request.state} />
        <Row label={t('Supervisor', 'पर्यवेक्षक')} value={request.supervisor_name} />
        <Row label={t('Supervisor’s number', 'पर्यवेक्षक का नंबर')} value={request.supervisor_phone} />
      </dl>

      <div className="mt-7 border-t border-rule pt-6">
        <p className="text-[0.85rem] leading-relaxed text-ink-soft">
          {t(
            'Something wrong above? Withdraw the request, then file a corrected one. Only one request can be waiting at a time.',
            'ऊपर कुछ गलत है? अनुरोध वापस लें और सुधार कर दोबारा भेजें। एक समय में एक ही अनुरोध विचाराधीन रह सकता है।',
          )}
        </p>
        {error ? (
          <p className="mt-3 text-sm font-semibold text-siren" role="alert">
            {error}
          </p>
        ) : null}
        <Btn variant="outline" className="mt-4" onClick={withdraw} disabled={busy}>
          <Undo2 size={16} aria-hidden="true" />
          {busy ? t('Withdrawing…', 'वापस लिया जा रहा है…') : t('Withdraw this request', 'यह अनुरोध वापस लें')}
        </Btn>
      </div>
    </Card>
  );
}

function RejectedNotice({ request, t }) {
  return (
    <Card tone="siren" className="mb-8 p-6 sm:p-7">
      <Stamp kind="none" label={t('Not approved', 'स्वीकृत नहीं')} />
      <h2 className="display-md mt-4 text-xl sm:text-2xl">
        {t('An earlier request was not approved', 'पहले का अनुरोध स्वीकृत नहीं हुआ')}
      </h2>

      {/* The reviewer's own words. The server requires a reason before it
          will record a rejection, precisely so there is something to show
          here instead of a bare refusal. */}
      {request.review_note ? (
        <blockquote className="mt-5 border-l-2 border-siren pl-4 text-[0.9rem] leading-relaxed text-ink-soft">
          {request.review_note}
        </blockquote>
      ) : null}

      <p className="mt-5 text-[0.85rem] leading-relaxed text-ink-soft">
        {t(
          'You can file a new request once whatever is written above has been sorted out — or register straight away if your block office has since given you a roster code.',
          'ऊपर लिखी बात सुलझने पर आप नया अनुरोध भेज सकती हैं — या यदि ब्लॉक कार्यालय ने अब रोस्टर कोड दे दिया है तो सीधे पंजीकरण करें।',
        )}
      </p>
      {request.reviewed_at ? (
        <p className="mt-4 text-[0.8rem] text-ink-faint">
          {t('Reviewed on ', 'जाँच की तारीख ')}
          {formatDate(request.reviewed_at, t.isHindi)}
        </p>
      ) : null}
    </Card>
  );
}

/* =============================================================
   Small pieces
   ============================================================= */

function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  autoComplete,
  inputMode,
}) {
  const t = getT(useAuth().language);

  return (
    <label className="block">
      <span className="eyebrow">
        {label}
        {required ? null : (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-faint">
            {t('(optional)', '(वैकल्पिक)')}
          </span>
        )}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field mt-2 w-full"
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
      />
      {hint ? <span className="mt-2 block text-[0.8rem] leading-relaxed text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/**
 * One row of a record. A blank value is printed as a dash rather than
 * hidden, because an approver comparing this against a roster needs to
 * see that a field was left empty — and nothing here is marked with a
 * tick, because every value on this page is what somebody typed rather
 * than something this app has checked.
 */
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

function formatDate(iso, hindi) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(hindi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
