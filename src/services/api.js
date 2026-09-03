import { getAccessToken } from '@/lib/supabase';

/* =============================================================
   The one HTTP layer for the whole app.

   Everything that leaves the browser for our own server goes
   through `request()` below. That is the point of this file: there
   is exactly one place that knows how a body is encoded, how the
   session token is attached, and what a failure looks like.

   Three things this file is careful about, each because of a real
   failure it caused before:

   1. THE TOKEN IS READ, NOT HELD. `getAccessToken()` in
      @/lib/supabase asks the Supabase client for the current
      session at call time. There is no React state here and no
      cached token, so a call made a second after a refresh uses
      the refreshed token rather than a stale copy.

   2. A FAILURE CARRIES ITS STATUS. Callers branch on it — the
      profile store treats 401 as "not signed in yet" rather than
      an error worth showing a person, and it can only do that
      because `err.status` exists.

   3. A NON-JSON BODY IS NAMED AS SUCH. In dev, a request to a path
      the server does not route falls through to Vite, which
      answers with index.html. `JSON.parse` on that throws
      "Unexpected token '<'", which tells nobody anything. Here it
      throws "the server has no endpoint at …" instead.

   Retired endpoints answer 410 with a `replacement` path. That
   field is carried onto the error so a caller — or a developer
   reading the console — is told where the route moved to rather
   than just that it is gone.
   ============================================================= */

const BASE_URL = '/api';

/** Absolute-URL guard: everything here is same-origin by design. */
function urlFor(path) {
  if (typeof path !== 'string' || !path.length) {
    throw new Error('api: a request path is required.');
  }
  if (path.startsWith('/api')) return path;
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Query string from an object, skipping anything absent.
 *
 * `null`, `undefined` and `''` are dropped rather than sent as the
 * string "null". A missing filter and a filter set to nothing are
 * different requests, and the server treats them differently.
 */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v === undefined || v === null || v === '') continue;
        search.append(key, String(v));
      }
      continue;
    }
    search.append(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

function apiError(message, extra = {}) {
  const err = new Error(message);
  Object.assign(err, extra);
  return err;
}

/**
 * The single fetch wrapper.
 *
 * @param {string} path      '/schemes' or '/api/schemes' — both work.
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {any}    [options.body]      Serialised as JSON unless it is
 *                                     already a string or FormData.
 * @param {boolean|'auto'} [options.auth='auto']
 *        'auto'  attach the bearer token when a session exists
 *        true    attach it, and refuse the call when there is none
 *        false   never attach it
 * @param {object} [options.headers]
 * @param {AbortSignal} [options.signal]
 *
 * Resolves to the parsed JSON body, or `null` for 204/205.
 * Rejects with an Error carrying:
 *   status       the HTTP status, or 0 if the request never landed
 *   replacement  for a 410, the path the route moved to
 *   detail       the server's longer explanation when it sends one
 *   body         the parsed error body, for anything else in it
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, auth = 'auto', headers, signal } = options;
  const url = urlFor(path);

  const finalHeaders = new Headers(headers || {});
  finalHeaders.set('Accept', 'application/json');

  let payload;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string' || body instanceof FormData) {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      if (!finalHeaders.has('Content-Type')) {
        finalHeaders.set('Content-Type', 'application/json');
      }
    }
  }

  if (auth !== false) {
    let token = null;
    try {
      token = await getAccessToken();
    } catch {
      // A client that cannot be reached for a session is the same
      // situation as no session: the call goes out unauthenticated
      // and the server decides.
      token = null;
    }
    if (token) {
      finalHeaders.set('Authorization', `Bearer ${token}`);
    } else if (auth === true) {
      throw apiError(
        'You need to be signed in for this. Sign in and try again.',
        { status: 401 },
      );
    }
  }

  let res;
  try {
    res = await fetch(url, { method, headers: finalHeaders, body: payload, signal });
  } catch (networkError) {
    if (networkError?.name === 'AbortError') throw networkError;
    throw apiError(
      `Could not reach the server for ${method} ${url}. Check the connection and try again.`,
      { status: 0, cause: networkError },
    );
  }

  if (res.status === 204 || res.status === 205) {
    if (res.ok) return null;
  }

  const raw = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const looksLikeMarkup = /^\s*[<]/.test(raw);

  let data = null;
  let parseFailed = false;
  if (raw.trim().length) {
    if (contentType.includes('json') || !looksLikeMarkup) {
      try {
        data = JSON.parse(raw);
      } catch {
        parseFailed = true;
      }
    } else {
      parseFailed = true;
    }
  }

  // Markup, or anything else unparseable, means the request did not
  // reach an API route at all. Say that, rather than reporting a
  // SyntaxError about a '<'.
  if (parseFailed) {
    throw apiError(
      `The server has no endpoint at ${method} ${url} — it answered with a ` +
        `page instead of data (HTTP ${res.status}). This is a bug in the app, ` +
        'not something you did.',
      { status: res.status, endpointMissing: true, rawPreview: raw.slice(0, 120) },
    );
  }

  if (res.ok) return data;

  const serverMessage =
    (data && (data.error || data.message || data.detail)) ||
    `Request failed (${res.status}).`;

  if (res.status === 410) {
    const replacement = data?.replacement ?? null;
    // Logged as well as thrown: a 410 means this build still calls a
    // route that was retired, which is a thing to fix in the code
    // rather than something the user can act on.
    console.error(
      `[api] ${method} ${url} is retired (410).` +
        (replacement ? ` Use ${replacement} instead.` : ''),
      data?.detail ?? '',
    );
    throw apiError(serverMessage, {
      status: 410,
      replacement,
      detail: data?.detail ?? null,
      body: data,
    });
  }

  throw apiError(serverMessage, {
    status: res.status,
    detail: data?.detail ?? null,
    body: data,
  });
}

/* =============================================================
   Normalisers

   Only shape differences are smoothed over here. Nothing in this
   section may invent a value: if the server did not send a field,
   it stays absent so the screen above can say so.
   ============================================================= */

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

/* =============================================================
   Assistant and voice
   ============================================================= */

/**
 * Ask the assistant.
 *
 * `location`, `lat` and `lng` are passed through exactly as given.
 * There is deliberately no default: the previous version sent
 * "Sehore, MP" whenever the caller had nothing, so a person in
 * Kerala was answered about a district in Madhya Pradesh in a
 * confident voice. No coordinates means the answer is simply not
 * location-specific, and the response's `hospitalsNote` says why.
 *
 * There is also no offline fallback answer. An earlier version
 * returned invented health guidance attributed to "National Health
 * Mission Care Protocols" with a confidence of 0.9 when the request
 * failed. Nothing had been consulted. This now rejects, and both
 * callers already show a connection error instead.
 */
export function sendMessageToAssistant({
  message,
  language,
  userProfile,
  location,
  lat,
  lng,
  conversationHistory,
} = {}) {
  return request('/assistant/message', {
    method: 'POST',
    body: {
      message,
      language,
      userProfile,
      location: location ?? null,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
      conversationHistory: conversationHistory ?? [],
    },
  });
}

export function transcribeVoice({ audioData, language, textInput } = {}) {
  return request('/voice/transcribe', {
    method: 'POST',
    body: { audioData, language, textInput },
  });
}

export function synthesizeSpeech({ text, language } = {}) {
  return request('/voice/synthesize', { method: 'POST', body: { text, language } });
}

/* =============================================================
   Schemes
   ============================================================= */

export async function getCuratedSchemes({ category, search, state } = {}) {
  const data = await request(`/schemes${qs({ category, search, state })}`);
  return {
    ...data,
    schemes: (data?.schemes || []).map(normalizeScheme),
  };
}

export async function getSchemeById(id) {
  const data = await request(`/schemes/${encodeURIComponent(id)}`);
  return normalizeScheme(data);
}

/**
 * Live search of the government portals.
 *
 * The server answers `{ source_type, live_source_badge, scheme }` —
 * a single scheme, not a list. `results` is derived here so callers
 * can iterate uniformly, and it is empty when nothing came back
 * rather than holding a placeholder row.
 */
export async function searchLiveSchemes(query, language = 'English') {
  const data = await request('/schemes/search-live', {
    method: 'POST',
    body: { query, language },
  });

  const found = data?.scheme ? [data.scheme] : Array.isArray(data?.results) ? data.results : [];

  return {
    ...data,
    results: found.map(normalizeScheme),
  };
}

/**
 * Check what is known about a person against a scheme's published
 * criteria.
 *
 * The response is NOT a verdict and has no `is_eligible` and no
 * `match_score` — reading either yields undefined, on purpose. What
 * comes back is:
 *
 *   { scheme_id, scheme_name,
 *     decision: 'not_assessed', decisionNote,
 *     criteria, checklist: [{ title, state, note }],
 *     unknownCount, documents, notes, next_steps,
 *     verification, source_name, source_url }
 *
 * `state` is 'met' | 'not_met' | 'unknown', and 'unknown' is the
 * common case because most of these facts have not been asked for
 * yet. Render it as unknown, not as a failure.
 */
export function checkSchemeEligibility(schemeId, profile) {
  return request('/schemes/eligibility', {
    method: 'POST',
    body: { schemeId, profile },
  });
}

export function getEligibleSchemeHospitals(schemeId, { lat, lng, radiusKm } = {}) {
  return request(
    `/schemes/${encodeURIComponent(schemeId)}/eligible-hospitals${qs({
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
      radiusKm,
    })}`,
  );
}

/* =============================================================
   Profile and benefits
   ============================================================= */

export function getUserProfile() {
  return request('/profile');
}

export function updateUserProfile(data) {
  return request('/profile', { method: 'PATCH', body: data });
}

/**
 * The benefits tracker.
 *
 * Returned unchanged. The previous version of this function mapped
 * the response into `active_applications` rows and filled the gaps
 * itself — a beneficiary called "Beneficiary", an amount of "Status
 * unavailable", and a next step of "Visit the nearest PHC/CSC" that
 * no server ever sent. The screen now reads the real shape:
 * `{ signedIn, beneficiary, profileComplete, schemes,
 *    claimsDataAvailable, claimsNote, note }`.
 */
export function getBenefitTrackerData() {
  return request('/benefits/tracker');
}

/* =============================================================
   Hospitals — the National Health Authority PM-JAY registry
   ============================================================= */

/**
 * Nearest empanelled hospitals to a coordinate.
 *
 * Coordinates are required and are never invented. Without them
 * this resolves to an empty list carrying a `note` that says the
 * list needs a location, because a "nearest hospital" measured
 * from a guessed point is worse than a blank screen — and because
 * an exception here would take down a page that is otherwise fine.
 */
export function getNearbyHospitals({ lat, lng, limit, radiusKm, type, speciality, offset } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Promise.resolve({
      hospitals: [],
      count: 0,
      locationMissing: true,
      note:
        'This list is built from your location. Share your location to see the ' +
        'nearest hospitals empanelled under PM-JAY.',
    });
  }

  return request(
    `/hospitals/nearby${qs({ lat: latitude, lng: longitude, limit, radiusKm, type, speciality, offset })}`,
  );
}

/**
 * Search the registry by name, state or district.
 *
 * At least one of `q`, `stateCode` or `districtCode` is required —
 * the server refuses to return 39,000 hospitals in name order. It
 * also refuses `pincode` and `city`, which the registry does not
 * publish for these facilities.
 *
 * `state`, `district`, `scheme` and `limit` are accepted as aliases
 * for `stateCode`, `districtCode`, `speciality` and `size`, because
 * that is how the route is written up elsewhere.
 */
export function searchHospitals({
  q,
  stateCode,
  districtCode,
  state,
  district,
  type,
  speciality,
  scheme,
  page,
  size,
  limit,
} = {}) {
  return request(
    `/hospitals/search${qs({
      q,
      stateCode: stateCode ?? state,
      districtCode: districtCode ?? district,
      type,
      speciality: speciality ?? scheme,
      page,
      size: size ?? limit,
    })}`,
  );
}

/** States, districts, specialities, and an honest coverage count. */
export function getHospitalMeta({ stateCode } = {}) {
  return request(`/hospitals/meta${qs({ stateCode })}`);
}

export function getHospitalById(id) {
  return request(`/hospitals/${encodeURIComponent(id)}`);
}

/**
 * Kept for callers written against the retired facilities route.
 *
 * `GET /api/facilities/nearby` served hand-written health centres
 * with invented names, distances and phone numbers, and now answers
 * 410. This forwards to the hospital registry instead. Coordinates
 * are still required; nothing here fills them in.
 */
export function getNearbyFacilities({ lat, lng, limit, radiusKm, type } = {}) {
  return getNearbyHospitals({ lat, lng, limit, radiusKm, type });
}

/* =============================================================
   Notifications
   ============================================================= */

export function getNotifications({ unreadOnly, page, size } = {}) {
  return request(`/notifications${qs({ unreadOnly, page, size })}`, { auth: true });
}

/** `{ unreadCount }`. */
export function getUnreadNotificationCount() {
  return request('/notifications/unread-count', { auth: true });
}

export function markNotificationRead(id) {
  return request(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    auth: true,
  });
}

export function markAllNotificationsRead() {
  return request('/notifications/read-all', { method: 'POST', auth: true });
}

/**
 * ASHA only. One notification to a village, a single citizen, or
 * every village the worker is assigned to.
 *
 * `audience` is 'village' with a villageId, 'citizen' with a
 * citizenId, or 'all_my_villages'. The database checks that the
 * worker actually covers the village named, so another village's id
 * fails at the policy rather than being quietly dropped.
 */
export function createAshaNotification(payload) {
  return request('/asha/notifications', { method: 'POST', body: payload, auth: true });
}

export function getAshaNotifications({ page, size } = {}) {
  return request(`/asha/notifications${qs({ page, size })}`, { auth: true });
}

export function deleteAshaNotification(id) {
  return request(`/asha/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

/* =============================================================
   Messaging between a citizen and her ASHA worker
   ============================================================= */

/**
 * The worker covering a village.
 *
 * Answers `{ asha: null, note, helpline }` rather than a 404 when
 * nobody is mapped yet — "no worker is assigned" and "no such
 * village" are different claims. A worker from a neighbouring
 * village is never substituted.
 */
export function getAshaContact({ villageId } = {}) {
  return request(`/asha/contact${qs({ villageId })}`, { auth: true });
}

/** `{ threads, count, unreadTotal, … }`. */
export function getMessageThreads({ page, size } = {}) {
  return request(`/messages/threads${qs({ page, size })}`, { auth: true });
}

/** Find-or-create, so two taps cannot open two threads. */
export function createMessageThread({ ashaId } = {}) {
  return request('/messages/threads', { method: 'POST', body: { ashaId }, auth: true });
}

/** Reading a thread is the read receipt for its incoming messages. */
export function getMessageThread(id, { before } = {}) {
  return request(`/messages/threads/${encodeURIComponent(id)}${qs({ before })}`, {
    auth: true,
  });
}

export function postMessageToThread(id, body) {
  return request(`/messages/threads/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: { body },
    auth: true,
  });
}

export function getAshaThreadSummary() {
  return request('/asha/threads/summary', { auth: true });
}

/* =============================================================
   Emergency SOS
   ============================================================= */

/**
 * Broadcast an emergency.
 *
 * Every attempt is reported back: `deliveries` carries one row per
 * intended recipient with a status of 'sent', 'skipped' or 'failed'
 * and a `reason` when it is not 'sent'. 'sent' means Twilio accepted
 * the message — it is not a delivery receipt, so it must never be
 * rendered as "delivered".
 *
 * Passing lat/lng snapshots the nearest hospitals onto the record.
 * Without them `locationShared` is false and no hospitals are
 * attached; the village centroid is deliberately not substituted.
 */
export function broadcastSOS(payload) {
  return request('/sos/broadcast', { method: 'POST', body: payload, auth: true });
}

/**
 * Kept for callers written against `POST /api/emergency/event`,
 * which stamped every alert with an ASHA worker who does not exist
 * and an assurance that an ambulance workflow had fired. It now
 * answers 410. This forwards to the SOS broadcast, which reports
 * exactly who it actually reached.
 */
export function triggerEmergencyEvent(payload) {
  return broadcastSOS(payload);
}

/** Whether SMS can actually be sent, and how many contacts are saved. */
export function getSOSConfig() {
  return request('/sos/config', { auth: true });
}

export function getMySOSBroadcasts() {
  return request('/sos/mine', { auth: true });
}

export function getSOSById(id) {
  return request(`/sos/${encodeURIComponent(id)}`, { auth: true });
}

export function acknowledgeSOS(id) {
  return request(`/sos/${encodeURIComponent(id)}/acknowledge`, {
    method: 'POST',
    auth: true,
  });
}

export function resolveSOS(id, outcome) {
  return request(`/sos/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: { outcome },
    auth: true,
  });
}

/** ASHA only. The SOS queue for her villages. */
export function getAshaSOSQueue({ status } = {}) {
  return request(`/asha/sos${qs({ status })}`, { auth: true });
}

export function getEmergencyContacts() {
  return request('/emergency-contacts', { auth: true });
}

export function createEmergencyContact(payload) {
  return request('/emergency-contacts', { method: 'POST', body: payload, auth: true });
}

export function updateEmergencyContact(id, payload) {
  return request(`/emergency-contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: payload,
    auth: true,
  });
}

export function deleteEmergencyContact(id) {
  return request(`/emergency-contacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

/* =============================================================
   Becoming an ASHA worker

   None of this is decided in the browser. The role is granted by
   the server, either against a bcrypt-hashed roster invite code it
   never sends out, or by an admin approving a request.
   ============================================================= */

export function claimAshaCode({ ashaCode, inviteCode } = {}) {
  return request('/asha/claim-code', {
    method: 'POST',
    body: { ashaCode, inviteCode },
    auth: true,
  });
}

export function submitAshaRegistrationRequest(payload) {
  return request('/asha/registration-request', {
    method: 'POST',
    body: payload,
    auth: true,
  });
}

export function getMyAshaRegistrationRequest() {
  return request('/asha/registration-request/mine', { auth: true });
}

export function withdrawAshaRegistrationRequest() {
  return request('/asha/registration-request/withdraw', { method: 'POST', auth: true });
}

export function getAshaMe() {
  return request('/asha/me', { auth: true });
}

/* ---- Admin review ---- */

export function getAshaRequests({ status, page, size } = {}) {
  return request(`/admin/asha/requests${qs({ status, page, size })}`, { auth: true });
}

export function approveAshaRequest(id, note) {
  return request(`/admin/asha/requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: { note },
    auth: true,
  });
}

export function rejectAshaRequest(id, note) {
  return request(`/admin/asha/requests/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { note },
    auth: true,
  });
}

/** Returns plaintext invite codes once. They cannot be fetched again. */
export function uploadAshaRoster({ rows, source } = {}) {
  return request('/admin/asha/roster', {
    method: 'POST',
    body: { rows, source },
    auth: true,
  });
}

/* =============================================================
   AI — voice sessions and prescription reading
   ============================================================= */

/**
 * A short-lived token for a Gemini Live session.
 *
 * The API key never reaches the browser. If minting fails the
 * server answers 503 and voice is simply unavailable — it does not
 * fall back to handing the key over, so treat a rejection as "voice
 * is off right now, the text assistant still works".
 */
export function getVoiceLiveToken() {
  return request('/voice/live-token', { method: 'POST', auth: true });
}

/**
 * Read a prescription photograph.
 *
 * The image is read and not stored; only the structured result is
 * kept, and it is always `verification: 'inferred'` — handwriting
 * can be misread and the database refuses to mark one of these
 * verified. Show `unreadableParts` rather than hiding it: what the
 * model could not read is the part a pharmacist has to check.
 */
export function analyzePrescription({ imageBase64, mimeType, images, note } = {}) {
  return request('/prescription/analyze', {
    method: 'POST',
    body: { imageBase64, mimeType, images, note },
    auth: true,
  });
}

export function getPrescriptionScans({ page, size } = {}) {
  return request(`/prescription/scans${qs({ page, size })}`, { auth: true });
}

export function getPrescriptionScan(id) {
  return request(`/prescription/scans/${encodeURIComponent(id)}`, { auth: true });
}

export function deletePrescriptionScan(id) {
  return request(`/prescription/scans/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

/** Which AI features are actually live, so the UI can hide the rest. */
export function getAiStatus() {
  return request('/ai/status');
}

/**
 * The older, unauthenticated image reader on `POST /api/image/analyze`.
 * Still live and still used by the prescription scanner component.
 */
export function analyzePrescriptionImage(imageBase64, mimeType, notes, language) {
  return request('/image/analyze', {
    method: 'POST',
    body: { imageBase64, mimeType, notes, language },
  });
}

/* =============================================================
   Server
   ============================================================= */

/** Reports what is wired, without returning a single secret. */
export function getServerHealth() {
  return request('/health');
}
