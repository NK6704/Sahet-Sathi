import { supabase } from '@/lib/supabase';

/* =============================================================
   The ASHA portal's data layer.

   Reads go straight to Supabase. That is safe because RLS decides
   what comes back — an ASHA worker's query for `referrals` returns
   only her own rows whether or not the UI asked nicely. Writes that
   need to be audited or to touch anything a client should not be
   trusted with go through /api/asha/*.

   NOTHING HERE INVENTS A ROW. This module used to fall back to a
   sample dataset whenever no Supabase project was configured, which
   put a fictional worker ("Demo ASHA worker, DEMO-0001, Demo
   Sub-centre") and fictional patient alerts in front of somebody who
   had no way of telling them apart from real ones. An ASHA portal
   that shows an invented referral is worse than one that shows an
   error, because she may act on it.

   With no project configured every function now throws a single
   clear error, which the pages already render as an error state.
   ============================================================= */

/**
 * Every read and write in this module needs a configured project.
 * Throwing here — rather than returning a plausible-looking row — is
 * the whole point: an unconfigured deployment is a deployment fault,
 * not a state the ASHA portal should be designed to look normal in.
 */
function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'This device has no connection to the Sehat Sathi database, so no ' +
        'records can be shown. Ask whoever set up this phone to check the ' +
        'app configuration.',
    );
  }
}

/* -------------------------------------------------------------
   Referral status vocabulary — the seven states from the brief.
   Order matters: this is the order they appear in filters and the
   order the timeline reads in.
   ------------------------------------------------------------- */
export const REFERRAL_STATUSES = [
  { value: 'pending', label: 'Pending', label_hi: 'बाकी', tone: 'amber',
    help: 'Raised, but the facility has not responded yet.' },
  { value: 'acknowledged', label: 'Acknowledged', label_hi: 'स्वीकृत', tone: 'seal',
    help: 'The facility has seen it.' },
  { value: 'contacted', label: 'Contacted', label_hi: 'संपर्क हुआ', tone: 'seal',
    help: 'You have spoken to the patient or the family.' },
  { value: 'referred', label: 'Referred', label_hi: 'भेजा गया', tone: 'asha',
    help: 'The patient has been sent to the facility.' },
  { value: 'in_progress', label: 'In progress', label_hi: 'चल रहा है', tone: 'asha',
    help: 'Under treatment or awaiting a result.' },
  { value: 'resolved', label: 'Resolved', label_hi: 'पूरा हुआ', tone: 'seal',
    help: 'Closed with an outcome recorded.' },
  { value: 'cancelled', label: 'Cancelled', label_hi: 'रद्द', tone: 'neutral',
    help: 'Not going ahead. The record stays.' },
];

export const statusMeta = (value) =>
  REFERRAL_STATUSES.find((s) => s.value === value) || REFERRAL_STATUSES[0];

export const SEVERITIES = [
  { value: 'critical', label: 'Critical', label_hi: 'अति गंभीर', tone: 'siren' },
  { value: 'high', label: 'High', label_hi: 'गंभीर', tone: 'siren' },
  { value: 'moderate', label: 'Moderate', label_hi: 'मध्यम', tone: 'amber' },
  { value: 'low', label: 'Low', label_hi: 'सामान्य', tone: 'neutral' },
];

export const severityMeta = (value) =>
  SEVERITIES.find((s) => s.value === value) || SEVERITIES[2];

const SEVERITY_RANK = { critical: 0, high: 1, moderate: 2, low: 3 };

/* -------------------------------------------------------------
   Dashboard
   ------------------------------------------------------------- */
export async function getDashboard(ashaId) {
  requireSupabase();
  const [alertsRes, referralsRes, ashaRes] = await Promise.all([
    supabase
      .from('asha_alerts')
      .select('*')
      .eq('asha_id', ashaId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('referrals')
      .select('*')
      .eq('asha_id', ashaId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('asha_profiles').select('*').eq('user_id', ashaId).maybeSingle(),
  ]);

  if (alertsRes.error) throw alertsRes.error;
  if (referralsRes.error) throw referralsRes.error;

  return buildDashboard(alertsRes.data ?? [], referralsRes.data ?? [], ashaRes.data ?? null);
}

function buildDashboard(alerts, referrals, asha) {
  const open = alerts.filter((a) => a.status === 'new' || a.status === 'acknowledged');
  const urgent = open.filter((a) => a.severity === 'critical' || a.severity === 'high');
  const openReferrals = referrals.filter(
    (r) => !['resolved', 'cancelled'].includes(r.status),
  );

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const resolvedToday = referrals.filter(
    (r) => r.status === 'resolved' && r.visited_on && new Date(r.visited_on) >= startOfToday,
  );

  // Sorted so the thing that matters most is first on the screen.
  // A worker opening this at 6am should not have to scan for it.
  const queue = [...open].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      new Date(b.created_at) - new Date(a.created_at),
  );

  return {
    asha,
    counts: {
      urgent: urgent.length,
      openAlerts: open.length,
      openReferrals: openReferrals.length,
      resolvedToday: resolvedToday.length,
      households: asha?.households ?? 0,
    },
    queue,
    recentReferrals: referrals.slice(0, 6),
    byStatus: REFERRAL_STATUSES.map((s) => ({
      ...s,
      count: referrals.filter((r) => r.status === s.value).length,
    })),
  };
}

/* -------------------------------------------------------------
   Alerts
   ------------------------------------------------------------- */
export async function listAlerts(ashaId, { status, severity, search } = {}) {
  requireSupabase();
  let q = supabase.from('asha_alerts').select('*').eq('asha_id', ashaId);
  if (status && status !== 'all') q = q.eq('status', status);
  if (severity && severity !== 'all') q = q.eq('severity', severity);

  const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
  if (error) throw error;

  return filterAlerts(data ?? [], { search });
}

function filterAlerts(rows, { status, severity, search }) {
  let out = rows;
  if (status && status !== 'all') out = out.filter((a) => a.status === status);
  if (severity && severity !== 'all') out = out.filter((a) => a.severity === severity);
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((a) =>
      [a.citizen_name, a.village, a.title, a.body]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }
  return [...out].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      new Date(b.created_at) - new Date(a.created_at),
  );
}

export async function getAlert(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from('asha_alerts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateAlert(id, patch) {
  requireSupabase();
  const stamped = { ...patch };
  if (patch.status === 'acknowledged' && !patch.acknowledged_at) {
    stamped.acknowledged_at = new Date().toISOString();
  }
  if (patch.status === 'closed' && !patch.closed_at) {
    stamped.closed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('asha_alerts')
    .update(stamped)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  await logAction('alert.updated', 'asha_alerts', id, { patch: stamped });
  return data;
}

/* -------------------------------------------------------------
   Referrals
   ------------------------------------------------------------- */
export async function listReferrals(ashaId, { status, search } = {}) {
  requireSupabase();
  let q = supabase.from('referrals').select('*').eq('asha_id', ashaId);
  if (status && status !== 'all') q = q.eq('status', status);

  const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
  if (error) throw error;

  return filterReferrals(data ?? [], { search });
}

function filterReferrals(rows, { status, search }) {
  let out = rows;
  if (status && status !== 'all') out = out.filter((r) => r.status === status);
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((r) =>
      [r.patient_name, r.village, r.reason, r.facility_name]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }
  return out;
}

export async function getReferral(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from('referrals')
    .select('*, referral_events(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createReferral(ashaId, payload) {
  requireSupabase();
  const { data, error } = await supabase
    .from('referrals')
    .insert({ ...payload, asha_id: ashaId })
    .select()
    .single();
  if (error) throw error;

  await logAction('referral.created', 'referrals', data.id, {
    urgency: data.urgency,
    facility: data.facility_name,
  });
  return data;
}

export async function updateReferral(id, patch) {
  requireSupabase();
  const stamped = { ...patch };
  if (patch.status === 'resolved' && !patch.visited_on) {
    stamped.visited_on = new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await supabase
    .from('referrals')
    .update(stamped)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  // The status change itself is logged by a database trigger, so it
  // is recorded even if this call never completes.
  return data;
}

/* -------------------------------------------------------------
   Reference data
   ------------------------------------------------------------- */
export async function listFacilities({ search, kind } = {}) {
  requireSupabase();
  let q = supabase.from('healthcare_facilities').select('*').eq('active', true);
  if (kind && kind !== 'all') q = q.eq('kind', kind);
  if (search) q = q.ilike('name', `%${search}%`);

  const { data, error } = await q.order('name').limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function listSchemes({ search, category } = {}) {
  if (!supabase) {
    // The express route wraps its rows in { schemes: [...] }. Unwrap it
    // here so every caller of listSchemes gets a plain array, whichever
    // backend is answering.
    const { getCuratedSchemes } = await import('@/services/api');
    const res = await getCuratedSchemes({ category, search });
    return Array.isArray(res) ? res : res?.schemes ?? [];
  }

  let q = supabase.from('schemes').select('*').eq('active', true);
  if (category && category !== 'all') q = q.eq('category', category);
  if (search) q = q.or(`name.ilike.%${search}%,short_desc.ilike.%${search}%`);

  const { data, error } = await q.order('name').limit(100);
  if (error) throw error;
  return data ?? [];
}

/**
 * Health camps. Only verified, uncancelled, future camps — enforced
 * again here on top of the RLS policy, because "no camps found" is a
 * far better answer than a camp that was quietly cancelled.
 */
export async function listCamps({ from } = {}) {
  requireSupabase();
  const since = from || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('health_camps')
    .select('*')
    .eq('verification', 'verified')
    .eq('cancelled', false)
    .gte('camp_date', since)
    .order('camp_date')
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

/* -------------------------------------------------------------
   Profile
   ------------------------------------------------------------- */
export async function updateAshaProfile(ashaId, patch) {
  requireSupabase();
  const profileFields = ['full_name', 'phone', 'language', 'district', 'state', 'village'];
  const ashaFields = [
    'block',
    'sub_centre',
    'villages',
    'households',
    'supervisor_name',
    'supervisor_phone',
  ];

  const profilePatch = pick(patch, profileFields);
  const ashaPatch = pick(patch, ashaFields);

  if (Object.keys(profilePatch).length) {
    const { error } = await supabase.from('profiles').update(profilePatch).eq('id', ashaId);
    if (error) throw error;
  }
  if (Object.keys(ashaPatch).length) {
    const { error } = await supabase
      .from('asha_profiles')
      .update(ashaPatch)
      .eq('user_id', ashaId);
    if (error) throw error;
  }

  await logAction('profile.updated', 'profiles', ashaId, {
    fields: Object.keys({ ...profilePatch, ...ashaPatch }),
  });
  return { ...profilePatch, ...ashaPatch };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/* -------------------------------------------------------------
   Audit
   ------------------------------------------------------------- */

/**
 * Best-effort audit write. Never throws: a failed log must not roll
 * back a referral the worker just made in the field. The important
 * transitions are also logged by database triggers, which cannot be
 * skipped by a client at all.
 */
export async function logAction(action, entity, entityId, detail = {}) {
  if (!supabase) return;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const actor = sess?.session?.user?.id;
    if (!actor) return;
    await supabase.from('audit_logs').insert({
      actor_id: actor,
      action,
      entity,
      entity_id: String(entityId),
      detail,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[audit] could not record', action, e);
  }
}
