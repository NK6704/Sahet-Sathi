import React, { useState, useEffect } from 'react';
import { TrendingUp, CheckCircle2, Clock, AlertCircle, FileText, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAppState } from '@/state/store';
import { getBenefitTrackerData } from '@/services/api';

export function Benefits() {
  const { language } = useAppState();
  const [trackerData, setTrackerData] = useState(null);
  const [loading, setLoading] = useState(true);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  useEffect(() => {
    getBenefitTrackerData()
      .then((data) => setTrackerData(data))
      .catch((err) => console.warn('Benefits load error:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
        <div>
          <span className="rounded-full bg-paper-2 px-3 py-1 text-xs font-bold text-amber uppercase">
            {isHindi ? 'सरकारी योजना लाभ ट्रैकर' : 'Direct Benefit Tracker'}
          </span>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
            {isHindi ? 'योजना लाभ व आवेदन स्थिति' : 'Active Schemes & Claims'}
          </h1>
          <p className="text-xs text-ink-soft">
            {isHindi
              ? 'आपके परिवार द्वारा आवेदित सरकारी स्वास्थ्य योजनाओं के अनुमोदन, वित्तीय सहायता राशि, और अगले कदम का सीधा विवरण।'
              : 'Real-time lifecycle tracking of health insurance cards, maternity DBT transfers, and hospital admission approvals.'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs font-bold text-seal animate-pulse">
          {isHindi ? 'लाभ ट्रैकर लोड हो रहा है…' : 'Loading benefit tracker…'}
        </div>
      ) : (
        <div className="space-y-6 appear">
          {/* Active Applications List */}
          <div className="space-y-4">
            {trackerData?.active_applications?.map((app) => (
              <div
                key={app.id}
                className="rounded-3xl border border-rule bg-paper-2 p-6 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-rule pb-3">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-faint">
                      Ref: {app.id}
                    </span>
                    <h3 className="font-display text-xl font-bold text-ink">
                      {app.scheme_name}
                    </h3>
                  </div>

                  <span className="rounded-full bg-seal-soft border border-seal/25 px-3 py-1 text-xs font-bold text-seal">
                    ● {app.status}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="rounded-2xl bg-paper-2 p-3">
                    <p className="text-ink-soft font-medium">{isHindi ? 'लाभार्थी' : 'Beneficiary'}</p>
                    <p className="mt-1 font-bold text-ink">{app.beneficiary}</p>
                  </div>
                  <div className="rounded-2xl bg-paper-2 p-3">
                    <p className="text-ink-soft font-medium">{isHindi ? 'सहायता राशि' : 'Sanctioned Amount'}</p>
                    <p className="mt-1 font-bold text-amber">{app.amount}</p>
                  </div>
                  <div className="rounded-2xl bg-paper-2 p-3">
                    <p className="text-ink-soft font-medium">{isHindi ? 'अंतिम अपडेट' : 'Last Updated'}</p>
                    <p className="mt-1 font-bold text-ink">{app.last_updated}</p>
                  </div>
                </div>

                {/* Milestones Stepper */}
                <div className="mt-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                    {isHindi ? 'प्रक्रिया के चरण:' : 'Progress Milestones:'}
                  </p>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {app.milestones?.map((m, idx) => (
                      <div
                        key={idx}
                        className={`rounded-2xl p-2.5 text-xs ${
                          m.completed
                            ? 'bg-seal-soft text-seal font-bold'
                            : 'bg-paper-2 text-ink-soft'
                        }`}
                      >
                        <p className="flex items-center gap-1">
                          {m.completed ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                          <span>{m.title}</span>
                        </p>
                        {m.date && <p className="mt-1 text-[10px] opacity-75">{m.date}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl bg-paper-2 border border-rule p-3 text-xs text-ink-soft">
                  <p className="font-bold text-ink">
                    📌 {isHindi ? 'अगली कार्रवाई' : 'Next Action'}:
                  </p>
                  <p className="mt-0.5">{app.next_step}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
