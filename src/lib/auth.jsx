import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured, requireSupabase, authedFetch } from '@/lib/supabase';

/* =============================================================
   Auth.

   The role held here is read from the `profiles` table, never from
   anything the client could set. A user could edit localStorage all
   day and it would not change what this returns, because the value
   comes back from Postgres under RLS, and the guard_role_change
   trigger refuses a self-promotion even if someone reached the row.

   There is no demo mode. This file used to mint a local ASHA session
   with the identity "Demo ASHA worker / DEMO-0001 / Demo Sub-centre"
   whenever Supabase was absent, which meant the portal could be walked
   through without a backend. That is gone. An ASHA worker's account is
   now the boundary that decides who can broadcast to a village and who
   can see a household's emergency, so a fake one that appears whenever
   configuration is missing is not a convenience — it is a way for the
   real check to never get tested.

   Becoming an ASHA worker is not something this file can do. It
   happens server-side, either by claiming a roster invite code or by
   an admin approving a request. See server/routes/ashaAuth.ts.
   ============================================================= */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---- profile fetch ---------------------------------------- */
  async function loadProfile(userId) {
    if (!supabase || !userId) return null;

    const { data, error: err } = await supabase
      .from('profiles')
      .select(
        'id, role, full_name, phone, language, age, gender, state, district, village, village_id, pincode, annual_income, category, has_abha, consent_data, consent_voice',
      )
      .eq('id', userId)
      .maybeSingle();

    if (err) throw err;

    // An ASHA worker carries a second record. Fetched separately so a
    // citizen's request never even asks for the ASHA table.
    if (data?.role === 'asha' || data?.role === 'admin') {
      const { data: asha } = await supabase
        .from('asha_profiles')
        .select(
          'id, asha_code, block, sub_centre, villages, households, supervisor_name, supervisor_phone, active, joined_on',
        )
        .eq('user_id', userId)
        .maybeSingle();

      // The villages a worker may broadcast to come from the junction
      // table, not from the text[] on asha_profiles. The array is a
      // human-readable label; asha_villages is what RLS checks.
      const { data: assigned } = await supabase
        .from('asha_villages')
        .select('village_id, is_primary, villages(id, name, block, district, state)')
        .eq('asha_user_id', userId);

      return {
        ...data,
        asha: asha ?? null,
        assignedVillages: (assigned ?? []).map((row) => ({
          id: row.village_id,
          isPrimary: row.is_primary,
          ...(row.villages ?? {}),
        })),
      };
    }

    return data;
  }

  /* ---- bootstrap -------------------------------------------- */
  useEffect(() => {
    if (!supabase) {
      // No client at all. Say so rather than presenting a signed-out
      // app that would fail on every action without explanation.
      setStatus('error');
      setError(
        new Error(
          'This app is not connected to its database. Set VITE_SUPABASE_URL and ' +
            'VITE_SUPABASE_ANON_KEY in .env.local, then reload.',
        ),
      );
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(data.session ?? null);
        if (data.session?.user) {
          setProfile(await loadProfile(data.session.user.id));
        }
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setStatus('error');
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      if (!next?.user) {
        setProfile(null);
        return;
      }
      loadProfile(next.user.id)
        .then((p) => mounted.current && setProfile(p))
        .catch((e) => mounted.current && setError(e));
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  /* ---- actions ---------------------------------------------- */
  async function signIn({ email, password }) {
    const client = requireSupabase();
    const { data, error: err } = await client.auth.signInWithPassword({ email, password });
    if (err) throw new Error(friendlyAuthError(err));
    return data;
  }

  async function signUp({ email, password, fullName, phone, language = 'English' }) {
    const client = requireSupabase();

    // Note what is absent here: `role`. It used to be a parameter, which
    // meant the signup form chose it. The handle_new_user trigger clamps
    // anything but 'citizen' away regardless, but passing it at all
    // invited the reading that the client has a say. Every account starts
    // as a citizen and is promoted only by the server.
    const { data, error: err } = await client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone, language } },
    });
    if (err) throw new Error(friendlyAuthError(err));
    return data;
  }

  /**
   * Google sign-in through Supabase. Redirects away and comes back to
   * `redirectTo`, at which point detectSessionInUrl picks the session up
   * and onAuthStateChange above loads the profile.
   *
   * This grants no elevated role. A worker who signs in with Google is
   * still a citizen until she claims a roster code, which is the point:
   * the identity provider proves an email address, not an appointment to
   * a sub-centre.
   */
  async function signInWithGoogle({ redirectTo } = {}) {
    const client = requireSupabase();
    const { data, error: err } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo ?? `${window.location.origin}/app`,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (err) throw new Error(friendlyAuthError(err));
    return data;
  }

  async function signOut() {
    if (!supabase) {
      setSession(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  async function refreshProfile() {
    if (!session?.user?.id || !supabase) return null;
    try {
      const next = await loadProfile(session.user.id);
      setProfile(next);
      return next;
    } catch (e) {
      setError(e);
      return null;
    }
  }

  /**
   * Claim an ASHA roster invite code. The server verifies the code
   * against a bcrypt hash it never sends to the browser, promotes the
   * role, and binds the account to the roster row's villages. On success
   * the profile is reloaded so `isAsha` becomes true without a sign-out.
   */
  async function claimAshaCode({ ashaCode, inviteCode }) {
    const result = await authedFetch('/api/asha/claim-code', {
      method: 'POST',
      body: JSON.stringify({ ashaCode, inviteCode }),
    });
    await refreshProfile();
    return result;
  }

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      isAsha: profile?.role === 'asha' || profile?.role === 'admin',
      isAdmin: profile?.role === 'admin',
      isAuthenticated: Boolean(session?.user),
      loading: status === 'loading',
      status,
      error,
      configured: isSupabaseConfigured,
      /** The language chosen on the landing page. English unless changed. */
      language: profile?.language || 'English',
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      refreshProfile,
      claimAshaCode,
    }),
    [session, profile, status, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Supabase auth errors are written for developers. These are the ones
 * a health worker on a patchy connection will actually hit, phrased
 * so they know what to do next.
 */
function friendlyAuthError(err) {
  const m = (err?.message || '').toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match. Check them and try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account is not confirmed yet. Check your email for the confirmation link.';
  }
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'An account already exists for this email. Try signing in instead.';
  }
  if (m.includes('password') && m.includes('6')) {
    return 'Use a password of at least 6 characters.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute, then try again.';
  }
  if (m.includes('provider is not enabled')) {
    return 'Google sign-in is not switched on for this project yet. Enable the Google provider in Supabase under Authentication → Providers.';
  }
  if (m.includes('fetch') || m.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return err?.message || 'Something went wrong signing in.';
}
