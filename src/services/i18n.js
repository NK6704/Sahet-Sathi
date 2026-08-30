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
    // App & Nav
    appName: "Sehat Sathi",
    tagline: "Rural Health & Scheme Companion",
    roleCitizen: "Citizen / Family",
    roleAsha: "ASHA Health Worker",
    home: "Home",
    aiVoice: "AI Voice",
    schemes: "Health Schemes",
    findCare: "Find Care",
    imageAssist: "Prescription OCR",
    ashaPortal: "ASHA Portal",
    profile: "My Profile",
    benefits: "Benefit Tracker",
    settings: "Settings",
    privacy: "Privacy",
    emergency108: "Emergency 108",
    emergencySOS: "108 / 112 Emergency Help",
    languageLabel: "Language",

    // Voice Assistant Page & Widget
    assistantTitle: "Voice Health Assistant",
    assistantSubtitle: "Continuous Hands-Free Dialogue • Instant Live Scheme Grounding • Nearest Healthcare",
    voiceChatTab: "Voice Assistant",
    streamChatTab: "Chat Stream",
    tapToSpeak: "Tap to Speak",
    listening: "Listening… please speak now",
    listeningIdlePrompt: "Tap the mic to ask about symptoms, schemes, or hospitals",
    youSaid: "You said",
    thinking: "Thinking… finding verified health guidance",
    sehatSathiReply: "Sehat Sathi AI Guidance",
    emergencyAlert: "Emergency Alert",
    listenVoice: "Listen",
    stopVoice: "Stop",
    retry: "Retry",
    getGuidance: "Get Guidance",
    clearChat: "Clear Chat",
    newQuestion: "New Question",
    faqSuggestions: "Or tap a frequently asked question:",
    typePlaceholder: "Type your health symptom or scheme question here...",
    send: "Send",
    locationActive: "Location active",
    locationDenied: "Location denied. Using default area.",
    locatingGps: "Locating GPS…",
    relatedSchemesTitle: "Applicable Government Schemes:",
    viewScheme: "View Scheme",
    findNearbyCare: "Find Nearby Care",
    connectAsha: "Connect with ASHA",
    verifiedSource: "Verified Official Source",

    // Prescription & OPD Scanner
    scannerTitle: "Prescription & OPD Slip AI Analyzer",
    scannerSubtitle: "Upload doctor prescription or lab order slip — AI will decode medicines, tests & schemes",
    uploadBoxTitle: "Tap to capture or upload prescription photo",
    uploadBoxSubtitle: "Supports JPG, PNG, WEBP (Clear light gives best AI reading)",
    changePhoto: "Choose another photo",
    analyzeButton: "Decode Prescription & Medical Tests",
    analyzingState: "Analyzing Medical Slip with Gemini AI...",
    onlyImageError: "Please upload a valid image file (JPG, PNG)",
    analysisFailed: "Analysis encountered a connection issue. Please try again.",
    confidence: "Confidence",
    doctor: "Doctor",
    hospital: "Hospital",
    patient: "Patient",
    date: "Date",
    doctorSummaryTitle: "Doctor Assessment & Clinical Summary:",
    prescribedTestsTitle: "Prescribed Diagnostic Tests & Lab Orders:",
    testsCount: "Tests",
    testPurpose: "Purpose:",
    testPreparation: "Preparation:",
    testAvailability: "Availability:",
    prescribedMedicinesTitle: "Prescribed Medicines & Jan Aushadhi Generic:",
    medicinesCount: "Medicines",
    genericJanAushadhi: "Jan Aushadhi Generic Equivalent:",
    dosage: "Dosage:",
    purpose: "Purpose:",
    unclear: "Unclear",
    nextStepsTitle: "Recommended Next Steps for Patient:",
    precautionsTitle: "Precautions & Lifestyle Care:",
    schemeGuidanceTitle: "Government Scheme Guidance:",
    safetyWarningDefault: "AI-assisted reading. Always confirm with your doctor or pharmacist before taking medicines.",

    // General Disclaimer
    disclaimer: "Sehat Sathi provides guidance and verified scheme information. It is not a substitute for clinical medical diagnosis."
  },

  'हिन्दी': {
    // App & Nav
    appName: "सेहत साथी",
    tagline: "ग्रामीण स्वास्थ्य और सरकारी योजना साथी",
    roleCitizen: "नागरिक / परिवार",
    roleAsha: "आशा स्वास्थ्य कार्यकर्ता",
    home: "होम",
    aiVoice: "आवाज़ साथी",
    schemes: "स्वास्थ्य योजनाएं",
    findCare: "पास का इलाज",
    imageAssist: "पर्ची / दवा जाँच",
    ashaPortal: "आशा पोर्टल",
    profile: "मेरी प्रोफ़ाइल",
    benefits: "योजना लाभ ट्रैकर",
    settings: "सेटिंग्स",
    privacy: "सहमति",
    emergency108: "आपातकालीन 108",
    emergencySOS: "108 / 112 आपातकालीन मदद",
    languageLabel: "भाषा",

    // Voice Assistant Page & Widget
    assistantTitle: "बोलकर पूछें (आवाज़ साथी)",
    assistantSubtitle: "लगातार बातचीत मोड • एक बार दबाएं और बिना रुके सवाल पूछते रहें • सरकारी योजनाओं की पूरी जानकारी",
    voiceChatTab: "बोलकर पूछें",
    streamChatTab: "विस्तृत चैट",
    tapToSpeak: "माइक दबाकर बोलें",
    listening: "हम सुन रहे हैं… बोलें",
    listeningIdlePrompt: "माइक दबाकर बीमारी के लक्षण, सरकारी योजना या अस्पताल के बारे में पूछें",
    youSaid: "आपने कहा",
    thinking: "सेहत साथी उत्तर तैयार कर रहा है…",
    sehatSathiReply: "सेहत साथी AI सलाह",
    emergencyAlert: "आपातकालीन अलर्ट",
    listenVoice: "सुनें",
    stopVoice: "रोकें",
    retry: "फिर से बोलें",
    getGuidance: "सलाह लें",
    clearChat: "नया सवाल",
    newQuestion: "नया सवाल",
    faqSuggestions: "या इनमें से कोई सवाल चुनें:",
    typePlaceholder: "अपना सवाल यहाँ टाइप करें…",
    send: "भेजें",
    locationActive: "स्थान सक्रिय",
    locationDenied: "स्थान अनुपलब्ध। डिफ़ॉल्ट क्षेत्र का उपयोग किया गया।",
    locatingGps: "स्थान खोज रहे हैं…",
    relatedSchemesTitle: "संबंधित सरकारी स्वास्थ्य योजनाएं (लाभ):",
    viewScheme: "योजना देखें",
    findNearbyCare: "पास का स्वास्थ्य केंद्र",
    connectAsha: "आशा कार्यकर्ता से पूछें",
    verifiedSource: "सत्यापित सरकारी स्रोत",

    // Prescription & OPD Scanner
    scannerTitle: "पर्ची / ओपीडी व जाँच पत्र फोटो स्कैनर",
    scannerSubtitle: "डॉक्टर पर्ची या जाँच पर्चे का फोटो खींचें — AI दवा, टेस्ट व सरकारी योजना बताएगा",
    uploadBoxTitle: "दवा पर्ची या ओपीडी जाँच पर्चे का फोटो लें",
    uploadBoxSubtitle: "JPG, PNG, WEBP समर्थित (साफ़ रोशनी में सबसे सटीक AI परिणाम मिलते हैं)",
    changePhoto: "बदलने के लिए दूसरा फोटो चुनें",
    analyzeButton: "पर्ची व सभी जांचें समझें",
    analyzingState: "AI पर्ची की पूरी जाँच कर रहा है…",
    onlyImageError: "कृपया केवल फोटो (JPG, PNG) अपलोड करें",
    analysisFailed: "विश्लेषण में समय लगा या नेटवर्क समस्या है। कृपया पुनः प्रयास करें।",
    confidence: "सटीकता",
    doctor: "डॉक्टर",
    hospital: "अस्पताल",
    patient: "मरीज",
    date: "दिनांक",
    doctorSummaryTitle: "डॉक्टर का प्राथमिक परामर्श / समस्या विवरण:",
    prescribedTestsTitle: "डॉक्टर द्वारा लिखी गई आवश्यक जांचें (Investigations):",
    testsCount: "जांचें",
    testPurpose: "जांच का कारण:",
    testPreparation: "तैयारी:",
    testAvailability: "सरकारी सुविधा:",
    prescribedMedicinesTitle: "दवाइयाँ व जन औषधि विकल्प:",
    medicinesCount: "दवाएं",
    genericJanAushadhi: "सस्ती जन औषधि जेनेरिक:",
    dosage: "खुराक:",
    purpose: "फायदा:",
    unclear: "अस्पष्ट",
    nextStepsTitle: "मरीज को अब क्या कदम उठाने चाहिए (Next Steps):",
    precautionsTitle: "सावधानियां एवं खान-पान सलाह:",
    schemeGuidanceTitle: "सरकारी योजना सहायता:",
    safetyWarningDefault: "AI-सहायक विश्लेषण। दवा लेने या इलाज शुरू करने से पहले हमेशा डॉक्टर या फार्मासिस्ट से सलाह लें।",

    // General Disclaimer
    disclaimer: "सेहत साथी प्राथमिक सलाह और सत्यापित सरकारी जानकारी देता है। यह डॉक्टर के व्यक्तिगत इलाज का विकल्प नहीं है।"
  }
};

/**
 * Is this language Hindi?
 *
 * Two things were wrong here and both changed the language of the whole
 * app. First, an absent language returned true, so every screen rendered
 * in Hindi until a preference had been saved — the opposite of the
 * requirement, which is that English is the default and Hindi is chosen.
 * Second, the test was `lower.includes('hi')`, which is true of
 * "Marathi": a Marathi speaker was shown Hindi. The check is now against
 * the identifiers Hindi actually arrives as.
 */
export function isHindiLang(language) {
  if (!language) return false;
  const value = String(language).trim().toLowerCase();
  return value === 'hi' || value === 'hin' || value === 'hindi' || value === 'हिन्दी';
}

/**
 * Translations for one language, in the two shapes this codebase uses.
 *
 * `getT` returns something that is both callable and indexable:
 *
 *   const t = getT(language);
 *   t.findCare                       // dictionary key, for shared chrome
 *   t('Find care', 'देखभाल खोजें')   // inline pair, for page-local copy
 *
 * Both existed already — the older screens read keys off the dictionary
 * while the newer ones passed English/Hindi pairs inline — and a single
 * return value could not serve both, so half the app was calling `t` as
 * a function it was not. Rather than convert one style to the other
 * across sixty files, the returned object answers to both.
 *
 * A dictionary of 76 keys cannot be attached with Object.assign, because
 * the target is a function and `name` and `length` are read-only on
 * functions: the day somebody adds a `name:` entry to TRANSLATIONS that
 * would throw in strict mode. defineProperty avoids that entirely.
 *
 * `t(en, hi)` falls back to English when a Hindi string is missing,
 * because an untranslated sentence is a smaller failure than a blank one.
 */
export function getT(language) {
  const hindi = isHindiLang(language);
  const dict = hindi ? TRANSLATIONS['हिन्दी'] : TRANSLATIONS['English'];

  const t = (en, hi) => (hindi ? (hi ?? en) : en);

  for (const key of Object.keys(dict)) {
    Object.defineProperty(t, key, {
      value: dict[key],
      enumerable: true,
      writable: false,
      configurable: true,
    });
  }

  Object.defineProperty(t, 'isHindi', { value: hindi, enumerable: false });
  Object.defineProperty(t, 'lang', { value: hindi ? 'hi' : 'en', enumerable: false });

  return t;
}
