import React, { useState } from 'react';
import { ShieldCheck, Lock, CheckCircle2, X } from 'lucide-react';

export function ConsentDialog({ open, onClose, consents, onSaveConsents, language = 'Hindi' }) {
  const [localConsents, setLocalConsents] = useState(consents || {
    voice_processing: true,
    location_access: true,
    health_guidance_disclaimer: true,
    asha_referral_consent: true,
  });

  if (!open) return null;

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const toggle = (key) => {
    setLocalConsents((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    onSaveConsents(localConsents);
    onClose();
  };

  return (
    <div
      id="dialog-user-consent"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#183b37]/45 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-[#fbf8ef] p-6 shadow-2xl appear border border-[#ded5c2]"
        onClick={(e) => e.stopPropagation()}
        data-testid="panel-consent-dialog"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#dceee9] text-[#1f655d]">
              <ShieldCheck size={24} />
            </span>
            <div>
              <h2 className="font-display text-2xl text-[#214e4a]">
                {isHindi ? 'गोपनीयता और सहमति' : 'Privacy & Consent'}
              </h2>
              <p className="text-xs text-[#788981]">
                {isHindi ? 'आपका स्वास्थ्य डेटा पूरी तरह सुरक्षित है' : 'Your health privacy is strictly protected'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#ded5c2] text-[#5d726b] hover:bg-[#eee4d0]"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-4 text-xs leading-5 text-[#5e746c]">
          {isHindi
            ? 'सेहत साथी आपकी गोपनीयता का सम्मान करता है। हम आपकी बातचीत या स्वास्थ्य रिकॉर्ड किसी तीसरे पक्ष के साथ साझा नहीं करते हैं।'
            : 'Sehat Sathi respects your privacy. Your spoken input and health preferences are used strictly to provide verified care recommendations and local assistance.'}
        </p>

        <div className="mt-5 space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#ded5c2] bg-[#f5efe2] p-3.5">
            <div>
              <p className="text-sm font-bold text-[#294f4b]">
                {isHindi ? 'आवाज़ पहचान (Voice Processing)' : 'Voice Processing (STT / TTS)'}
              </p>
              <p className="mt-0.5 text-xs text-[#788981]">
                {isHindi ? 'भारतीय भाषाओं में बोलकर पूछने की सुविधा' : 'Process speech in Indian languages for voice guidance'}
              </p>
            </div>
            <button
              onClick={() => toggle('voice_processing')}
              className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                localConsents.voice_processing ? 'bg-[#1f655d]' : 'bg-[#c7c2b4]'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-[#f9f2df] shadow-xs transition-transform ${
                  localConsents.voice_processing ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#ded5c2] bg-[#f5efe2] p-3.5">
            <div>
              <p className="text-sm font-bold text-[#294f4b]">
                {isHindi ? 'निकटतम स्वास्थ्य केंद्र हेतु स्थान (Location)' : 'Location for Nearby Healthcare'}
              </p>
              <p className="mt-0.5 text-xs text-[#788981]">
                {isHindi ? 'पास के पीएचसी, सीएचसी और जन औषधि केंद्र दिखाने हेतु' : 'Find closest PHCs, CHCs and Jan Aushadhi Kendras'}
              </p>
            </div>
            <button
              onClick={() => toggle('location_access')}
              className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                localConsents.location_access ? 'bg-[#1f655d]' : 'bg-[#c7c2b4]'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-[#f9f2df] shadow-xs transition-transform ${
                  localConsents.location_access ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-2xl border border-[#ded5c2] bg-[#f5efe2] p-3.5">
            <div>
              <p className="text-sm font-bold text-[#294f4b]">
                {isHindi ? 'आशा कार्यकर्ता अलर्ट व रेफरल (ASHA Alerts)' : 'Emergency ASHA Referral Alerts'}
              </p>
              <p className="mt-0.5 text-xs text-[#788981]">
                {isHindi ? 'आपातकाल या मातृत्व सहायता में आशा कार्यकर्ता से संपर्क' : 'Notify assigned village ASHA worker during urgent needs'}
              </p>
            </div>
            <button
              onClick={() => toggle('asha_referral_consent')}
              className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                localConsents.asha_referral_consent ? 'bg-[#1f655d]' : 'bg-[#c7c2b4]'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-[#f9f2df] shadow-xs transition-transform ${
                  localConsents.asha_referral_consent ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-full border border-[#dacfb9] px-4 py-2 text-xs font-bold text-[#5c726a] hover:bg-[#eee4d0]"
          >
            {isHindi ? 'रद्द करें' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-full bg-[#1f655d] px-5 py-2 text-xs font-bold text-[#f9f2df] shadow-sm hover:bg-[#18534c]"
          >
            <CheckCircle2 size={15} />
            {isHindi ? 'सहमति सुरक्षित करें' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
