import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getUserProfile, updateUserProfile } from '@/services/api';

/* =============================================================
   App-wide UI state.

   This store holds preferences and view state only. It does NOT
   hold a person. Earlier versions shipped a hard-coded profile
   ("Meera Sharma, 32, Sehore, BPL Priority Household") and a
   hard-coded ASHA worker ("Radha Bai, 98261-45012") so the
   screens would look populated with nothing behind them. Every
   one of those values was invented, and the app repeated them
   back to real users as if they were their own records.

   The profile now starts empty and is filled from
   GET /api/profile, which reads the signed-in row out of
   public.profiles. An empty field renders as an empty field.
   That is the correct behaviour: we would rather show a person a
   blank they can fill than a stranger's details they have to
   notice and correct.
   ============================================================= */

const AppStateContext = createContext(null);

/* Only two languages are offered, and English is the default —
   the landing page asks before anything else. A stored value from
   an older build (Bengali, Odia, …) is folded back to English so
   nobody lands in a language the app cannot actually render. */
const LANGUAGES = ['English', 'हिन्दी'];
const DEFAULT_LANGUAGE = 'English';

/* localStorage throws in private-browsing Safari and when a
   device is out of quota. A preference failing to persist must
   never take the screen down with it. */
function readStored(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preference stays in memory for this session only. */
  }
}

function normaliseLanguage(value) {
  if (!value) return DEFAULT_LANGUAGE;
  if (LANGUAGES.includes(value)) return value;
  // 'hi' / 'Hindi' / 'hi-IN' all mean the same thing to a person.
  const lower = String(value).toLowerCase();
  if (lower.startsWith('hi') || /[ऀ-ॿ]/.test(value)) return 'हिन्दी';
  return DEFAULT_LANGUAGE;
}

/* The shape the screens read. All empty — the server fills it. */
const EMPTY_PROFILE = {
  name: '',
  phone: '',
  age: null,
  gender: '',
  state: '',
  district: '',
  village: '',
  ration_card_type: '',
  family_members: null,
  is_pregnant_or_lactating: false,
  chronic_conditions: [],
  consents: {
    voice_processing: false,
    location_access: false,
    health_guidance_disclaimer: false,
    asha_referral_consent: false,
  },
  saved_schemes: [],
};

export function AppStateProvider({ children }) {
  const [language, setLanguage] = useState(() =>
    normaliseLanguage(readStored('sehat_lang')),
  );
  const [userRole, setUserRole] = useState(
    () => readStored('sehat_role', 'citizen') || 'citizen',
  ); // 'citizen' | 'asha'

  const [userProfile, setUserProfile] = useState(EMPTY_PROFILE);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  const [savedSchemeIds, setSavedSchemeIds] = useState(() => {
    try {
      const stored = readStored('sehat_saved_schemes');
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [recentConversations, setRecentConversations] = useState([]);

  /* The last known device position, shared so that Care, the
     assistant and the SOS form all ask for it once. null means
     "not shared" and every consumer must handle that — no
     fallback coordinates, because guessing someone's location and
     then telling them their nearest hospital is worse than
     admitting we do not know where they are. */
  const [coords, setCoords] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);

  const changeLanguage = useCallback((newLang) => {
    const next = normaliseLanguage(newLang);
    setLanguage(next);
    writeStored('sehat_lang', next);
  }, []);

  const changeRole = useCallback((role) => {
    setUserRole(role);
    writeStored('sehat_role', role);
  }, []);

  const toggleSaveScheme = useCallback((schemeId) => {
    setSavedSchemeIds((prev) => {
      const updated = prev.includes(schemeId)
        ? prev.filter((id) => id !== schemeId)
        : [...prev, schemeId];
      writeStored('sehat_saved_schemes', JSON.stringify(updated));
      return updated;
    });
  }, []);

  /* Optimistic locally, authoritative on the server. If the write
     fails we surface it rather than leaving the person believing
     their details were saved. */
  const updateProfile = useCallback(async (updates) => {
    setUserProfile((prev) => ({ ...prev, ...updates }));
    setProfileError(null);
    try {
      const saved = await updateUserProfile(updates);
      if (saved && typeof saved === 'object') {
        setUserProfile((prev) => ({ ...prev, ...saved }));
      }
      return { ok: true };
    } catch (err) {
      const message = err?.message || 'Could not save your details.';
      setProfileError(message);
      return { ok: false, error: message };
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const data = await getUserProfile();
      if (data && typeof data === 'object') {
        setUserProfile((prev) => ({ ...prev, ...data }));
        if (Array.isArray(data.saved_schemes)) setSavedSchemeIds(data.saved_schemes);
        if (data.language) {
          const next = normaliseLanguage(data.language);
          setLanguage(next);
          writeStored('sehat_lang', next);
        }
      }
      setProfileError(null);
    } catch (err) {
      // Not signed in yet is the common case, not an error worth showing.
      setProfileError(err?.status === 401 ? null : err?.message || null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const value = {
    language,
    setLanguage: changeLanguage,
    userRole,
    setUserRole: changeRole,
    userProfile,
    profileLoading,
    profileError,
    updateProfile,
    refreshProfile,
    savedSchemeIds,
    toggleSaveScheme,
    recentConversations,
    setRecentConversations,
    coords,
    setCoords,
    offlineMode,
    setOfflineMode,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
