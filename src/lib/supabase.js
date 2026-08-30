import { createClient } from '@supabase/supabase-js';

/* =============================================================
   Supabase client.

   Two things worth knowing about this file:

   1. It reads only the anon (publishable) key. That key is designed to
      be public — it is safe in the bundle because Row Level Security is
      what actually guards the data. The secret key must never appear
      anywhere under src/; it lives in the server process only.

   2. `supabase` is null only when the two environment variables are
      missing, which is a misconfiguration rather than a mode. There is
      no sample-data fallback any more: the app used to quietly serve
      invented records when the backend was absent, and a health app
      that shows a made-up hospital is worse than one that says it
      cannot reach the server. Anything that needs the client should
      call requireSupabase() and let the error surface.
   ============================================================= */

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'sehat-sathi-auth',
      },
      global: {
        headers: { 'x-application-name': 'sehat-sathi' },
      },
    })
  : null;

if (!isSupabaseConfigured) {
  console.error(
    '[sehat-sathi] Supabase is not configured. Sign-in, schemes, hospitals ' +
      'and notifications will all fail until VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY are set in .env.local.',
  );
}

/**
 * The client, or a thrown error explaining what is missing. Used at the
 * point of use so a missing variable produces one clear message instead
 * of a "cannot read properties of null" further down the call stack.
 */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'This app is not connected to its database yet. Set VITE_SUPABASE_URL ' +
        'and VITE_SUPABASE_ANON_KEY in .env.local and reload.',
    );
  }
  return supabase;
}

/**
 * The access token for the current session, or null. Used to
 * authenticate calls to our own /api/asha/* endpoints — the server
 * re-verifies it rather than trusting anything the client claims
 * about who it is.
 */
export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * fetch() with the caller's bearer token attached.
 */
export async function authedFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* response had no JSON body; the status is all we get */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return res.status === 204 ? null : res.json();
}
