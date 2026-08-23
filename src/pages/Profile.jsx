import React, { useState } from 'react';
import { User, ShieldCheck, Save, CheckCircle2, Phone, MapPin, FileText, Heart } from 'lucide-react';
import { useAppState } from '@/state/store';
import { ConsentDialog } from '@/components/common/ConsentDialog';

export function Profile() {
  const { language, userProfile, updateProfile } = useAppState();
  const [consentOpen, setConsentOpen] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const [formData, setFormData] = useState({
    name: userProfile?.name || 'Meera Sharma',
    phone: userProfile?.phone || '98261-55443',
    age: userProfile?.age || 32,
    gender: userProfile?.gender || 'Female',
    state: userProfile?.state || 'Madhya Pradesh',
    district: userProfile?.district || 'Sehore',
    village: userProfile?.village || 'Mandi',
    ration_card_type: userProfile?.ration_card_type || 'BPL (Priority Household)',
    family_members: userProfile?.family_members || 4,
    chronic_conditions: userProfile?.chronic_conditions?.join(', ') || 'Mild Hypertension'
  });

  const handleSave = async (e) => {
    e.preventDefault();
    await updateProfile({
      ...formData,
      chronic_conditions: formData.chronic_conditions.split(',').map((s) => s.trim()).filter(Boolean)
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 pb-24 md:pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ded5c2] pb-4">
        <div>
          <span className="rounded-full bg-[#dceee9] px-3 py-1 text-xs font-bold text-[#1f655d] uppercase">
            {isHindi ? 'नागरिक स्वास्थ्य प्रोफाइल' : 'Citizen Health Profile'}
          </span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#214e4a] sm:text-4xl">
            {isHindi ? 'मेरी स्वास्थ्य प्रोफ़ाइल' : 'My Health Profile & Household'}
          </h1>
          <p className="text-xs text-[#607970]">
            {isHindi
              ? 'आपकी जानकारी केवल सटीक सरकारी योजना पात्रता और आपातकालीन स्वास्थ्य सहायता के लिए उपयोग की जाती है।'
              : 'Your verified demographics and health preferences for scheme eligibility and local clinical guidance.'}
          </p>
        </div>

        <button
          onClick={() => setConsentOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-[#dacfb9] bg-[#fbf7ec] px-4 py-2 text-xs font-bold text-[#1f655d] hover:bg-[#eee4d0]"
        >
          <ShieldCheck size={16} />
          <span>{isHindi ? 'सहमति सेटिंग्स' : 'Privacy Settings'}</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-2xl border border-[#a8dec4] bg-[#e7f5ed] p-3.5 text-xs font-bold text-[#166534] appear">
          <CheckCircle2 size={16} className="text-[#16a34a]" />
          <span>{isHindi ? 'प्रोफ़ाइल सफलतापूर्वक सुरक्षित हो गई!' : 'Health profile updated successfully!'}</span>
        </div>
      )}

      {/* Form Card */}
      <form onSubmit={handleSave} className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-6 sm:p-8 shadow-xs space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'पूरा नाम' : 'Full Name'}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'फ़ोन नंबर' : 'Phone Number'}
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'उम्र (वर्ष)' : 'Age'}
            </label>
            <input
              type="number"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: Number(e.target.value) })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'लिंग' : 'Gender'}
            </label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            >
              <option value="Female">महिला / Female</option>
              <option value="Male">पुरुष / Male</option>
              <option value="Other">अन्य / Other</option>
            </select>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'परिवार के सदस्य' : 'Family Members'}
            </label>
            <input
              type="number"
              value={formData.family_members}
              onChange={(e) => setFormData({ ...formData, family_members: Number(e.target.value) })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'राज्य' : 'State'}
            </label>
            <input
              type="text"
              value={formData.state}
              onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'जिला' : 'District'}
            </label>
            <input
              type="text"
              value={formData.district}
              onChange={(e) => setFormData({ ...formData, district: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#294f4b]">
              {isHindi ? 'गाँव' : 'Village'}
            </label>
            <input
              type="text"
              value={formData.village}
              onChange={(e) => setFormData({ ...formData, village: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#294f4b]">
            {isHindi ? 'राशन कार्ड श्रेणी' : 'Ration Card Category'}
          </label>
          <select
            value={formData.ration_card_type}
            onChange={(e) => setFormData({ ...formData, ration_card_type: e.target.value })}
            className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
          >
            <option value="BPL (Priority Household)">BPL / पात्र गृहस्थी (Priority Household)</option>
            <option value="Antyodaya (AAY)">अंत्योदय अन्न योजना (AAY - Poorest)</option>
            <option value="APL / None">सामान्य / APL / Not specified</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#294f4b]">
            {isHindi ? 'कोई पुरानी बीमारी (जैसे: बीपी, शुगर, अस्थमा)' : 'Chronic Conditions / Known Health Notes'}
          </label>
          <input
            type="text"
            value={formData.chronic_conditions}
            onChange={(e) => setFormData({ ...formData, chronic_conditions: e.target.value })}
            className="mt-1 w-full rounded-2xl border border-[#ded5c2] bg-[#fdfaf2] px-4 py-2.5 text-sm text-[#214e4a] outline-none"
          />
        </div>

        <button
          type="submit"
          className="flex items-center justify-center gap-2 rounded-full bg-[#1f655d] px-8 py-3.5 text-sm font-extrabold text-[#f9f2df] shadow-md hover:bg-[#18534c] transition"
          data-testid="btn-save-profile"
        >
          <Save size={16} />
          <span>{isHindi ? 'प्रोफ़ाइल सुरक्षित करें' : 'Save Changes'}</span>
        </button>
      </form>

      <ConsentDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        consents={userProfile?.consents}
        onSaveConsents={(newConsents) => updateProfile({ consents: newConsents })}
        language={language}
      />
    </main>
  );
}
