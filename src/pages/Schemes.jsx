import React, { useEffect, useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { useAppState } from '@/state/store';
import { getCuratedSchemes, searchLiveSchemes } from '@/services/api';
import { SchemeCard } from '@/components/schemes/SchemeCard';
import { EligibilityModal } from '@/components/schemes/EligibilityModal';

export function Schemes() {
  const { language, savedSchemeIds, toggleSaveScheme, userProfile } = useAppState();
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [liveSearching, setLiveSearching] = useState(false);
  const [selectedSchemeForEligibility, setSelectedSchemeForEligibility] = useState(null);

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const categories = [
    { id: 'All', label: isHindi ? 'सभी योजनाएँ' : 'All Schemes' },
    { id: 'General', label: isHindi ? 'सामान्य इलाज व बीमा' : 'General Care' },
    { id: 'Maternal & Child', label: isHindi ? 'मातृत्व व शिशु' : 'Maternal & Child' },
    { id: 'Medicines', label: isHindi ? 'सस्ती दवाइयाँ' : 'Medicines' },
    { id: 'Elderly & Chronic', label: isHindi ? 'वृद्धजन व दीर्घकालिक रोग' : 'Elderly & Chronic' },
  ];

  const fetchSchemes = async () => {
    setLoading(true);
    try {
      const data = await getCuratedSchemes({
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        search: searchQuery,
      });
      setSchemes(data.schemes || []);
    } catch (err) {
      console.warn('Schemes load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchemes();
  }, [selectedCategory]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchSchemes();
  };

  const handleLiveGovSearch = async () => {
    if (!searchQuery.trim()) return;
    setLiveSearching(true);
    try {
      const liveRes = await searchLiveSchemes(searchQuery, language);
      if (liveRes.results && liveRes.results.length > 0) {
        setSchemes((prev) => [...liveRes.results, ...prev]);
      }
    } catch (err) {
      console.warn('Live search notice:', err);
    } finally {
      setLiveSearching(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-24 md:pb-12 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ded5c2] pb-4">
        <div>
          <span className="rounded-full bg-[#f2e7d5] px-3 py-1 text-xs font-bold text-[#8a572a] uppercase">
            {isHindi ? 'राष्ट्रीय स्वास्थ्य योजनाएँ' : 'National Health Mission Directory'}
          </span>
          <h1 className="mt-2 font-display text-3xl font-bold text-[#214e4a] sm:text-4xl">
            {isHindi ? 'सरकारी स्वास्थ्य योजनाएँ व लाभ' : 'Government Health Schemes'}
          </h1>
          <p className="text-xs text-[#607970]">
            {isHindi
              ? 'आयुष्मान भारत, जननी सुरक्षा, जन औषधि केंद्र सहित सरकार की सभी प्रमुख स्वास्थ्य योजनाओं की सत्यापित जानकारी।'
              : 'Verified benefits, eligibility requirements, and application procedures for Central & State public health schemes.'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <form onSubmit={handleSearch} className="flex flex-1 items-center gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] px-4 py-2 shadow-2xs">
          <Search size={18} className="text-[#1f655d]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isHindi ? 'योजना का नाम या बीमारी खोजें (जैसे: आयुष्मान, प्रसव, टीबी)...' : 'Search schemes by name or condition (e.g., Ayushman, Delivery, TB)...'}
            className="flex-1 bg-transparent text-xs text-[#214e4a] outline-none placeholder:text-[#8ea49c] sm:text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-[#1f655d] px-3 py-1.5 text-xs font-bold text-[#f9f2df]"
          >
            {isHindi ? 'खोजें' : 'Search'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLiveGovSearch}
          disabled={liveSearching || !searchQuery.trim()}
          className="flex items-center justify-center gap-2 rounded-2xl border border-[#cbd9cc] bg-[#eef5f1] px-4 py-2 text-xs font-bold text-[#1f655d] transition hover:bg-[#dceee9] disabled:opacity-50"
          title="Search live verified government portals"
        >
          <Globe size={15} className="text-[#2563eb]" />
          <span>
            {liveSearching
              ? isHindi
                ? 'खोज रहे हैं...'
                : 'Searching live...'
              : isHindi
                ? 'लाइव सरकारी पोर्टल खोज'
                : 'Live Gov Search'}
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                active
                  ? 'bg-[#1f655d] text-[#f9f2df] shadow-xs'
                  : 'border border-[#dacfb9] bg-[#fbf7ec] text-[#47635a] hover:bg-[#eee4d0]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs font-bold text-[#1f655d] animate-pulse">
          {isHindi ? 'योजनाएँ लोड हो रही हैं...' : 'Loading health schemes...'}
        </div>
      ) : schemes.length === 0 ? (
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-12 text-center">
          <p className="font-display text-lg font-bold text-[#214e4a]">
            {isHindi ? 'कोई योजना नहीं मिली' : 'No matching schemes found'}
          </p>
          <p className="mt-1 text-xs text-[#637c73]">
            {isHindi ? 'कृपया दूसरे शब्दों से खोजें या सभी योजनाएँ देखें।' : 'Try different keywords or explore all categories.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schemes.map((scheme) => (
            <SchemeCard
              key={scheme.id}
              scheme={scheme}
              isSaved={savedSchemeIds.includes(scheme.id)}
              onToggleSave={toggleSaveScheme}
              onCheckEligibility={(s) => setSelectedSchemeForEligibility(s)}
              language={language}
            />
          ))}
        </div>
      )}

      <EligibilityModal
        scheme={selectedSchemeForEligibility}
        open={Boolean(selectedSchemeForEligibility)}
        onClose={() => setSelectedSchemeForEligibility(null)}
        userProfile={userProfile}
        language={language}
      />
    </main>
  );
}
