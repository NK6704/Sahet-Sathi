import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, User, MapPin, CheckCircle2, ArrowRight, FileCheck } from 'lucide-react';
import { useAppState } from '@/state/store';

export function Onboarding() {
  const { language, userProfile, updateProfile } = useAppState();
  const [, setLocation] = useLocation();

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const [formData, setFormData] = useState({
    name: userProfile?.name || 'Meera Sharma',
    phone: userProfile?.phone || '98261-55443',
    age: userProfile?.age || 32,
    gender: userProfile?.gender || 'Female',
    district: userProfile?.district || 'Sehore',
    village: userProfile?.village || 'Mandi',
    ration_card_type: userProfile?.ration_card_type || 'BPL (Priority Household)',
    is_pregnant: userProfile?.is_pregnant_or_lactating || false,
    consents: {
      voice_processing: true,
      location_access: true,
      health_guidance_disclaimer: true,
      asha_referral_consent: true,
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateProfile(formData);
    setLocation('/app');
  };

  return (
    <main className="min-h-[calc(100vh-74px)] px-4 py-8 max-w-2xl mx-auto flex items-center justify-center">
      <div className="w-full rounded-[2.5rem] border border-[#ded5c2] bg-[#fbf8ef] p-6 sm:p-8 shadow-xl appear">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#dceee9] text-[#1f655d]">
            <ShieldCheck size={26} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold text-[#214e4a] sm:text-3xl">
              {isHindi ? 'नमस्ते! आपका प्रोफ़ाइल' : 'Welcome! Health Profile'}
            </h1>
            <p className="text-xs text-[#61786f]">
              {isHindi ? 'सटीक योजना व अस्पताल की जानकारी के लिए कुछ बुनियादी बातें बताएं' : 'A few quick details to find exact schemes and nearby health centres for you'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'आपका नाम' : 'Full Name'}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'मोबाइल नंबर' : 'Phone Number'}
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'उम्र (वर्ष)' : 'Age (Years)'}
              </label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: Number(e.target.value) })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'लिंग' : 'Gender'}
              </label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              >
                <option value="Female">महिला / Female</option>
                <option value="Male">पुरुष / Male</option>
                <option value="Other">अन्य / Other</option>
              </select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'राशन कार्ड प्रकार' : 'Ration Card'}
              </label>
              <select
                value={formData.ration_card_type}
                onChange={(e) => setFormData({ ...formData, ration_card_type: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              >
                <option value="BPL (Priority Household)">BPL / पात्र गृहस्थी</option>
                <option value="Antyodaya (AAY)">अंत्योदय (AAY)</option>
                <option value="APL / None">सामान्य / APL</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'जिला' : 'District'}
              </label>
              <input
                type="text"
                value={formData.district}
                onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#294f4b]">
                {isHindi ? 'गाँव / कस्बा' : 'Village / Town'}
              </label>
              <input
                type="text"
                value={formData.village}
                onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none focus:border-[#1f655d]"
              />
            </div>
          </div>

          {/* Consents Box */}
          <div className="mt-4 rounded-2xl bg-[#f5efe2] p-4 text-xs space-y-2 border border-[#ded5c2]">
            <p className="font-bold text-[#214e4a] flex items-center gap-1.5">
              <FileCheck size={16} className="text-[#1f655d]" />
              {isHindi ? 'गोपनीयता और डेटा सुरक्षा सहमति' : 'Consent & Privacy Terms'}
            </p>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={formData.consents.voice_processing}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    consents: { ...formData.consents, voice_processing: e.target.checked }
                  })
                }
                className="rounded text-[#1f655d] focus:ring-0"
              />
              <span className="text-[#4b635b]">
                {isHindi ? 'आवाज़ पहचान और स्वास्थ्य मार्गदर्शन के उपयोग की सहमति' : 'Consent for voice processing and multilingual guidance'}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.consents.asha_referral_consent}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    consents: { ...formData.consents, asha_referral_consent: e.target.checked }
                  })
                }
                className="rounded text-[#1f655d] focus:ring-0"
              />
              <span className="text-[#4b635b]">
                {isHindi ? 'आपातकाल में आशा कार्यकर्ता व एम्बुलेंस से संपर्क की सहमति' : 'Consent for ASHA worker emergency notification'}
              </span>
            </label>
          </div>

          <button
            type="submit"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#1f655d] py-3.5 text-sm font-extrabold text-[#f9f2df] shadow-md hover:bg-[#18534c] transition"
            data-testid="btn-submit-onboarding"
          >
            <span>{isHindi ? 'आगे बढ़ें (डैशबोर्ड)' : 'Save & Continue to Dashboard'}</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </main>
  );
}
