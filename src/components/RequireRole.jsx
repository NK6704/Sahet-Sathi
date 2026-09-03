import React, { useEffect } from 'react';
import { Redirect, useLocation } from 'wouter';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getT } from '@/services/i18n';
import { Btn, Eyebrow, LoadingState } from '@/components/ds';

/* =============================================================
   Route protection.

   This component is the polite half of the answer to "can a citizen
   reach /asha by typing the URL?". It stops them seeing the screen.
   The half that actually matters is RLS in 06_platform_rls.sql plus
   the server-side role check on /api/asha/* and /api/admin/* —
   because someone determined enough will skip the UI entirely.

   So: treat this as courtesy, not security. Never let it be the only
   thing standing between a role and a record.

   Two roles pass through here and they are not nested. An admin can
   approve a worker's registration; a worker cannot. A worker can read
   the households on her register; an admin has no business in them.
   Neither grant is written as a superset of the other, so a role only
   ever opens the screens it was given — `useAuth().isAsha` is true for
   an admin, and using it here would have handed every admin account a
   village's health records as a side effect of being able to approve
   the worker who keeps them.
   ============================================================= */

/**
 * Where a signed-out visitor to a staff route is sent.
 *
 * The staff entrance, not the household one at /signin. Both exist and
 * they are not interchangeable: /signin issues a citizen session with no
 * roster check behind it, so sending a worker there would give her an
 * account that cannot open the screen she was trying to reach. The path
 * she was headed for is stashed below, and /asha/login reads it back.
 */
const ENTRANCE = '/asha/login';

export function RequireRole({ role = 'asha', children, redirectTo = ENTRANCE }) {
  const { loading, isAuthenticated, profile, role: actual, language } = useAuth();
  const [location] = useLocation();
  const t = getT(language);

  // Remember where they were headed so login can send them back.
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      try {
        sessionStorage.setItem('sehat-sathi-intended', location);
      } catch {
        /* private browsing; they will land on the default page instead */
      }
    }
  }, [loading, isAuthenticated, location]);

  if (loading) {
    return (
      <main className="shell py-20">
        <LoadingState label={t('Checking your access', 'आपकी पहुँच जाँची जा रही है')} rows={2} />
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to={redirectTo} replace />;
  }

  /* A session arrives one round trip before the profile row that
     carries the role, and in that gap `actual` is null. Refusing on a
     null role told real workers their account was a citizen account
     for a frame, which is both false and alarming. Wait instead. */
  if (!profile) {
    return (
      <main className="shell flex min-h-[60vh] items-center justify-center py-20">
        <p className="flex items-center gap-2.5 text-[0.9rem] text-ink-soft" role="status" aria-live="polite">
          <Loader2 size={16} className="animate-spin text-ink-faint" aria-hidden="true" />
          {t('Checking your registration…', 'आपका पंजीकरण जाँचा जा रहा है…')}
        </p>
      </main>
    );
  }

  // Exact match, both ways. No role inherits another's screens.
  if (actual !== role) {
    return <NotForThisAccount wanted={role} actual={actual} t={t} />;
  }

  return children;
}

/**
 * Shown when a signed-in account lands on a route held by another role.
 * It says what happened rather than bouncing them somewhere confusing —
 * a silent redirect reads as a broken link — and it points at the one
 * thing this account can actually do next.
 */
function NotForThisAccount({ wanted, actual, t }) {
  const admin = wanted === 'admin';

  const title = admin
    ? t('This part is for administrators', 'यह भाग प्रशासकों के लिए है')
    : t('This part is for ASHA workers', 'यह भाग आशा कार्यकर्ताओं के लिए है');

  const body = admin
    ? t(
        'The registration queue decides who becomes a health worker, so it opens only for an administrator account.',
        'पंजीकरण सूची तय करती है कि कौन स्वास्थ्य कार्यकर्ता बनेगा, इसलिए यह केवल प्रशासक खाते के लिए खुलती है।',
      )
    : actual === 'admin'
      ? t(
          'This account is registered as an administrator. Worker screens hold the households on one worker’s register, so they open for that worker and nobody else.',
          'यह खाता प्रशासक के रूप में पंजीकृत है। कार्यकर्ता पन्नों में एक कार्यकर्ता के रजिस्टर के परिवार होते हैं, इसलिए वे केवल उसी कार्यकर्ता के लिए खुलते हैं।',
        )
      : t(
          'This account is registered as a citizen account, so it cannot open the worker portal. Nothing is wrong — this section holds other families’ health records, so it stays closed unless the account is registered to an ASHA worker.',
          'यह खाता नागरिक खाते के रूप में पंजीकृत है, इसलिए कार्यकर्ता पोर्टल नहीं खुलेगा। कुछ गलत नहीं है — इस भाग में दूसरे परिवारों के स्वास्थ्य रिकॉर्ड होते हैं, इसलिए यह केवल आशा कार्यकर्ता के खाते से खुलता है।',
        );

  return (
    <main className="shell flex min-h-[70vh] items-center py-16">
      <div className="card card-rail mx-auto max-w-xl p-8" style={{ '--rail': 'var(--color-amber)' }}>
        <ShieldAlert className="text-amber" size={26} strokeWidth={2.2} aria-hidden="true" />
        <Eyebrow className="mt-5">{t('Not this account', 'यह खाता नहीं')}</Eyebrow>
        <h1 className="display-md mt-2.5">{title}</h1>
        <p className="lede mt-4">{body}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          {actual === 'asha' ? (
            <Btn as="a" href="/asha" variant="asha">
              {t('Back to my register', 'मेरे रजिस्टर पर वापस')}
            </Btn>
          ) : (
            <Btn as="a" href="/app" variant="primary">
              {t('Go to my home', 'मेरे होम पर जाएँ')}
            </Btn>
          )}

          {actual === 'admin' ? (
            <Btn as="a" href="/admin/asha-requests" variant="outline">
              {t('Open the registration queue', 'पंजीकरण सूची खोलें')}
            </Btn>
          ) : null}

          {/* A citizen who is genuinely an ASHA has one sanctioned way
              through, and it is not this screen. Point at it. */}
          {!admin && actual !== 'admin' ? (
            <Btn as="a" href="/asha/register" variant="outline">
              {t('I am an ASHA worker — register', 'मैं आशा कार्यकर्ता हूँ — पंजीकरण करें')}
            </Btn>
          ) : null}
        </div>
      </div>
    </main>
  );
}
