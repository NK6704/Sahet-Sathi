// Sehat Sathi Centralized API Client Layer

const BASE_URL = '/api';

function normalizeScheme(rawScheme = {}) {
  const applicationSteps = Array.isArray(rawScheme.application_process)
    ? rawScheme.application_process
    : rawScheme.application_process?.steps || [];

  return {
    ...rawScheme,
    documents_required: rawScheme.documents_required || rawScheme.required_documents || [],
    application_process: {
      steps: applicationSteps,
    },
    official_portal: rawScheme.official_portal || rawScheme.source_url || '',
  };
}

function normalizeBenefitsTracker(rawData = {}) {
  const trackedSchemes = rawData.active_applications || rawData.tracked_schemes || [];

  return {
    ...rawData,
    active_applications: trackedSchemes.map((scheme) => ({
      id: scheme.id || scheme.card_number || scheme.rch_id || `scheme-${scheme.name}`,
      scheme_name: scheme.scheme_name || scheme.name || 'Government Scheme',
      beneficiary: rawData.beneficiary_name || 'Beneficiary',
      amount: scheme.amount || scheme.coverage_balance || scheme.disbursement_status || 'Status unavailable',
      status: scheme.status || 'In Progress',
      last_updated: scheme.last_updated || scheme.issued_date || 'Not available',
      next_step: scheme.next_step || scheme.last_claim || 'Visit the nearest PHC/CSC for the latest update.',
      milestones: scheme.milestones || [
        {
          title: scheme.issued_date ? 'Issued' : 'Registered',
          completed: true,
          date: scheme.issued_date || null,
        },
        {
          title: 'Current Status',
          completed: Boolean(scheme.status),
          date: scheme.status || null,
        },
      ],
    })),
  };
}

function normalizeAshaDashboard(rawData = {}) {
  const ashaProfile = rawData.asha_profile || {};
  const statistics = rawData.stats || rawData.statistics || {};

  return {
    ...rawData,
    stats: {
      assigned_families:
        statistics.assigned_families || ashaProfile.registered_households || 0,
      active_emergency_alerts:
        statistics.active_emergency_alerts || statistics.pending_triages || rawData.alerts?.length || 0,
      pregnant_women_tracked:
        statistics.pregnant_women_tracked || ashaProfile.active_maternal_cases || 0,
      infant_immunization_due:
        statistics.infant_immunization_due || ashaProfile.infants_due_immunization || 0,
    },
    emergency_alerts: rawData.emergency_alerts || rawData.alerts || [],
    maternal_cases: rawData.maternal_cases || [],
  };
}

export async function sendMessageToAssistant({ message, language, userProfile, location, conversationHistory }) {
  try {
    const res = await fetch(`${BASE_URL}/assistant/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, language, userProfile, location, conversationHistory }),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Assistant API fallback triggered:', err);
    // Client-side fallback if server offline
    const isHindi = language?.includes('हिन्दी') || language?.includes('Hindi');
    return {
      intent: 'health_guidance',
      language: isHindi ? 'Hindi' : 'English',
      urgency: 'normal',
      response: isHindi
        ? 'प्राथमिक सलाह: पर्याप्त आराम करें और उबला गुनगुना पानी पिएं। यदि बुखार 2 दिन से अधिक रहे तो तुरंत स्वास्थ्य केंद्र जाएं।'
        : 'Primary advice: Rest well and drink boiled warm water. If symptoms persist for more than 2 days, visit the nearest Primary Health Centre.',
      actions: [
        { type: 'find_care', label: isHindi ? 'स्वास्थ्य केंद्र देखें' : 'Find Healthcare', link: '/care' },
        { type: 'open_scheme', label: isHindi ? 'योजनाएं देखें' : 'View Schemes', link: '/schemes' }
      ],
      source_type: 'curated',
      sources: ['National Health Mission Care Protocols'],
      confidence: 0.9
    };
  }
}

export async function getCuratedSchemes({ category, search } = {}) {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (search) params.append('search', search);

  const res = await fetch(`${BASE_URL}/schemes?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch schemes');
  const data = await res.json();
  return {
    ...data,
    schemes: (data.schemes || []).map(normalizeScheme),
  };
}

export async function getSchemeById(id) {
  const res = await fetch(`${BASE_URL}/schemes/${id}`);
  if (!res.ok) throw new Error('Scheme not found');
  const data = await res.json();
  return normalizeScheme(data);
}

export async function searchLiveSchemes(query, language = 'English') {
  const res = await fetch(`${BASE_URL}/schemes/search-live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, language }),
  });
  if (!res.ok) throw new Error('Live search failed');
  const data = await res.json();
  return {
    ...data,
    results: (data.results || []).map(normalizeScheme),
  };
}

export async function checkSchemeEligibility(schemeId, profile) {
  const res = await fetch(`${BASE_URL}/schemes/eligibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemeId, profile }),
  });
  if (!res.ok) throw new Error('Eligibility check failed');
  return await res.json();
}

export async function getNearbyFacilities({ type, search, lat, lng, locationName } = {}) {
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  if (search) params.append('search', search);
  if (lat !== undefined && lat !== null) params.append('lat', String(lat));
  if (lng !== undefined && lng !== null) params.append('lng', String(lng));
  if (locationName) params.append('locationName', locationName);

  const res = await fetch(`${BASE_URL}/facilities/nearby?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch facilities');
  return await res.json();
}

export async function analyzePrescriptionImage(imageBase64, mimeType, notes, language) {
  const res = await fetch(`${BASE_URL}/image/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, notes, language }),
  });
  if (!res.ok) throw new Error('Image analysis failed');
  return await res.json();
}

export async function getUserProfile() {
  const res = await fetch(`${BASE_URL}/profile`);
  if (!res.ok) throw new Error('Failed to load profile');
  return await res.json();
}

export async function updateUserProfile(data) {
  const res = await fetch(`${BASE_URL}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return await res.json();
}

export async function triggerEmergencyEvent(payload) {
  const res = await fetch(`${BASE_URL}/emergency/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to send emergency event');
  return await res.json();
}

export async function getAshaDashboardData() {
  const res = await fetch(`${BASE_URL}/asha/dashboard`);
  if (!res.ok) throw new Error('Failed to fetch ASHA data');
  const data = await res.json();
  return normalizeAshaDashboard(data);
}

export async function updateAshaReferral(id, { status, notes }) {
  const res = await fetch(`${BASE_URL}/asha/referral/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, notes }),
  });
  if (!res.ok) throw new Error('Failed to update referral');
  return await res.json();
}

export async function getBenefitTrackerData() {
  const res = await fetch(`${BASE_URL}/benefits/tracker`);
  if (!res.ok) throw new Error('Failed to fetch benefits data');
  const data = await res.json();
  return normalizeBenefitsTracker(data);
}
