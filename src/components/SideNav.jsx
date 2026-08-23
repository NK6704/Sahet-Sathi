import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Home,
  Bot,
  FileText,
  MapPin,
  Camera,
  User,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Settings,
  Siren
} from 'lucide-react';
import { useAppState } from '@/state/store';

export function SideNav() {
  const [location] = useLocation();
  const { language, userRole } = useAppState();
  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const citizenNav = [
    { href: '/app', label: isHindi ? 'होम डैशबोर्ड' : 'Home Dashboard', icon: Home },
    { href: '/assistant', label: isHindi ? 'बोलकर पूछें (Voice)' : 'AI Voice Assistant', icon: Bot, highlight: true },
    { href: '/schemes', label: isHindi ? 'सरकारी योजनाएं' : 'Health Schemes', icon: FileText },
    { href: '/care', label: isHindi ? 'पास का स्वास्थ्य केंद्र' : 'Nearby Healthcare', icon: MapPin },
    { href: '/benefits', label: isHindi ? 'योजना लाभ ट्रैकर' : 'Benefit Tracker', icon: TrendingUp },
    { href: '/image-assist', label: isHindi ? 'पर्ची / दवा फोटो जाँच' : 'Prescription Assist', icon: Camera },
    { href: '/profile', label: isHindi ? 'मेरी स्वास्थ्य प्रोफ़ाइल' : 'Health Profile', icon: User },
    { href: '/settings', label: isHindi ? 'सेटिंग्स व सहायता' : 'Settings & Offline', icon: Settings },
  ];

  const ashaNav = [
    { href: '/asha', label: 'ASHA Dashboard', icon: UserCheck, highlight: true },
    { href: '/assistant', label: isHindi ? 'त्वरित सलाह टूल' : 'Clinical Assistant', icon: Bot },
    { href: '/schemes', label: isHindi ? 'योजना गाइड' : 'Scheme Catalog', icon: FileText },
    { href: '/care', label: isHindi ? 'रेफरल नेटवर्क' : 'Care Referral', icon: MapPin },
    { href: '/emergency', label: isHindi ? 'आपातकालीन मोड' : 'Emergency Triage', icon: Siren },
    { href: '/settings', label: isHindi ? 'सेटिंग्स' : 'Settings', icon: Settings }
  ];

  const items = userRole === 'asha' ? ashaNav : citizenNav;

  return (
    <aside
      id="sidebar-navigation"
      className="hidden w-64 shrink-0 border-r border-[#ded5c2] bg-[#f3eddf]/90 p-5 md:block min-h-[calc(100vh-74px)]"
    >
      <div className="sticky top-24">
        <p className="mb-4 px-3 text-[10px] font-extrabold uppercase tracking-widest text-[#8a6b4a]">
          {userRole === 'asha' ? 'ASHA Clinical Tools' : (isHindi ? 'आपकी स्वास्थ्य सेवा' : 'Health Services')}
        </p>

        <nav className="space-y-1.5">
          {items.map((item) => {
            const active = location === item.href || (item.href !== '/app' && item.href !== '/' && location.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 text-xs font-bold transition ${
                  active
                    ? 'bg-[#1f655d] text-[#f9f2df] shadow-sm'
                    : item.highlight
                    ? 'bg-[#dceee9] text-[#1f655d] hover:bg-[#cee4de]'
                    : 'text-[#485f57] hover:bg-[#e8dfce]'
                }`}
                data-testid={`link-side-${item.href.replace('/', '') || 'root'}`}
              >
                <Icon size={18} className={active ? 'text-[#f9f2df]' : 'text-[#1f655d]'} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Safe Care Footer Box */}
        <div className="mt-8 rounded-3xl bg-[#e6dac7] p-4 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#544133]">
            <ShieldCheck size={18} className="text-[#9b6242]" />
            <span>{isHindi ? 'सुरक्षित व सत्यापित' : 'Official Health Data'}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#756151]">
            {isHindi
              ? 'राष्ट्रीय स्वास्थ्य मिशन (NHM) व MoHFW के सत्यापित नियमों पर आधारित।'
              : 'Directly grounded in National Health Mission protocols & Gov portals.'}
          </p>
        </div>
      </div>
    </aside>
  );
}
