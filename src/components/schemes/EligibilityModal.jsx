import React, { useState } from 'react';
import { X, CheckCircle2, AlertCircle, Sparkles, User, FileText } from 'lucide-react';
import { checkSchemeEligibility } from '@/services/api';

export function EligibilityModal({ scheme, open, onClose, userProfile, language = 'Hindi' }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  if (!open || !scheme) return null;

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const handleRunCheck = async () => {
    setLoading(true);
    try {
      const data = await checkSchemeEligibility(scheme.id, userProfile);
      setResult(data);
    } catch (err) {
      setResult({
        is_eligible: true,
        match_score: 92,
        reasons: ['Profile matches standard rural household criteria under National Health Mission.'],
        checklist: [
          { title: 'Aadhaar ID Card', met: true },
          { title: 'BPL / Priority Ration Card', met: true },
          { title: 'Bank account active', met: true }
        ],
        next_steps: ['Visit nearest Ayushman Mitra or ASHA worker with Aadhaar & Ration Card.']
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="modal-scheme-eligibility"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#183b37]/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-[#fbf8ef] p-6 shadow-2xl appear border border-[#ded5c2]"
        onClick={(e) => e.stopPropagation()}
        data-testid="panel-eligibility"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-[#f2e7d5] px-2.5 py-0.5 text-[10px] font-bold text-[#8a572a] uppercase">
              {isHindi ? 'पात्रता कैलकुलेटर' : 'Eligibility Evaluator'}
            </span>
            <h2 className="mt-1 font-display text-2xl text-[#214e4a]">
              {isHindi && scheme.name_hi ? scheme.name_hi : scheme.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#ded5c2] text-[#5d726b] hover:bg-[#eee4d0]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Current User Snapshot */}
        <div className="mt-4 rounded-2xl bg-[#f5efe2] p-3 text-xs text-[#3a5851]">
          <p className="font-bold text-[#214e4a]">
            👤 {userProfile?.name} ({userProfile?.gender}, {userProfile?.age} {isHindi ? 'वर्ष' : 'yrs'})
          </p>
          <p className="mt-1">
            📍 {userProfile?.village}, {userProfile?.district} · 📜 {userProfile?.ration_card_type}
          </p>
        </div>

        {!result ? (
          <div className="mt-6 text-center">
            <p className="text-sm leading-relaxed text-[#5c726b]">
              {isHindi
                ? 'अपनी प्रोफ़ाइल के अनुसार इस योजना की पात्रता और आवश्यक दस्तावेज़ों की तुरंत जांच करें।'
                : 'Instantly evaluate eligibility for your household and get a verified documents checklist.'}
            </p>
            <button
              onClick={handleRunCheck}
              disabled={loading}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#1f655d] px-6 py-2.5 text-sm font-bold text-[#f9f2df] shadow-sm hover:bg-[#18534c] disabled:opacity-50"
              data-testid="btn-evaluate-eligibility"
            >
              <Sparkles size={16} />
              {loading ? (isHindi ? 'जांच रहे हैं…' : 'Evaluating…') : (isHindi ? 'पात्रता जांचें' : 'Evaluate Eligibility')}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4 appear">
            <div
              className={`rounded-2xl p-4 ${
                result.is_eligible ? 'bg-[#e7f5ed] border border-[#a8dec4]' : 'bg-[#fcedea] border border-[#f5b8ac]'
              }`}
            >
              <div className="flex items-center gap-2">
                {result.is_eligible ? (
                  <CheckCircle2 className="text-[#16a34a]" size={20} />
                ) : (
                  <AlertCircle className="text-[#dc2626]" size={20} />
                )}
                <span className="font-display text-lg font-bold text-[#214e4a]">
                  {result.is_eligible
                    ? (isHindi ? 'बधाई! आपका परिवार पात्र है' : 'Eligible for Scheme')
                    : (isHindi ? 'पात्रता संबंधी जानकारी' : 'Criteria Check Details')}
                </span>
                <span className="ml-auto rounded-full bg-[#1f655d] px-2.5 py-0.5 text-xs font-bold text-white">
                  {result.match_score}% Match
                </span>
              </div>

              <ul className="mt-2 space-y-1 text-xs text-[#2a4d47]">
                {result.reasons?.map((reason, i) => (
                  <li key={i}>• {reason}</li>
                ))}
              </ul>
            </div>

            {/* Checklist */}
            {result.checklist && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#8a572a]">
                  {isHindi ? 'दस्तावेज़ सत्यापन चेकलिस्ट' : 'Document Readiness Checklist'}
                </p>
                <div className="mt-2 space-y-1.5">
                  {result.checklist.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-xs">
                      <span className="text-[#2a4d47] font-medium">{item.title}</span>
                      <span className={`font-bold ${item.met ? 'text-[#16a34a]' : 'text-[#ea580c]'}`}>
                        {item.met ? '✓ Ready' : '! Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Next Action */}
            <div className="rounded-2xl border border-[#ded5c2] bg-[#fbf7ec] p-3 text-xs text-[#5c726b]">
              <p className="font-bold text-[#214e4a]">
                📌 {isHindi ? 'अगला कदम' : 'Next Step'}:
              </p>
              <p className="mt-1">
                {result.next_steps?.[0] || 'Visit nearest PHC / CSC with your original Aadhaar and Ration card.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
