import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  Siren,
  Users,
  Activity,
  CheckCircle2,
  Clock,
  Send,
  Phone,
  RefreshCw,
  PlusCircle,
  FileSpreadsheet,
  AlertTriangle
} from 'lucide-react';
import { useAppState } from '@/state/store';
import { getAshaDashboardData, updateAshaReferral } from '@/services/api';
import { ASHAAlertCard } from '@/components/asha/ASHAAlertCard';

export function AshaDashboard() {
  const { language, activeAsha } = useAppState();
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('emergency'); // 'emergency' | 'maternal' | 'immunization'

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getAshaDashboardData();
      setDashboardData(data);
    } catch (err) {
      console.warn('ASHA dashboard load err:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateStatus = async (alertId, newStatus, notes) => {
    try {
      await updateAshaReferral(alertId, { status: newStatus, notes });
      loadData();
    } catch (err) {
      console.warn('Update referral err:', err);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-24 md:pb-12 space-y-6">
      {/* Top Profile Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ded5c2] pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1f655d] text-[#f9f2df] shadow-sm">
            <UserCheck size={24} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold text-[#214e4a] sm:text-3xl">
              {activeAsha?.name || 'Radha Bai'} (ASHA Coordinator)
            </h1>
            <p className="text-xs text-[#637d74]">
              📍 {activeAsha?.village || 'Mandi Sector, Sehore'} · 📞 {activeAsha?.phone || '98261-45012'}
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 rounded-full border border-[#dacfb9] bg-[#fbf7ec] px-3.5 py-1.5 text-xs font-semibold text-[#1f655d] hover:bg-[#eee4d0]"
        >
          <RefreshCw size={14} />
          <span>{isHindi ? 'ताज़ा करें' : 'Refresh Feed'}</span>
        </button>
      </div>

      {/* Village KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-4 shadow-2xs">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#8a6b4a]">
            {isHindi ? 'गाँव परिवार' : 'Assigned Families'}
          </p>
          <p className="mt-1 font-display text-2xl font-black text-[#214e4a]">
            {dashboardData?.stats?.assigned_families || 310}
          </p>
        </div>

        <div className="rounded-3xl border border-[#f5b8ac] bg-[#fff6f4] p-4 shadow-2xs">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#b74636]">
            {isHindi ? 'सक्रिय आपातकाल' : 'Active SOS / Triage'}
          </p>
          <p className="mt-1 font-display text-2xl font-black text-[#b74636]">
            {dashboardData?.stats?.active_emergency_alerts || 2}
          </p>
        </div>

        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-4 shadow-2xs">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#8a572a]">
            {isHindi ? 'गर्भवती माताएं' : 'High Priority ANC'}
          </p>
          <p className="mt-1 font-display text-2xl font-black text-[#8a572a]">
            {dashboardData?.stats?.pregnant_women_tracked || 14}
          </p>
        </div>

        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-4 shadow-2xs">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#186b4d]">
            {isHindi ? 'टीकाकरण शेड्यूल' : 'Immunization Due'}
          </p>
          <p className="mt-1 font-display text-2xl font-black text-[#186b4d]">
            {dashboardData?.stats?.infant_immunization_due || 8}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#ded5c2] pb-2">
        <button
          onClick={() => setActiveTab('emergency')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
            activeTab === 'emergency'
              ? 'bg-[#b74636] text-[#fff7e9]'
              : 'bg-[#fbf8ef] text-[#637d74] hover:bg-[#eee4d0]'
          }`}
        >
          <Siren size={15} />
          <span>{isHindi ? 'आपातकालीन अलर्ट व रेफरल' : 'SOS & Referrals Feed'}</span>
        </button>

        <button
          onClick={() => setActiveTab('maternal')}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition ${
            activeTab === 'maternal'
              ? 'bg-[#1f655d] text-[#f9f2df]'
              : 'bg-[#fbf8ef] text-[#637d74] hover:bg-[#eee4d0]'
          }`}
        >
          <Activity size={15} />
          <span>{isHindi ? 'मातृ एवं शिशु रजिस्टर' : 'ANC & Maternity Register'}</span>
        </button>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="py-12 text-center text-xs font-bold text-[#1f655d] animate-pulse">
          {isHindi ? 'आशा रिकॉर्ड लोड हो रहे हैं…' : 'Syncing ASHA records…'}
        </div>
      ) : activeTab === 'emergency' ? (
        <div className="space-y-4 appear">
          {dashboardData?.emergency_alerts?.length === 0 ? (
            <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-10 text-center text-xs text-[#637d74]">
              {isHindi ? 'कोई लंबित आपातकालीन अलर्ट नहीं है।' : 'No active emergency alerts at this time.'}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {dashboardData?.emergency_alerts?.map((alert) => (
                <ASHAAlertCard
                  key={alert.id}
                  alert={alert}
                  onUpdateStatus={handleUpdateStatus}
                  language={language}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 shadow-xs space-y-4 appear">
          <h3 className="font-display text-lg font-bold text-[#214e4a]">
            🤰 {isHindi ? 'गर्भवती माता एवं जननी सुरक्षा ट्रैकिंग' : 'Maternal ANC & JSY Tracking'}
          </h3>

          <div className="space-y-3">
            {dashboardData?.maternal_cases?.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f5efe2] p-4 text-xs"
              >
                <div>
                  <h4 className="font-bold text-sm text-[#214e4a]">{m.name} ({m.age} yrs)</h4>
                  <p className="text-[#59746b]">
                    🤰 {m.gestation_months} Months · Expected: {m.edd}
                  </p>
                  <p className="mt-1 font-semibold text-[#8a572a]">
                    💰 JSY DBT Status: {m.jsy_status}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${m.phone}`}
                    className="flex items-center gap-1 rounded-full border border-[#cbd9cc] bg-white px-3 py-1.5 font-bold text-[#1f655d]"
                  >
                    <Phone size={13} /> {m.phone}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
