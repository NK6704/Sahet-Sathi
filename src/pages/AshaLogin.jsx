import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { UserCheck, ShieldCheck, Key, ArrowRight } from 'lucide-react';
import { useAppState } from '@/state/store';

export function AshaLogin() {
  const { language, setUserRole, setActiveAsha } = useAppState();
  const [, setLocation] = useLocation();

  const [workerId, setWorkerId] = useState('ASHA-MP-SEH-104');
  const [passcode, setPasscode] = useState('••••••');
  const [villageSector, setVillageSector] = useState('Mandi & Shyampur Cluster');

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const handleLogin = (e) => {
    e.preventDefault();
    setUserRole('asha');
    setActiveAsha({
      id: workerId,
      name: 'Radha Bai (ASHA)',
      village: villageSector,
      phone: '98261-45012',
      isLoggedIn: true
    });
    setLocation('/asha');
  };

  return (
    <main className="min-h-[calc(100vh-74px)] px-4 py-8 max-w-md mx-auto flex items-center justify-center">
      <div className="w-full rounded-[2.5rem] border border-[#ded5c2] bg-[#fbf8ef] p-6 sm:p-8 shadow-xl appear">
        <div className="text-center">
          <span className="inline-grid h-16 w-16 place-items-center rounded-3xl bg-[#dceee9] text-[#1f655d] shadow-sm">
            <UserCheck size={32} />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold text-[#214e4a] sm:text-3xl">
            {isHindi ? 'आशा कार्यकर्ता पोर्टल' : 'ASHA Health Worker Portal'}
          </h1>
          <p className="mt-1 text-xs text-[#627a71]">
            {isHindi ? 'गाँव स्वास्थ्य निगरानी, आपातकालीन रेफरल व योजना सत्यापन' : 'Village healthcare monitoring, emergency dispatch, and DBT validation'}
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'आशा कार्यकर्ता आईडी (ID)' : 'ASHA Worker ID'}
            </label>
            <input
              type="text"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              required
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'गाँव / स्वास्थ्य सेक्टर' : 'Village / Assigned Sector'}
            </label>
            <input
              type="text"
              value={villageSector}
              onChange={(e) => setVillageSector(e.target.value)}
              required
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'सुरक्षा पासकोड' : 'Security Passcode'}
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              required
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <button
            type="submit"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#1f655d] py-3.5 text-sm font-extrabold text-[#f9f2df] shadow-md hover:bg-[#18534c] transition"
            data-testid="btn-login-asha"
          >
            <span>{isHindi ? 'डैशबोर्ड में प्रवेश करें' : 'Login to ASHA Workspace'}</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </main>
  );
}
