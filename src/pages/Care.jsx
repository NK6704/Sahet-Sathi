import React, { useState, useEffect } from 'react';
import { Search, MapPin, Stethoscope, Pill, Building2, Phone, Filter, LocateFixed, Compass, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAppState } from '@/state/store';
import { getNearbyFacilities } from '@/services/api';
import { FacilityCard } from '@/components/care/FacilityCard';

export function Care() {
  const { language, userProfile } = useAppState();
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [locationName, setLocationName] = useState(`${userProfile?.village || 'Mandi'}, ${userProfile?.district || 'Sehore'}`);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('idle'); // 'idle' | 'detected' | 'fallback' | 'denied'

  const isHindi = language === 'हिन्दी' || language === 'Hindi';

  const types = [
    { id: 'All', label: isHindi ? 'सभी केंद्र' : 'All Centres' },
    { id: 'Primary Health Centre', label: isHindi ? 'प्राथमिक स्वास्थ्य केंद्र (PHC)' : 'PHC' },
    { id: 'Community Health Centre', label: isHindi ? 'सामुदायिक केंद्र (CHC)' : 'CHC' },
    { id: 'Jan Aushadhi Kendra', label: isHindi ? 'जन औषधि केंद्र' : 'Jan Aushadhi' },
    { id: 'District Hospital', label: isHindi ? 'जिला अस्पताल' : 'District Hospital' }
  ];

  // Auto request location on load
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('fallback');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        setLocationStatus('detected');

        try {
          // Reverse geocoding via OpenStreetMap nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': isHindi ? 'hi,en' : 'en' } }
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const locality =
              addr.village || addr.suburb || addr.town || addr.city || addr.county || addr.state_district || 'Live Location';
            const state = addr.state || 'India';
            setLocationName(`${locality}, ${state}`);
          }
        } catch {
          setLocationName(`GPS: ${latitude.toFixed(2)}°N, ${longitude.toFixed(2)}°E`);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        console.warn('Geolocation denied/unavailable:', err.message);
        setLocationStatus('denied');
        setLocating(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  const fetchFacilities = async () => {
    setLoading(true);
    try {
      const data = await getNearbyFacilities({
        type: selectedType === 'All' ? undefined : selectedType,
        search: searchQuery,
        lat: userCoords?.lat,
        lng: userCoords?.lng,
        locationName: locationName
      });
      setFacilities(data.facilities || []);
    } catch (err) {
      console.warn('Facilities load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
  }, [selectedType, userCoords, locationName]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchFacilities();
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 pb-24 md:pb-12 space-y-6">
      {/* Header with GPS Status and Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ded5c2] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#dceee9] px-3 py-1 text-xs font-bold text-[#1f655d] uppercase">
              {isHindi ? 'सार्वजनिक स्वास्थ्य सुविधाएं' : 'Live Healthcare Network'}
            </span>
            {locationStatus === 'detected' && (
              <span className="flex items-center gap-1 rounded-full bg-[#d1f2d9] px-2.5 py-0.5 text-[11px] font-bold text-[#18622f]">
                <CheckCircle2 size={12} />
                <span>{isHindi ? 'लाइव GPS सक्रिय' : 'Live GPS Connected'}</span>
              </span>
            )}
          </div>

          <h1 className="mt-2 font-display text-3xl font-bold text-[#214e4a] sm:text-4xl">
            {isHindi ? 'पास के स्वास्थ्य केंद्र व जन औषधि' : 'Find Nearest Healthcare'}
          </h1>
          <p className="mt-1 text-xs text-[#607970]">
            {isHindi
              ? `आपके वर्तमान स्थान (${locationName}) के अनुसार सबसे नजदीकी सरकारी अस्पताल, पीएचसी और सस्ती जेनेरिक दवा दुकानें दूरी के क्रम में व्यवस्थित हैं।`
              : `Nearest verified hospitals, clinics, and generic pharmacies sorted by direct proximity from your current location (${locationName}).`}
          </p>
        </div>

        {/* Location Re-sync Button */}
        <button
          onClick={requestLocation}
          disabled={locating}
          className="flex items-center gap-2 rounded-2xl border border-[#cbd9cc] bg-[#fbf7ec] px-4 py-2 text-xs font-bold text-[#1f655d] hover:bg-[#eef5f1] transition active:scale-95 shadow-xs"
        >
          <Compass size={16} className={locating ? 'animate-spin text-[#e76f46]' : 'text-[#1f655d]'} />
          <div className="text-left">
            <span className="block">{locating ? (isHindi ? 'स्थान खोज रहे हैं…' : 'Locating GPS…') : (isHindi ? 'वर्तमान लोकेशन बदलें' : 'Sync Live Location')}</span>
            <span className="block text-[10px] text-[#627a72] font-normal">{locationName}</span>
          </div>
        </button>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex gap-2 rounded-2xl border border-[#ded5c2] bg-[#fbf8ef] p-2 shadow-2xs">
        <Search size={18} className="mt-2.5 ml-2 text-[#1f655d]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={isHindi ? 'अस्पताल, पीएचसी या दवा दुकान का नाम खोजें…' : 'Search by facility name, doctor, or specialty...'}
          className="flex-1 bg-transparent text-sm text-[#214e4a] placeholder-[#8ea49c] outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-[#1f655d] px-4 py-2 text-xs font-bold text-[#f9f2df]"
        >
          {isHindi ? 'खोजें' : 'Search'}
        </button>
      </form>

      {/* Type Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {types.map((type) => {
          const active = selectedType === type.id;
          return (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                active
                  ? 'bg-[#1f655d] text-[#f9f2df] shadow-xs'
                  : 'border border-[#dacfb9] bg-[#fbf7ec] text-[#47635a] hover:bg-[#eee4d0]'
              }`}
            >
              {type.label}
            </button>
          );
        })}
      </div>

      {/* Facilities Grid */}
      {loading ? (
        <div className="py-12 text-center text-xs font-bold text-[#1f655d] animate-pulse">
          {isHindi ? 'स्वास्थ्य केंद्र लोड हो रहे हैं…' : 'Finding closest facilities to your location…'}
        </div>
      ) : facilities.length === 0 ? (
        <div className="rounded-3xl border border-[#ded5c2] bg-[#fbf8ef] p-12 text-center">
          <p className="font-display text-lg font-bold text-[#214e4a]">
            {isHindi ? 'कोई केंद्र नहीं मिला' : 'No facilities found'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {facilities.map((fac) => (
            <FacilityCard key={fac.id} facility={fac} language={language} />
          ))}
        </div>
      )}
    </main>
  );
}
