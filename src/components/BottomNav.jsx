import React from 'react';
import { Link, useLocation } from 'wouter';
import { Home, Bot, FileText, MapPin, User, Siren, UserCheck } from 'lucide-react';
import { useAppState } from '@/state/store';

export function BottomNav() {
  const [location] = useLocation();
  const { language, userRole } = useAppState();
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const citizenItems = [
    { href: '/app', label: isHindi ? 'होम' : 'Home', icon: Home },
    { href: '/assistant', label: isHindi ? 'आवाज़' : 'Voice', icon: Bot, highlight: true },
    { href: '/schemes', label: isHindi ? 'योजनाएं' : 'Schemes', icon: FileText },
    { href: '/care', label: isHindi ? 'इलाज' : 'Care', icon: MapPin },
    { href: '/profile', label: isHindi ? 'प्रोफ़ाइल' : 'Profile', icon: User },
  ];

  const ashaItems = [
    { href: '/asha', label: 'Alerts', icon: UserCheck, highlight: true },
    { href: '/assistant', label: isHindi ? 'सलाह' : 'Guidance', icon: Bot },
    { href: '/schemes', label: isHindi ? 'योजनाएं' : 'Schemes', icon: FileText },
    { href: '/care', label: isHindi ? 'अस्पताल' : 'Referral', icon: MapPin },
    { href: '/settings', label: isHindi ? 'सेटिंग्स' : 'Settings', icon: User },
  ];

  const items = userRole === 'asha' ? ashaItems : citizenItems;

  return (
    <nav
      id="bottom-mobile-navbar"
      className="safe-area-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-[#ded5c2] bg-[#f9f4e8]/95 px-2 py-1.5 backdrop-blur-lg md:hidden shadow-lg"
    >
      <div className="mx-auto flex max-w-md items-center justify-around">
        {items.map((item) => {
          const active = location === item.href || (item.href !== '/app' && item.href !== '/' && location.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[58px] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[10px] font-bold transition ${
                active
                  ? 'bg-[#1f655d] text-[#f9f2df] shadow-xs'
                  : item.highlight
                  ? 'bg-[#dceee9] text-[#1f655d]'
                  : 'text-[#657a72] hover:text-[#1f655d]'
              }`}
              data-testid={`link-bottom-${item.href.replace('/', '') || 'root'}`}
            >
              <Icon size={18} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
