import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Mic,
  Siren,
  Menu,
  X,
  UserCheck,
  Camera,
  Bot,
  FileText,
  MapPin,
  Home,
  Bell,
  MessageSquare,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { useAuth } from '@/lib/auth';
import { useAsync } from '@/lib/useAsync';
import { getUnreadNotificationCount } from '@/services/platform';
import { getT, SUPPORTED_LANGUAGES } from '@/services/i18n';
import { useScrolled } from '@/lib/motion';

/** Pages that provide their own full-bleed chrome. */
const HIDE_ON = ['/onboarding', '/asha/login', '/signin'];

/**
 * Dispatched by src/pages/Notifications.jsx when read state moves, so
 * the badge below stops showing a number for notices that have just
 * been opened. A window event rather than an import, so the chrome does
 * not depend on a page module.
 */
const READ_EVENT = 'sehat:notifications-read';

/**
 * Links in the mobile sheet. `key` reads a dictionary entry; `en`/`hi`
 * are for screens that have no dictionary key yet.
 */
const MOBILE_LINKS = [
  { href: '/app', icon: Home, key: 'home' },
  { href: '/assistant', icon: Bot, key: 'aiVoice' },
  { href: '/schemes', icon: FileText, key: 'schemes' },
  { href: '/care', icon: MapPin, key: 'findCare' },
  { href: '/image-assist', icon: Camera, key: 'imageAssist' },
  { href: '/notifications', icon: Bell, en: 'Notices', hi: 'सूचनाएँ' },
  { href: '/messages', icon: MessageSquare, en: 'Messages', hi: 'संदेश' },
  { href: '/asha/login', icon: UserCheck, key: 'ashaPortal' },
];

export function Header() {
  const { language, setLanguage, userRole } = useAppState();
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled(24);

  /* Refetched on every navigation, so the number in the chrome is the
     one the server holds now rather than the one it held when the app
     was opened. */
  const badge = useAsync(() => getUnreadNotificationCount(), [location, isAuthenticated], {
    skip: !isAuthenticated,
  });

  /* useAsync keeps the previous value while a refetch is in flight,
     which is right for a list and wrong for this badge: the one moment
     that must never show an old count is immediately after the reader
     marks something read. So a read event suppresses the badge until
     fresh data has actually arrived. */
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    const onRead = () => {
      setSuppressed(true);
      badge.reload();
    };
    window.addEventListener(READ_EVENT, onRead);
    return () => window.removeEventListener(READ_EVENT, onRead);
  }, [badge.reload]);

  useEffect(() => {
    if (!badge.loading) setSuppressed(false);
  }, [badge.loading]);

  const t = getT(language);
  const isLanding = location === '/';
  const hidden = HIDE_ON.includes(location);

  if (hidden) return null;

  // Only ever the server's own figure. No fallback, no guess: when the
  // count is unknown the badge is simply absent.
  const unread = suppressed ? null : badge.data?.unreadCount;
  const showBadge = typeof unread === 'number' && unread > 0;
  const badgeText = unread > 99 ? '99+' : String(unread);

  const noticesLabel = t('Notices', 'सूचनाएँ');
  const messagesLabel = t('Messages', 'संदेश');

  // On the landing hero the bar floats over the page and only takes on
  // a surface once you have scrolled past the fold.
  const surface =
    isLanding && !scrolled
      ? 'bg-transparent border-transparent'
      : 'bg-paper/90 border-rule backdrop-blur-md';

  const iconButton =
    'relative grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-rule text-ink transition hover:border-ink';

  const badgeChip = (
    <span
      className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-siren px-1 font-mono text-[0.65rem] font-bold leading-none text-paper"
      aria-hidden="true"
    >
      {badgeText}
    </span>
  );

  return (
    <header
      className={`${isLanding ? 'fixed' : 'sticky'} inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${surface}`}
    >
      <div className="shell flex h-[72px] items-center justify-between gap-4">
        {/* ---------- Brand ---------- */}
        <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-paper">
            <Mic size={21} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-xl leading-none font-semibold tracking-tight sm:text-[1.35rem]">
              {t.appName}
            </span>
            {/* The tagline is the first thing to go when space is tight. */}
            <span className="eyebrow mt-1 hidden truncate sm:block">
              {userRole === 'asha' ? t.ashaPortal : t.tagline}
            </span>
          </span>
        </Link>

        {/* ---------- Desktop controls ---------- */}
        <div className="hidden items-center gap-2 md:flex">
          {isAuthenticated ? (
            <>
              <Link
                href="/notifications"
                className={iconButton}
                aria-label={
                  showBadge
                    ? t(`${noticesLabel}, ${badgeText} unread`, `${noticesLabel}, ${badgeText} अनपढ़ी`)
                    : noticesLabel
                }
                data-testid="link-header-notifications"
              >
                <Bell size={17} aria-hidden="true" />
                {showBadge ? badgeChip : null}
              </Link>

              <Link
                href="/messages"
                className={iconButton}
                aria-label={messagesLabel}
                data-testid="link-header-messages"
              >
                <MessageSquare size={17} aria-hidden="true" />
              </Link>
            </>
          ) : (
            /* Signed out. Until this link existed there was no way into
               /signin from the chrome at all, so the only people who found
               it were the ones who had already hit a screen that turned
               them away. An account is what stores the village, and the
               village is what connects a household to its ASHA worker. */
            <Link
              href="/signin"
              className="btn btn-outline h-11 min-h-0 text-sm"
              data-testid="link-header-signin"
            >
              {t('Sign in', 'साइन इन')}
            </Link>
          )}

          <label className="sr-only" htmlFor="lang-select">
            {t.languageLabel}
          </label>
          <select
            id="lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-11 rounded-full border-[1.5px] border-rule bg-transparent px-4 text-sm font-semibold text-ink transition hover:border-ink focus:border-seal focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.name}>
                {lang.name}
              </option>
            ))}
          </select>

          {userRole === 'asha' ? (
            <Link href="/asha" className="btn btn-asha h-11 min-h-0 text-sm">
              <UserCheck size={16} aria-hidden="true" />
              {t.ashaPortal}
            </Link>
          ) : (
            <Link
              href="/emergency"
              className="btn btn-siren h-11 min-h-0 text-sm"
              data-testid="btn-header-emergency"
            >
              <Siren size={16} aria-hidden="true" />
              {t.emergency108}
            </Link>
          )}
        </div>

        {/* ---------- Mobile controls ---------- */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/emergency"
            className="btn btn-siren h-11 min-h-0 px-4 text-sm"
            aria-label={t.emergency108}
          >
            <Siren size={16} aria-hidden="true" />
            108
          </Link>

          {isAuthenticated ? (
            <Link
              href="/notifications"
              className={iconButton}
              aria-label={
                showBadge
                  ? t(`${noticesLabel}, ${badgeText} unread`, `${noticesLabel}, ${badgeText} अनपढ़ी`)
                  : noticesLabel
              }
            >
              <Bell size={18} aria-hidden="true" />
              {showBadge ? badgeChip : null}
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Menu"
            className="grid h-11 w-11 place-items-center rounded-xl border-[1.5px] border-rule text-ink"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* ---------- Mobile sheet ---------- */}
      {menuOpen && (
        <div className="border-t border-rule bg-paper-2 md:hidden">
          <div className="shell space-y-4 py-5">
            <div>
              <label className="eyebrow mb-2 block" htmlFor="lang-select-mobile">
                {t.languageLabel}
              </label>
              <select
                id="lang-select-mobile"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="field"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.name}>
                    {lang.name} · {lang.script}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MOBILE_LINKS.map(({ href, icon: Icon, key, en, hi }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[3.25rem] items-center gap-2.5 rounded-sm border border-rule bg-paper px-3 text-sm font-semibold"
                >
                  <Icon size={17} className="shrink-0 text-seal" aria-hidden="true" />
                  <span className="truncate">{key ? t[key] : t(en, hi)}</span>
                  {href === '/notifications' && showBadge ? (
                    <span className="ml-auto shrink-0 font-mono text-[0.7rem] text-siren">
                      {badgeText}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>

            {/* The same missing door as on desktop. The links above all
                work signed out; these two are the ones that cannot,
                because a notice and a conversation both belong to a
                person rather than to a device. */}
            {!isAuthenticated ? (
              <Link
                href="/signin"
                onClick={() => setMenuOpen(false)}
                className="btn btn-outline w-full"
              >
                {t('Sign in', 'साइन इन')}
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </header>
  );
}
