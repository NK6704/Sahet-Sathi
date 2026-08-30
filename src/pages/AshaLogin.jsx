import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import {
  ArrowRight,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { Btn, Card, Eyebrow, InferenceNote } from '@/components/ds';

/* =============================================================
   /asha/login — the staff entrance.

   Three things this screen must never do:

     1. Claim to be the security boundary. It is not. Row-level
        security in the database is. This form only decides which
        screen renders first.
     2. Guess. It does not accept an ASHA code as a credential or
        pre-fill a password. A worker signs in with the email and
        password her block office issued, or with Google.
     3. Send anyone into the portal before her role is known. A
        signed-in account is not a registered worker, and the two
        are a tick apart: Supabase reports the session immediately
        and the profile row — which carries the role — arrives on
        the next round trip. Everything below waits for the
        profile rather than reading `role` while it is still null,
        because in that gap this page would either open the portal
        to a citizen or tell a real ASHA she is not one.

   The "open with sample data" button that used to sit here is
   gone with the demo session it depended on. It signed a fake
   worker in whenever the backend was absent, which is precisely
   the case where the real check most needs to be exercised.
   ============================================================= */

export function AshaLogin() {
  const {
    signIn,
    signInWithGoogle,
    signOut,
    isAuthenticated,
    profile,
    role,
    loading,
    status,
    error: authError,
    language,
  } = useAuth();
  const [, navigate] = useLocation();
  const t = getT(language);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Which door was knocked on. RequireRole stashes the path it turned
  // away, so an admin sent here for /admin/asha-requests can be told
  // that is what this is, rather than being greeted as a health worker.
  const [wantedAdmin] = useState(() => peekIntendedPath().startsWith('/admin'));

  // The role is known once the profile row has arrived. Until then the
  // account is neither a worker nor a citizen as far as this page is
  // concerned, and nothing is asserted about it.
  const roleKnown = isAuthenticated && Boolean(profile);
  const staff = role === 'asha' || role === 'admin';
  const stalled = useStalled(isAuthenticated && !profile && status !== 'error');

  // Signed in and registered? Don't make her sign in twice.
  useEffect(() => {
    if (roleKnown && staff) navigate(takeIntendedPath(role), { replace: true });
  }, [roleKnown, staff, role, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError(
        t(
          'Enter the email and password your block office gave you.',
          'अपने ब्लॉक कार्यालय से मिला ईमेल और पासवर्ड भरें।',
        ),
      );
      return;
    }

    setBusy(true);
    try {
      // No navigation here on purpose. Signing in proves who she is; the
      // effect above moves her only once her role has been read back.
      await signIn({ email: email.trim(), password });
      setPassword('');
    } catch (err) {
      setError(err.message || t('Could not sign you in. Please try again.', 'साइन इन नहीं हो सका। कृपया फिर से कोशिश करें।'));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      // Back to this page rather than to the citizen app, so the role
      // check below runs on return instead of being skipped.
      await signInWithGoogle({ redirectTo: `${window.location.origin}/asha/login` });
    } catch (err) {
      setError(err.message || t('Google sign-in did not start.', 'Google साइन-इन शुरू नहीं हो सका।'));
      setBusy(false);
    }
  }

  return (
    <main className="shell flex min-h-[calc(100vh-72px)] items-center justify-center py-12">
      <div className="w-full max-w-lg">
        {status === 'error' && authError ? (
          <Card tone="siren" className="mb-4 p-5" role="alert">
            <Eyebrow>{t('Not connected', 'कनेक्ट नहीं है')}</Eyebrow>
            <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-soft">{authError.message}</p>
          </Card>
        ) : null}

        {/* Signed in, but the account is not on the worker side. Said
            here rather than after a redirect into an empty portal. */}
        {roleKnown && !staff ? (
          <Card tone="amber" className="mb-4 p-6 sm:p-7">
            <div className="flex items-start gap-3">
              <Lock size={18} className="mt-1 shrink-0 text-amber" aria-hidden="true" />
              <div className="min-w-0">
                <Eyebrow>{t('Wrong entrance', 'यह प्रवेश आपके लिए नहीं है')}</Eyebrow>
                <h2 className="display-md mt-2.5 text-xl sm:text-2xl">
                  {t('This entrance is for registered workers', 'यह प्रवेश पंजीकृत कार्यकर्ताओं के लिए है')}
                </h2>
                <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">
                  {t(
                    'You are signed in, but this account is registered as a citizen account, so the worker portal stays closed. Nothing is wrong — these pages hold other families’ health records.',
                    'आप साइन इन हैं, लेकिन यह खाता नागरिक खाते के रूप में पंजीकृत है, इसलिए कार्यकर्ता पोर्टल नहीं खुलेगा। कुछ गलत नहीं है — इन पन्नों में दूसरे परिवारों के स्वास्थ्य रिकॉर्ड होते हैं।',
                  )}
                </p>
                <InferenceNote className="mt-4">
                  {t(
                    'If you are an ASHA worker, register with the code issued with your sub-centre roster, or ask an administrator to check your name against it.',
                    'यदि आप आशा कार्यकर्ता हैं, तो अपनी उप-केंद्र सूची के साथ मिले कोड से पंजीकरण करें, या किसी प्रशासक से सूची में अपना नाम जाँचने को कहें।',
                  )}
                </InferenceNote>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Btn as={Link} href="/asha/register" variant="asha">
                    {t('Register as an ASHA worker', 'आशा कार्यकर्ता के रूप में पंजीकरण करें')}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Btn>
                  <Btn as={Link} href="/app" variant="outline">
                    {t('Back to the citizen app', 'नागरिक ऐप पर वापस')}
                  </Btn>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="mt-5 text-[0.8rem] font-semibold text-ink-faint underline-offset-2 transition hover:text-ink hover:underline"
                >
                  {t('Sign in with a different account', 'दूसरे खाते से साइन इन करें')}
                </button>
              </div>
            </div>
          </Card>
        ) : null}

        <Card tone="asha" className="p-7 sm:p-10">
          <Eyebrow>
            {wantedAdmin
              ? t('Administrator sign-in · प्रशासक', 'प्रशासक साइन-इन')
              : t('ASHA worker portal · आशा कार्यकर्ता पोर्टल', 'आशा कार्यकर्ता पोर्टल')}
          </Eyebrow>
          <h1 className="display-md mt-4 text-3xl sm:text-4xl">
            {wantedAdmin
              ? t('Sign in to review registrations', 'पंजीकरण जाँचने के लिए साइन इन करें')
              : t('Sign in to your register', 'अपने रजिस्टर में साइन इन करें')}
          </h1>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {wantedAdmin
              ? t(
                  'The approval queue opens for administrator accounts only. Use the email and password issued to you.',
                  'स्वीकृति सूची केवल प्रशासक खातों के लिए खुलती है। आपको दिया गया ईमेल और पासवर्ड उपयोग करें।',
                )
              : t(
                  'Your alerts, referrals and the families on your register. Use the email and password issued by your block office.',
                  'आपकी सूचनाएँ, रेफरल और आपके रजिस्टर के परिवार। अपने ब्लॉक कार्यालय से मिला ईमेल और पासवर्ड उपयोग करें।',
                )}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <label className="block">
              <span className="eyebrow">{t('Email', 'ईमेल')}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                inputMode="email"
                className="field mt-2 w-full"
                placeholder="name@block.gov.in"
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
                  autoComplete="current-password"
                  className="field w-full pr-14"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('Hide password', 'पासवर्ड छिपाएँ') : t('Show password', 'पासवर्ड दिखाएँ')}
                  className="absolute inset-y-0 right-0 grid w-14 place-items-center text-ink-faint transition hover:text-ink"
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </label>

            {error ? (
              <p className="text-sm font-semibold leading-relaxed text-siren" role="alert">
                {error}
              </p>
            ) : null}

            <Btn type="submit" variant="asha" size="lg" className="w-full" disabled={busy}>
              {busy ? t('Signing in…', 'साइन इन हो रहा है…') : t('Sign in', 'साइन इन करें')}
              {busy ? null : <ArrowRight size={17} aria-hidden="true" />}
            </Btn>
          </form>

          {/* Waiting on the profile row. Neither "welcome" nor "you are a
              citizen" is true yet, so the screen says only what it knows. */}
          {isAuthenticated && !profile && status !== 'error' ? (
            <div className="mt-6 flex items-start gap-2.5 border-t border-rule pt-6" role="status" aria-live="polite">
              <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-ink-faint" aria-hidden="true" />
              <p className="text-[0.85rem] leading-relaxed text-ink-soft">
                {stalled
                  ? t(
                      'You are signed in, but your account record has not come back yet. Check your connection and reload the page; if it keeps happening, your block office will need to look at the account.',
                      'आप साइन इन हैं, पर आपके खाते का रिकॉर्ड अभी नहीं आया। कनेक्शन जाँचें और पन्ना फिर से खोलें; बार-बार ऐसा हो तो ब्लॉक कार्यालय से खाता जाँचने को कहें।',
                    )
                  : t('Checking your registration…', 'आपका पंजीकरण जाँचा जा रहा है…')}
              </p>
            </div>
          ) : null}

          <div className="mt-7 border-t border-rule pt-6">
            <Btn variant="outline" className="w-full" onClick={handleGoogle} disabled={busy}>
              <LogIn size={17} aria-hidden="true" />
              {t('Continue with Google', 'Google से जारी रखें')}
            </Btn>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-ink-faint">
              {t(
                'Google proves your email address and nothing more. It does not make an account an ASHA account — that still needs your roster code or an administrator’s approval.',
                'Google केवल आपका ईमेल पता प्रमाणित करता है। इससे खाता आशा खाता नहीं बनता — उसके लिए रोस्टर कोड या प्रशासक की स्वीकृति चाहिए।',
              )}
            </p>
          </div>

          <div className="mt-7 border-t border-rule pt-6">
            <div className="flex items-start gap-2.5">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-seal" aria-hidden="true" />
              <p className="text-[0.8rem] leading-relaxed text-ink-soft">
                {t(
                  'Worker records are protected in the database itself, not just in this app. Signing in with a citizen account will not open these pages, whatever address is typed.',
                  'कार्यकर्ता रिकॉर्ड केवल ऐप में नहीं, डेटाबेस में ही सुरक्षित हैं। नागरिक खाते से साइन इन करने पर ये पन्ने नहीं खुलेंगे, पता कुछ भी लिखा जाए।',
                )}
              </p>
            </div>

            <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
              {t('New here and on your sub-centre roster?', 'नए हैं और उप-केंद्र सूची में हैं?')}{' '}
              <Link href="/asha/register" className="font-semibold text-asha underline-offset-2 hover:underline">
                {t('Register as an ASHA worker', 'आशा कार्यकर्ता पंजीकरण')}
              </Link>
            </p>
            <p className="mt-2 text-[0.8rem] text-ink-faint">
              {t('Not an ASHA worker?', 'आशा कार्यकर्ता नहीं हैं?')}{' '}
              <Link href="/app" className="font-semibold text-seal underline-offset-2 hover:underline">
                {t('Go to the citizen app', 'नागरिक ऐप पर जाएँ')}
              </Link>
            </p>
          </div>
        </Card>

        {loading ? (
          <p className="mt-4 text-center text-[0.8rem] text-ink-faint" role="status">
            {t('Checking your session…', 'आपका सत्र जाँचा जा रहा है…')}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/**
 * True once `ms` has passed while `active` is still true. The only use
 * for it is to stop a profile row that never arrives from spinning
 * forever with no explanation on screen.
 */
function useStalled(active, ms = 8000) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!active) {
      setStalled(false);
      return undefined;
    }
    const id = setTimeout(() => setStalled(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);

  return stalled;
}

/** The stashed path, without clearing it. Used only to word the page. */
function peekIntendedPath() {
  try {
    return sessionStorage.getItem('sehat-sathi-intended') ?? '';
  } catch {
    return '';
  }
}

/**
 * Read-and-clear: a stale intended path shouldn't hijack a later login.
 *
 * Only a path this role will actually be let into is honoured, so a
 * worker is never bounced straight from signing in to a refusal screen.
 */
function takeIntendedPath(role) {
  const prefix = role === 'admin' ? '/admin' : '/asha';
  const home = role === 'admin' ? '/admin/asha-requests' : '/asha';
  try {
    const stored = sessionStorage.getItem('sehat-sathi-intended');
    sessionStorage.removeItem('sehat-sathi-intended');
    if (stored && stored.startsWith(prefix)) return stored;
  } catch {
    /* private browsing */
  }
  return home;
}
