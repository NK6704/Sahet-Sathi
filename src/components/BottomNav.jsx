import React from 'react';
import {
  Home,
  Bot,
  FileText,
  MapPin,
  User,
  Siren,
  UserCheck,
  MessageSquare,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAppState } from '@/state/store';

export function BottomNav() {
  const [location] = useLocation();
  const { language, userRole } = useAppState();
  const hi = language !== 'English';

  /* Five slots, because a sixth on a 360px screen makes every one of
     them too small to hit with a thumb. Notices and messages are not
     here: the header carries the bell with its unread badge on mobile
     and the sheet behind the menu button lists both, so neither is
     reachable only from a desktop sidebar. */
  const citizenItems = [
    { href: '/app', label: hi ? 'होम' : 'Home', icon: Home },
    { href: '/assistant', label: hi ? 'आवाज़' : 'Voice', icon: Bot, accent: true },
    { href: '/schemes', label: hi ? 'योजनाएँ' : 'Schemes', icon: FileText },
    { href: '/care', label: hi ? 'इलाज' : 'Care', icon: MapPin },
    { href: '/profile', label: hi ? 'प्रोफ़ाइल' : 'Profile', icon: User },
  ];

  /* Shown to a worker who is on the citizen side of the app — the
     portal itself runs without this bar. Conversations are here rather
     than facilities because the portal's own section nav already lists
     facilities, and a villager waiting on a reply should not be two
     navigations away. */
  const ashaItems = [
    { href: '/asha', label: hi ? 'आज' : 'Today', icon: UserCheck, accent: true },
    { href: '/asha/alerts', label: hi ? 'सूचनाएँ' : 'Alerts', icon: Siren },
    { href: '/asha/messages', label: hi ? 'संदेश' : 'Messages', icon: MessageSquare },
    { href: '/asha/referrals', label: hi ? 'रेफरल' : 'Referrals', icon: MapPin },
    { href: '/asha/profile', label: hi ? 'खाता' : 'Account', icon: User },
  ];

  const items = userRole === 'asha' ? ashaItems : citizenItems;

  return (
    <nav
      id="bottom-mobile-navbar"
      aria-label={hi ? 'मुख्य नेविगेशन' : 'Main navigation'}
      className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper/95 px-2 pt-1.5 backdrop-blur-lg md:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around gap-1">
        {items.map((item) => {
          const active =
            location === item.href ||
            (item.href !== '/app' && item.href !== '/' && location.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              /* 56px minimum: this gets tapped with a thumb, often
                 one-handed, sometimes outdoors. */
              className={`flex min-h-[3.5rem] min-w-[3.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-sm px-1 text-[0.7rem] font-semibold transition ${
                active
                  ? 'bg-ink text-paper'
                  : item.accent
                  ? 'text-asha'
                  : 'text-ink-faint'
              }`}
              data-testid={`link-bottom-${item.href.replace('/', '') || 'root'}`}
            >
              <Icon size={19} aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
