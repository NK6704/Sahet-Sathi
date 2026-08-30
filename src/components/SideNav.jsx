import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Home,
  Bot,
  FileText,
  MapPin,
  Camera,
  User,
  TrendingUp,
  UserCheck,
  Settings,
  Siren,
  Send,
  CalendarDays,
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { Eyebrow, Stamp } from '@/components/ds';

export function SideNav() {
  const [location] = useLocation();
  const { language, userRole } = useAppState();
  const hi = language !== 'English';

  const citizenNav = [
    { href: '/app', label: hi ? 'होम' : 'Home', icon: Home },
    { href: '/assistant', label: hi ? 'बोलकर पूछें' : 'Ask by voice', icon: Bot, accent: true },
    { href: '/schemes', label: hi ? 'सरकारी योजनाएँ' : 'Government schemes', icon: FileText },
    { href: '/care', label: hi ? 'पास का इलाज' : 'Care near you', icon: MapPin },
    { href: '/benefits', label: hi ? 'लाभ ट्रैकर' : 'Benefit tracker', icon: TrendingUp },
    { href: '/image-assist', label: hi ? 'पर्ची पढ़ें' : 'Read a prescription', icon: Camera },
    { href: '/profile', label: hi ? 'मेरी प्रोफ़ाइल' : 'My profile', icon: User },
    { href: '/settings', label: hi ? 'सेटिंग्स' : 'Settings', icon: Settings },
  ];

  /* An ASHA worker browsing the citizen side keeps a way back into her
     own register. These point at the portal, not at citizen screens
     that happen to have similar names. */
  const ashaNav = [
    { href: '/asha', label: hi ? 'डैशबोर्ड' : 'Dashboard', icon: UserCheck, accent: true },
    { href: '/asha/alerts', label: hi ? 'सूचनाएँ' : 'Alerts', icon: Siren },
    { href: '/asha/referrals', label: hi ? 'रेफरल' : 'Referrals', icon: Send },
    { href: '/asha/healthcare', label: hi ? 'सुविधाएँ' : 'Facilities', icon: MapPin },
    { href: '/asha/schemes', label: hi ? 'योजनाएँ' : 'Schemes', icon: FileText },
    { href: '/asha/camps', label: hi ? 'शिविर' : 'Camps', icon: CalendarDays },
    { href: '/asha/profile', label: hi ? 'मेरा खाता' : 'My account', icon: User },
  ];

  const items = userRole === 'asha' ? ashaNav : citizenNav;

  const isActive = (href) =>
    location === href || (href !== '/app' && href !== '/' && location.startsWith(href));

  return (
    <aside
      id="sidebar-navigation"
      className="hidden min-h-[calc(100vh-72px)] w-64 shrink-0 border-r border-rule bg-paper-3 p-4 md:block"
    >
      <div className="sticky top-[88px]">
        <Eyebrow className="px-3">
          {userRole === 'asha'
            ? hi ? 'आशा उपकरण' : 'ASHA tools'
            : hi ? 'स्वास्थ्य सेवाएँ' : 'Health services'}
        </Eyebrow>

        <nav className="mt-4 space-y-1">
          {items.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[3rem] items-center gap-3 rounded-sm px-3 text-sm font-semibold transition ${
                  active
                    ? 'bg-ink text-paper'
                    : item.accent
                    ? 'bg-asha-soft text-asha hover:bg-asha-soft/70'
                    : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
                }`}
                data-testid={`link-side-${item.href.replace('/', '') || 'root'}`}
              >
                <Icon
                  size={18}
                  className={`shrink-0 ${active ? 'text-paper' : item.accent ? 'text-asha' : 'text-seal'}`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Where the data comes from, stated in the chrome so it is
            never a question. */}
        <div className="mt-8 rounded-card border border-rule bg-paper-2 p-4">
          <Stamp kind="verified" label="Data source" source="NHM · MoHFW" />
          <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
            {hi
              ? 'योजना और सुविधा की जानकारी राष्ट्रीय स्वास्थ्य मिशन और MoHFW के स्रोतों से।'
              : 'Scheme and facility information comes from National Health Mission and MoHFW sources.'}
          </p>
        </div>
      </div>
    </aside>
  );
}
