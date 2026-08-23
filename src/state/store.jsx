import React, { createContext, useContext, useState, useEffect } from 'react';
import { getUserProfile, updateUserProfile } from '@/services/api';

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [language, setLanguage] = useState(() => localStorage.getItem('sehat_lang') || 'हिन्दी');
  const [userRole, setUserRole] = useState(() => localStorage.getItem('sehat_role') || 'citizen'); // 'citizen' | 'asha'
  const [userProfile, setUserProfile] = useState({
    name: 'Meera Sharma',
    phone: '98261-55443',
    age: 32,
    gender: 'Female',
    state: 'Madhya Pradesh',
    district: 'Sehore',
    village: 'Mandi',
    ration_card_type: 'BPL (Priority Household)',
    family_members: 4,
    is_pregnant_or_lactating: false,
    chronic_conditions: ['Mild Hypertension'],
    consents: {
      voice_processing: true,
      location_access: true,
      health_guidance_disclaimer: true,
      asha_referral_consent: true,
    },
    saved_schemes: ['pmjay-ayushman', 'janani-suraksha']
  });

  const [savedSchemeIds, setSavedSchemeIds] = useState(() => {
    try {
      const stored = localStorage.getItem('sehat_saved_schemes');
      return stored ? JSON.parse(stored) : ['pmjay-ayushman', 'janani-suraksha'];
    } catch {
      return ['pmjay-ayushman', 'janani-suraksha'];
    }
  });

  const [recentConversations, setRecentConversations] = useState([]);
  const [activeAsha, setActiveAsha] = useState({
    id: 'asha-sehore-12',
    name: 'Radha Bai',
    village: 'Mandi & Shyampur, Sehore',
    phone: '98261-45012',
    isLoggedIn: false
  });

  const [offlineMode, setOfflineMode] = useState(false);

  // Sync Language
  const changeLanguage = (newLang) => {
    setLanguage(newLang);
    localStorage.setItem('sehat_lang', newLang);
  };

  // Toggle Save Scheme
  const toggleSaveScheme = (schemeId) => {
    setSavedSchemeIds((prev) => {
      const updated = prev.includes(schemeId)
        ? prev.filter((id) => id !== schemeId)
        : [...prev, schemeId];
      localStorage.setItem('sehat_saved_schemes', JSON.stringify(updated));
      return updated;
    });
  };

  // Update Profile
  const updateProfile = async (updates) => {
    setUserProfile((prev) => ({ ...prev, ...updates }));
    try {
      await updateUserProfile(updates);
    } catch (err) {
      console.warn('Profile local save:', err);
    }
  };

  // Load backend profile on mount
  useEffect(() => {
    getUserProfile()
      .then((data) => {
        if (data) setUserProfile((prev) => ({ ...prev, ...data }));
      })
      .catch((err) => console.log('Profile sync notice:', err.message));
  }, []);

  const value = {
    language,
    setLanguage: changeLanguage,
    userRole,
    setUserRole: (role) => {
      setUserRole(role);
      localStorage.setItem('sehat_role', role);
    },
    userProfile,
    updateProfile,
    savedSchemeIds,
    toggleSaveScheme,
    recentConversations,
    setRecentConversations,
    activeAsha,
    setActiveAsha,
    offlineMode,
    setOfflineMode
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
