import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { getT } from '@/services/i18n';
import { Btn, Card, Eyebrow, InferenceNote } from '@/components/ds';

/* =============================================================
   /signin — an account for a household.

   WHY THIS PAGE HAD TO EXIST. Until it did, the only sign-in
   routes in the app were /asha/login and /asha/register, so a
   regular user was never authenticated. Everything that links a
   family to their ASHA worker is a foreign key to profiles(id),
   which is a row in auth.users:

     profiles.village_id            who covers you
     message_threads.citizen_id     the conversation
     notification_recipients.user_id her broadcasts reaching you
     sos_broadcasts.raised_by       the emergency record

   None of those can hold an anonymous visitor. So a worker could
   register, be approved and be mapped to her village, and still
   be invisible to every household in it — not because the lookup
   was wrong, but because there was no account on the other side
   for it to find.

   WHAT THIS PAGE PROMISES, AND WHAT IT DOES NOT. It says plainly
   what an account buys: saved details, a named worker, her number,
   messages, and her village notices. It does not imply the account
   is verified against anything. Signing in proves control of an
   email address and nothing more — not a ration card, not an
   Aadhaar number, not residence in a village. The app holds none
   of those, and a screen that hinted otherwise would be setting
   somebody up to be turned away at a hospital counter.

   The app is still usable without an account. The assistant, the
   scheme pages and the hospital search all work signed out, and
   somebody whose child has a fever should not have to make an
   account before they can ask a question. This page is reached by
   choice, from the screens that genuinely need it.
   ============================================================= */

/** Where a signed-in citizen belongs, if nothing else was asked for. */
const HOME = '/app';

/**
 * Read-and-clear the path RequireRole stashed.
 *
 * Only citizen paths are honoured. A stale /asha path from an earlier
 * visit would otherwise send a household straight into a refusal screen
 * the moment they finished signing in.
 */
function takeIntendedPath() {
  try {
    const stored = sessionStorage.getItem('sehat-sathi-intended');
    sessionStorage.removeItem('sehat-sathi-intended');
    if (stored && stored.startsWith('/') && !stored.startsWith('/asha') && !stored.startsWith('/admin')) {
      return stored;
    }
  } catch {
    /* private browsing: the default is fine */
  }
  return HOME;
}

export function SignIn() {
  const {
    signIn,
    signUp,
    signInWithGoogle,
    isAuthenticated,
    profile,
    role,
    status,
    error: authError,
    configured,
  } = useAuth();
  const { language, refreshProfile } = useAppState();
  const [, navigate] = useLocation();

  const t = getT(language);
  const deva = t.isHindi;

  // 'in' | 'up'. Signing in is the default because most visits are
  // returns, and a returning person should not have to find the tab.
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Set when signUp returns a user but no session, which is what a
  // project with email confirmation switched on does.
  const [confirmSent, setConfirmSent] = useState(false);

  const staff = role === 'asha' || role === 'admin';

  /* Already signed in as a citizen? Then this page has nothing to do.
     The profile row is waited for rather than assumed, because for the
     one tick before it lands `role` is null and a worker who wandered
     here would be sent to the citizen home instead of her portal. */
  useEffect(() => {
    if (!isAuthenticated || !profile) return;
    if (staff) {
      navigate('/asha', { replace: true });
      return;
    }
    // The store holds the profile the rest of the citizen app reads, and
    // it was last fetched while nobody was signed in. Refetched here so
    // the next screen opens with this account's own details rather than
    // the blanks it loaded before.
    refreshProfile();
    navigate(takeIntendedPath(), { replace: true });
  }, [isAuthenticated, profile, staff, navigate, refreshProfile]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setConfirmSent(false);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError(t('Enter your email and a password.', 'अपना ईमेल और पासवर्ड भरें।'));
      return;
    }
    if (mode === 'up' && password.length < 6) {
      setError(
        t(
          'Choose a password of at least six characters.',
          'कम से कम छह अक्षरों का पासवर्ड चुनें।',
        ),
      );
      return;
    }

    setBusy(true);
    try {
      if (mode === 'in') {
        // No navigation here. The effect above moves on once the profile
        // row has arrived, so nobody is sent to a screen that then has to
        // work out who they are.
        await signIn({ email: cleanEmail, password });
      } else {
        const result = await signUp({
          email: cleanEmail,
          password,
          fullName: fullName.trim() || null,
          // Written to the new profile so a notice an ASHA worker sends is
          // composed in the script this household reads. Not a claim about
          // anything, and changeable later from Settings.
          language,
        });
        // A project with email confirmation on returns a user and no
        // session. Saying "welcome" here would be wrong: they are not
        // signed in, and nothing will save until they open the link.
        if (result && !result.session) {
          setConfirmSent(true);
        }
      }
      setPassword('');
    } catch (err) {
      setError(
        err?.message ||
          t(
            'That did not work. Please check the email and password and try again.',
            'यह काम नहीं किया। ईमेल और पासवर्ड जाँचकर फिर कोशिश करें।',
          ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      // Back to this page, not to /app, so the effect above decides where
      // to go once the role is actually known.
      await signInWithGoogle({ redirectTo: `${window.location.origin}/signin` });
    } catch (err) {
      setError(
        err?.message || t('Google sign-in did not start.', 'Google साइन-इन शुरू नहीं हो सका।'),
      );
      setBusy(false);
    }
  }

  const signingUp = mode === 'up';

  return (
    <main
      className={`shell flex min-h-[calc(100vh-72px)] items-center justify-center py-12 ${deva ? 'is-deva' : ''}`}
      lang={deva ? 'hi' : 'en'}
    >
      <div className="w-full max-w-lg">
        {/* Supabase absent, or its own error. Said before the form, because
            a form that cannot possibly work should not look ready. */}
        {!configured ? (
          <Card tone="siren" className="mb-4 p-5" role="alert">
            <Eyebrow>{t('Accounts are not available', 'खाते उपलब्ध नहीं हैं')}</Eyebrow>
            <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
              {t(
                'This copy of the app has no database connected, so no account can be created or signed into. Everything that does not need an account still works.',
                'ऐप की इस प्रति से कोई डेटाबेस जुड़ा नहीं है, इसलिए खाता न बन सकता है न खुल सकता है। जिन कामों में खाता ज़रूरी नहीं, वे चलते रहेंगे।',
              )}
            </p>
          </Card>
        ) : null}

        {status === 'error' && authError ? (
          <Card tone="siren" className="mb-4 p-5" role="alert">
            <Eyebrow>{t('Not connected', 'कनेक्ट नहीं है')}</Eyebrow>
            <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
              {authError.message}
            </p>
          </Card>
        ) : null}

        {confirmSent ? (
          <Card tone="seal" className="mb-4 p-6" role="status">
            <div className="flex items-start gap-3">
              <MailCheck size={18} className="mt-1 shrink-0 text-seal" aria-hidden="true" />
              <div className="min-w-0">
                <Eyebrow>{t('Check your email', 'अपना ईमेल देखें')}</Eyebrow>
                <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-soft">
                  {t(
                    'The account was created but is not open yet. We have sent a confirmation link to that address — open it, then come back and sign in. Until then nothing will save.',
                    'खाता बन गया है पर अभी खुला नहीं है। उस पते पर पुष्टि की एक कड़ी भेजी गई है — उसे खोलें, फिर यहाँ आकर साइन इन करें। तब तक कुछ सहेजा नहीं जाएगा।',
                  )}
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        <Card tone="seal" className="p-7 sm:p-10">
          <Eyebrow>{t('Sehat Sathi · your account', 'सेहत साथी · आपका खाता')}</Eyebrow>
          <h1 className="display-md mt-4 text-3xl sm:text-4xl">
            {signingUp
              ? t('Create an account', 'खाता बनाएँ')
              : t('Sign in to your account', 'अपने खाते में साइन इन करें')}
          </h1>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {t(
              'An account is what lets this app hold your village — and your village is what decides which ASHA worker is yours, whose number you can call, and whose notices reach you.',
              'खाता होने पर ही यह ऐप आपका गाँव सहेज सकता है — और गाँव से ही तय होता है कि आपकी आशा कार्यकर्ता कौन हैं, किसका नंबर आप मिला सकते हैं, और किसकी सूचनाएँ आप तक पहुँचेंगी।',
            )}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {signingUp ? (
              <label className="block">
                <span className="eyebrow">{t('Your name (optional)', 'आपका नाम (ज़रूरी नहीं)')}</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className="field mt-2 w-full"
                />
                <span className="mt-1.5 block text-[0.8rem] text-ink-faint">
                  {t(
                    'So your ASHA worker knows who is writing to her. You can add it later instead.',
                    'जिससे आपकी आशा कार्यकर्ता जान सकें कि कौन लिख रहा है। इसे बाद में भी भर सकते हैं।',
                  )}
                </span>
              </label>
            ) : null}

            <label className="block">
              <span className="eyebrow">{t('Email', 'ईमेल')}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete={signingUp ? 'email' : 'username'}
                inputMode="email"
                className="field mt-2 w-full"
                required
              />
            </label>

            <label className="block">
              <span className="eyebrow">{t('Password', 'पासवर्ड')}</span>
              <div className="relative mt-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signingUp ? 'new-password' : 'current-password'}
                  className="field w-full pr-14"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword
                      ? t('Hide password', 'पासवर्ड छिपाएँ')
                      : t('Show password', 'पासवर्ड दिखाएँ')
                  }
                  className="absolute inset-y-0 right-0 grid w-14 place-items-center text-ink-faint transition hover:text-ink"
                >
                  {showPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              {signingUp ? (
                <span className="mt-1.5 block text-[0.8rem] text-ink-faint">
                  {t('At least six characters.', 'कम से कम छह अक्षर।')}
                </span>
              ) : null}
            </label>

            {error ? (
              <p className="text-sm font-semibold leading-relaxed text-siren" role="alert">
                {error}
              </p>
            ) : null}

            <Btn
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy || !configured}
            >
              {busy
                ? t('Please wait…', 'कृपया रुकें…')
                : signingUp
                  ? t('Create account', 'खाता बनाएँ')
                  : t('Sign in', 'साइन इन करें')}
              {busy ? null : signingUp ? (
                <UserPlus size={17} aria-hidden="true" />
              ) : (
                <ArrowRight size={17} aria-hidden="true" />
              )}
            </Btn>
          </form>

          {/* Signed in, profile not back yet. Neither "welcome" nor "you
              are not signed in" is true in that gap, so it says only what
              is known. */}
          {isAuthenticated && !profile && status !== 'error' ? (
            <div
              className="mt-6 flex items-start gap-2.5 border-t border-rule pt-6"
              role="status"
              aria-live="polite"
            >
              <Loader2
                size={16}
                className="mt-0.5 shrink-0 animate-spin text-ink-faint"
                aria-hidden="true"
              />
              <p className="text-[0.85rem] leading-relaxed text-ink-soft">
                {t('Opening your account…', 'आपका खाता खोला जा रहा है…')}
              </p>
            </div>
          ) : null}

          <div className="mt-7 border-t border-rule pt-6">
            <p className="text-center text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              {t('or', 'या')}
            </p>
            <Btn
              type="button"
              variant="outline"
              size="lg"
              className="mt-4 w-full"
              onClick={handleGoogle}
              disabled={busy || !configured}
            >
              {t('Continue with Google', 'Google से जारी रखें')}
            </Btn>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
              {t(
                'Google tells us your email address and nothing else. It gives no special access: an account made this way is a household account, the same as any other.',
                'Google हमें आपका ईमेल पता बताता है, इसके सिवा कुछ नहीं। इससे कोई विशेष अधिकार नहीं मिलता: इस तरह बना खाता भी सामान्य पारिवारिक खाता ही है।',
              )}
            </p>
          </div>

          <div className="mt-7 border-t border-rule pt-6">
            <InferenceNote>
              {t(
                'Signing in proves you control this email address. It does not verify your ration card, your Aadhaar or where you live — this app holds none of those, and a scheme is still decided by the officer who checks the records.',
                'साइन इन से इतना ही साबित होता है कि यह ईमेल पता आपका है। इससे आपका राशन कार्ड, आधार या निवास प्रमाणित नहीं होता — यह ऐप इनमें से कुछ नहीं रखता, और योजना का फ़ैसला रिकॉर्ड जाँचने वाले अधिकारी ही करते हैं।',
              )}
            </InferenceNote>

            <div className="mt-5 flex items-start gap-2.5">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-seal" aria-hidden="true" />
              <p className="text-[0.8rem] leading-relaxed text-ink-soft">
                {t(
                  'Your details are readable only by your own account and by the ASHA worker mapped to your village. That is enforced in the database, not only in this app.',
                  'आपका विवरण केवल आपका खाता और आपके गाँव की आशा कार्यकर्ता पढ़ सकती हैं। यह रोक डेटाबेस में लगी है, सिर्फ़ ऐप में नहीं।',
                )}
              </p>
            </div>
          </div>

          <div className="mt-7 border-t border-rule pt-6">
            <button
              type="button"
              onClick={() => {
                setMode(signingUp ? 'in' : 'up');
                setError(null);
                setConfirmSent(false);
              }}
              className="text-[0.85rem] font-semibold text-seal underline-offset-2 transition hover:underline"
            >
              {signingUp
                ? t('I already have an account — sign in', 'मेरा खाता पहले से है — साइन इन करें')
                : t('I am new here — create an account', 'मैं नया हूँ — खाता बनाएँ')}
            </button>

            <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
              {t(
                'You can keep using the assistant, the scheme pages and the hospital search without an account.',
                'सहायक, योजनाओं के पन्ने और अस्पताल खोज बिना खाते के भी चलते रहेंगे।',
              )}{' '}
              <Link href="/app" className="font-semibold text-seal underline-offset-2 hover:underline">
                {t('Go back', 'वापस जाएँ')}
              </Link>
            </p>
            <p className="mt-2 text-[0.8rem] text-ink-faint">
              {t('Are you an ASHA worker?', 'आप आशा कार्यकर्ता हैं?')}{' '}
              <Link
                href="/asha/login"
                className="font-semibold text-asha underline-offset-2 hover:underline"
              >
                {t('Use the worker entrance', 'कार्यकर्ता प्रवेश से जाएँ')}
              </Link>
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}

export default SignIn;
