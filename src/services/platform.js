import { authedFetch } from '@/lib/supabase';

/* =============================================================
   Client for everything the platform backend added: hospitals,
   notifications, ASHA messaging, SOS, prescriptions and voice.

   One file rather than additions to services/api.js because every
   call here is authenticated and goes through authedFetch, which
   attaches the session bearer token and turns a non-2xx response into
   an Error carrying `.status` and the server's own message. The older
   api.js talks to the unauthenticated routes with bare fetch.

   Two conventions worth knowing before using any of this:

   1. An empty result is an empty array with a `note` explaining why,
      not an error and not a silent substitution. If /hospitals/nearby
      returns nothing within the radius, the radius is not widened and
      no other area is searched — a "nearest hospital" a user cannot
      trust is worse than a blank screen. Render the note.

   2. Nothing here is verified by this app unless the row says so.
      Hospital rows carry `source`, `sourceUrl` and `contactVerified`;
      prescription readings carry `verification: 'inferred'`. Those
      fields exist to be shown, not filtered out.
   ============================================================= */

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

/* ---- Hospitals (PM-JAY empanelled registry) ----------------- */

/**
 * Nearest empanelled hospitals to a coordinate.
 *
 * `radiusKm` is clamped server-side to 1–100 and the result is ordered
 * by true great-circle distance. Rows without a usable coordinate — a
 * little under 4% of the registry — cannot appear here at all, which is
 * why `note` on the response says so.
 */
export function getHospitalsNearby({ lat, lng, radiusKm, type, speciality, limit, offset } = {}) {
  return authedFetch(`/api/hospitals/nearby${qs({ lat, lng, radiusKm, type, speciality, limit, offset })}`);
}

/**
 * Search by name, state or district. At least one of q, stateCode or
 * districtCode is required.
 *
 * Do not pass `pincode` or `city`: the National Health Authority
 * registry publishes neither for these facilities, and the server
 * returns a 400 saying so rather than pretending to filter.
 */
export function searchHospitals({ q, stateCode, districtCode, type, speciality, page, size } = {}) {
  return authedFetch(`/api/hospitals/search${qs({ q, stateCode, districtCode, type, speciality, page, size })}`);
}

/** States, districts, specialities, and honest coverage counts. */
export function getHospitalMeta({ stateCode } = {}) {
  return authedFetch(`/api/hospitals/meta${qs({ stateCode })}`);
}

export function getHospital(id) {
  return authedFetch(`/api/hospitals/${encodeURIComponent(id)}`);
}

/* ---- Notifications ------------------------------------------ */

export function getNotifications({ unreadOnly, page, size } = {}) {
  return authedFetch(`/api/notifications${qs({ unreadOnly, page, size })}`);
}

export function getUnreadNotificationCount() {
  return authedFetch('/api/notifications/unread-count');
}

export function markNotificationRead(id) {
  return authedFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead() {
  return authedFetch('/api/notifications/read-all', { method: 'POST' });
}

/**
 * ASHA only. Broadcasts to every registered resident of one village.
 *
 * `audience` is 'village' with a villageId, 'citizen' with a citizenId,
 * or 'all_my_villages' which creates one notification per assigned
 * village so each record still names a single village. The database
 * checks that the worker actually covers the village named, so posting
 * someone else's villageId fails at the policy rather than being
 * quietly filtered.
 */
export function broadcastNotification(payload) {
  return authedFetch('/api/asha/notifications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getSentNotifications({ page, size } = {}) {
  return authedFetch(`/api/asha/notifications${qs({ page, size })}`);
}

export function deleteSentNotification(id) {
  return authedFetch(`/api/asha/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ---- ASHA contact and messaging ----------------------------- */

/**
 * The ASHA worker covering a village, with her name and phone number.
 *
 * Returns `{ asha: null, note, helpline }` rather than a 404 when no
 * worker is mapped — "nobody is assigned yet" and "this village does
 * not exist" are different claims and the UI should not conflate them.
 * A worker from a neighbouring village is never substituted.
 */
export function getAshaContact({ villageId } = {}) {
  return authedFetch(`/api/asha/contact${qs({ villageId })}`);
}

export function getMessageThreads() {
  return authedFetch('/api/messages/threads');
}

/** Find-or-create. Two taps cannot produce two threads. */
export function openMessageThread({ ashaId } = {}) {
  return authedFetch('/api/messages/threads', {
    method: 'POST',
    body: JSON.stringify({ ashaId }),
  });
}

/** Reading a thread is the read receipt — this marks incoming messages read. */
export function getThreadMessages(id, { before } = {}) {
  return authedFetch(`/api/messages/threads/${encodeURIComponent(id)}${qs({ before })}`);
}

export function sendThreadMessage(id, body) {
  return authedFetch(`/api/messages/threads/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function getAshaThreadSummary() {
  return authedFetch('/api/asha/threads/summary');
}

/**
 * The households in the worker's own assigned villages.
 *
 * `{ households: [{ userId, fullName, villageId, village, registeredAt }],
 *    villages, source, note? }`
 *
 * Only families who have registered on Sehat Sathi appear. The `source`
 * sentence says exactly that and should be rendered — a worker reading
 * this list must not take it for her household register. No phone
 * numbers are returned; this list exists so she can write first.
 */
export function getAshaHouseholds() {
  return authedFetch('/api/asha/households');
}

/**
 * The worker opens the conversation. Find-or-create, like the citizen side.
 *
 * POST /api/messages/threads cannot serve this: it keys the caller as
 * `citizen_id`, so a worker calling it for her own village resolves to
 * herself and is refused by `check (citizen_id <> asha_id)`. Returns
 * `{ thread, created, householdNotified }` — `householdNotified` is
 * whether the in-app notice actually reached them, and is worth showing.
 */
export function openAshaThread({ citizenId, subject } = {}) {
  return authedFetch('/api/asha/messages/threads', {
    method: 'POST',
    body: JSON.stringify({ citizenId, ...(subject ? { subject } : {}) }),
  });
}

/* ---- Emergency SOS ------------------------------------------ */

/**
 * Whether SMS can actually be sent, plus how many contacts are saved.
 *
 * Worth calling on the emergency screen *before* anything happens. If
 * SMS is not configured the user should learn that while they are calm,
 * not from a delivery record afterwards.
 */
export function getSosConfig() {
  return authedFetch('/api/sos/config');
}

/**
 * Broadcast an emergency.
 *
 * Everything that happens is reported back: `deliveries` carries one row
 * per intended recipient with a status of 'sent', 'skipped' or 'failed'
 * and a `reason` whenever it is not 'sent'. A 'sent' SMS means Twilio
 * accepted the message, never that a handset rang — do not render it as
 * "delivered".
 *
 * Passing latitude and longitude snapshots the five nearest hospitals
 * onto the record. Without them `locationShared` is false and
 * `nearestHospitals` is empty; the village centroid is deliberately not
 * substituted, because a wrong hospital in an emergency is worse than
 * none, so show that as "we do not know where you are".
 */
export function broadcastSos(payload) {
  return authedFetch('/api/sos/broadcast', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMySosBroadcasts() {
  return authedFetch('/api/sos/mine');
}

export function getSos(id) {
  return authedFetch(`/api/sos/${encodeURIComponent(id)}`);
}

export function acknowledgeSos(id) {
  return authedFetch(`/api/sos/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
}

export function resolveSos(id, outcome) {
  return authedFetch(`/api/sos/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ outcome }),
  });
}

/** ASHA only. The active SOS queue for her villages. */
export function getAshaSosQueue({ status } = {}) {
  return authedFetch(`/api/asha/sos${qs({ status })}`);
}

/* ---- Emergency contacts ------------------------------------- */

export function getEmergencyContacts() {
  return authedFetch('/api/emergency-contacts');
}

export function addEmergencyContact(payload) {
  return authedFetch('/api/emergency-contacts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateEmergencyContact(id, payload) {
  return authedFetch(`/api/emergency-contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteEmergencyContact(id) {
  return authedFetch(`/api/emergency-contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ---- Voice and prescriptions -------------------------------- */

/**
 * A short-lived token for a Gemini Live session.
 *
 * The API key never reaches the browser. If minting fails the server
 * returns 503 and voice is unavailable — it does not fall back to
 * handing over the key, so treat a rejection here as "voice is off
 * right now, the text assistant still works".
 */
export function getVoiceLiveToken() {
  return authedFetch('/api/voice/live-token', { method: 'POST' });
}

/**
 * Read a prescription photo.
 *
 * The image is sent, read, and not stored — only the structured result
 * is kept. The result is always `verification: 'inferred'`: handwriting
 * can be misread, and the database itself refuses to mark one of these
 * 'verified'. Show the disclaimer, and show `unreadableParts` rather
 * than hiding it, because what the model could not read is the part a
 * pharmacist needs to check.
 */
export function analyzePrescription({ imageBase64, mimeType, images, note }) {
  return authedFetch('/api/prescription/analyze', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType, images, note }),
  });
}

export function getPrescriptionScans({ page, size } = {}) {
  return authedFetch(`/api/prescription/scans${qs({ page, size })}`);
}

export function getPrescriptionScan(id) {
  return authedFetch(`/api/prescription/scans/${encodeURIComponent(id)}`);
}

export function deletePrescriptionScan(id) {
  return authedFetch(`/api/prescription/scans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Which AI features are actually live, so the UI can hide the rest. */
export function getAiStatus() {
  return authedFetch('/api/ai/status');
}

/* ---- ASHA registration -------------------------------------- */

export function getAshaMe() {
  return authedFetch('/api/asha/me');
}

export function submitAshaRegistrationRequest(payload) {
  return authedFetch('/api/asha/registration-request', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMyAshaRegistrationRequest() {
  return authedFetch('/api/asha/registration-request/mine');
}

export function withdrawAshaRegistrationRequest() {
  return authedFetch('/api/asha/registration-request/withdraw', { method: 'POST' });
}

/* ---- Admin review ------------------------------------------- */

export function getAshaRequests({ status, page, size } = {}) {
  return authedFetch(`/api/admin/asha/requests${qs({ status, page, size })}`);
}

export function approveAshaRequest(id, note) {
  return authedFetch(`/api/admin/asha/requests/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function rejectAshaRequest(id, note) {
  return authedFetch(`/api/admin/asha/requests/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/** Returns plaintext invite codes once. They cannot be retrieved again. */
export function uploadAshaRoster({ rows, source }) {
  return authedFetch('/api/admin/asha/roster', {
    method: 'POST',
    body: JSON.stringify({ rows, source }),
  });
}

/* ---- Server configuration ----------------------------------- */

/** Reports what is wired without returning a single secret. */
export function getServerHealth() {
  return authedFetch('/api/health');
}
