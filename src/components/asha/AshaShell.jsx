import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  BellRing,
  Send,
  Hospital,
  FileText,
  Tent,
  UserCog,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAppState } from '@/state/store';
import { Eyebrow, Stamp } from '@/components/ds';

/* =============================================================
   The portal shell.

   Calm on purpose. The public pages get parallax and oversized
   type; this is a tool someone opens at six in the morning on a
   ₹6,000 phone to find out who needs them today. No motion beyond
   what a tap requires, nothing decorative competing with a
   critical alert.
   ============================================================= */

const NAV = [
  { href: '/asha', label: 'Today', label_hi: 'आज', icon: LayoutDashboard, exact: true },
  { href: '/asha/alerts', label: 'Alerts', label_hi: 'सूचनाएँ', icon: BellRing },
  { href: '/asha/referrals', label: 'Referrals', label_hi: 'रेफरल', icon: Send },
  { href: '/asha/healthcare', label: 'Facilities', label_hi: 'सुविधाएँ', icon: Hospital },
  { href: '/asha/schemes', label: 'Schemes', label_hi: 'योजनाएँ', icon: FileText },
  { href: '/asha/camps', label: 'Camps', label_hi: 'शिविर', icon: Tent },
  { href: '/asha/profile', label: 'My details', label_hi: 'मेरा विवरण', icon: UserCog },
];

export function AshaShell({ title, eyebrow, sub, action, children }) {
  const [location] = useLocation();
  const { profile, signOut } = useAuth();
  const { language } = useAppState();
  /* The portal follows the choice made on the landing page. A
     worker's saved profile language wins once she has one; before
     that we use the device preference rather than assuming Hindi. */
  const hi = (profile?.language || language || 'English') !== 'English';
  const t = (en, dev) => (hi ? dev : en);

  const active = (item) =>
    item.exact ? location === item.href : location.startsWith(item.href);

  return (
    <div className="min-h-screen bg-paper">

      {/* Identity bar. A worker handling someone else's records
          should always be able to see whose account is open. */}
      <div className="border-b border-rule bg-ink text-paper">
        <div className="shell flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-paper/55 transition hover:text-paper"
            >
              Sehat Sathi
            </Link>
            <span className="h-5 w-px shrink-0 bg-paper/20" aria-hidden="true" />
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-asha text-paper">
              <UserCog size={16} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                {profile?.full_name || t('ASHA worker', 'आशा कार्यकर्ता')}
              </p>
              <p className="truncate font-mono text-[0.65rem] uppercase tracking-[0.12em] text-paper/55">
                {profile?.asha?.asha_code || '—'}
                {profile?.asha?.sub_centre ? ` · ${profile.asha.sub_centre}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="flex min-h-[2.5rem] items-center gap-2 rounded-sm border border-paper/25 px-3 text-[0.8rem] font-semibold text-paper transition hover:bg-paper/10"
          >
            <LogOut size={15} aria-hidden="true" />
            {t('Sign out', 'साइन आउट')}
          </button>
        </div>
      </div>

      {/* Section nav. Scrolls horizontally on a narrow screen rather
          than collapsing into a menu — one tap, not two. */}
      <nav
        aria-label={t('Portal sections', 'पोर्टल अनुभाग')}
        className="sticky top-0 z-30 border-b border-rule bg-paper-2/95 backdrop-blur-md"
      >
        <div className="shell flex gap-1 overflow-x-auto py-2">
          {NAV.map((item) => {
            const on = active(item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? 'page' : undefined}
                className={`flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-sm px-3.5 text-sm font-semibold transition ${
                  on ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-3 hover:text-ink'
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {t(item.label, item.label_hi)}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="shell pb-24 pt-8 sm:pt-10">
        <header className="mb-8">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <h1 className="display-md text-3xl sm:text-4xl">{title}</h1>
              {sub ? <p className="lede mt-3">{sub}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </header>

        {children}

        <footer className="mt-16 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <Stamp kind="verified" label="Records" source="Supabase, row-level secured" />
          <p className="text-sm text-ink-faint">
            {t(
              'You can only see households linked to your own alerts and referrals.',
              'आप केवल अपने अलर्ट और रेफरल से जुड़े परिवार देख सकती हैं।',
            )}
          </p>
        </footer>
      </main>
    </div>
  );
}
