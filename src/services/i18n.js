// Multilingual Dictionary & Translation Helper for Sehat Sathi

export const SUPPORTED_LANGUAGES = [
  { code: 'hi', name: 'हिन्दी', label: 'Hindi', script: 'नमस्ते' },
  { code: 'en', name: 'English', label: 'English', script: 'Hello' },
  { code: 'bn', name: 'বাংলা', label: 'Bengali', script: 'নমস্কার' },
  { code: 'mr', name: 'मराठी', label: 'Marathi', script: 'नमस्कार' },
  { code: 'te', name: 'తెలుగు', label: 'Telugu', script: 'నమస్కారం' },
  { code: 'ta', name: 'தமிழ்', label: 'Tamil', script: 'வணக்கம்' },
  { code: 'gu', name: 'ગુજરાતી', label: 'Gujarati', script: 'નમસ્તે' },
  { code: 'kn', name: 'ಕನ್ನಡ', label: 'Kannada', script: 'ನಮಸ್ಕಾರ' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', label: 'Punjabi', script: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ' },
  { code: 'or', name: 'ଓଡ଼ିଆ', label: 'Odia', script: 'ନମସ୍କାର' }
];

export const TRANSLATIONS = {
  English: {
    appName: "Sehat Sathi",
    tagline: "Your Health & Scheme Companion",
    roleCitizen: "Citizen / Family",
    roleAsha: "ASHA Health Worker",
    tapToSpeak: "Tap microphone to speak",
    listening: "Listening carefully...",
    emergencySOS: "108 / 112 Emergency",
    askAnything: "Ask about symptoms, child health, maternal care, or free hospital schemes",
    healthGuidance: "Health Guidance",
    schemes: "Government Schemes",
    findCare: "Find Nearby Care",
    profile: "Health Profile",
    ashaPortal: "ASHA Portal",
    imageAssist: "Prescription / Image Assist",
    benefits: "Benefit Tracker",
    settings: "Settings",
    disclaimer: "Sehat Sathi provides guidance and verified scheme information. It is not a substitute for clinical medical diagnosis.",
    verifiedGovSource: "Verified Official Government Source",
    liveSearchBadge: "Live Gov Search Grounded",
    eligibilityCheck: "Check Eligibility",
    callAmbulance: "Call Ambulance (108)",
    callEmergency: "Call All Emergencies (112)",
    nearbyFacilities: "Nearby Health Centres & Kendras",
    saveScheme: "Save Scheme",
    saved: "Saved",
    viewDetails: "View Details",
    applyNow: "How to Apply",
    documentsNeeded: "Required Documents",
    coverageAmount: "Financial Coverage",
    speakResponse: "Listen in Voice",
    stopAudio: "Stop Voice",
    typeQuestion: "Or type your question here...",
    send: "Send"
  },
  'हिन्दी': {
    appName: "सेहत साथी",
    tagline: "आपका स्वास्थ्य और सरकारी योजना साथी",
    roleCitizen: "नागरिक / परिवार",
    roleAsha: "आशा स्वास्थ्य कार्यकर्ता",
    tapToSpeak: "बोलने के लिए माइक दबाएँ",
    listening: "हम सुन रहे हैं...",
    emergencySOS: "108 / 112 आपातकालीन मदद",
    askAnything: "बुखार, बच्चों की देखभाल, गर्भवती माँ या मुफ्त इलाज योजनाओं के बारे में पूछें",
    healthGuidance: "स्वास्थ्य सलाह",
    schemes: "सरकारी स्वास्थ्य योजनाएँ",
    findCare: "पास का स्वास्थ्य केंद्र",
    profile: "मेरी प्रोफ़ाइल",
    ashaPortal: "आशा कार्यकर्ता पोर्टल",
    imageAssist: "पर्ची / दवा फोटो जाँच",
    benefits: "योजना लाभ ट्रैकर",
    settings: "सेटिंग्स",
    disclaimer: "सेहत साथी प्राथमिक सलाह और सत्यापित सरकारी जानकारी देता है। यह डॉक्टर के व्यक्तिगत इलाज का विकल्प नहीं है।",
    verifiedGovSource: "सत्यापित सरकारी स्रोत",
    liveSearchBadge: "लाइव सरकारी पोर्टल सत्यापित",
    eligibilityCheck: "पात्रता जाँचें",
    callAmbulance: "एम्बुलेंस को कॉल करें (108)",
    callEmergency: "आपातकालीन नंबर (112)",
    nearbyFacilities: "नजदीकी अस्पताल व जन औषधि केंद्र",
    saveScheme: "योजना सुरक्षित करें",
    saved: "सुरक्षित है",
    viewDetails: "विस्तार से देखें",
    applyNow: "आवेदन कैसे करें",
    documentsNeeded: "ज़रूरी दस्तावेज़",
    coverageAmount: "मुफ्त इलाज सहायता राशि",
    speakResponse: "आवाज़ में सुनें",
    stopAudio: "आवाज़ रोकें",
    typeQuestion: "या यहाँ अपना सवाल लिखें...",
    send: "भेजें"
  }
};

export function getT(language) {
  if (language === 'हिन्दी' || language === 'Hindi') {
    return TRANSLATIONS['हिन्दी'];
  }
  return TRANSLATIONS['English'];
}
