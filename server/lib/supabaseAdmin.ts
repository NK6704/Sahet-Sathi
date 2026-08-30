import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, supabaseReady } from "./env";

/* =====================================================================
   The service-role Supabase client.

   Everything reached through this client bypasses Row Level Security, so
   the rule for using it is narrow: it is for work the database cannot
   authorise from the caller's own token, and nothing else.

   In this app that means exactly four jobs:

     - reading `asha_roster`, which has no RLS policy at all and is
       therefore invisible to every client key;
     - promoting a verified worker's role, which the guard_role_change
       trigger forbids the account holder from doing;
     - fanning a notification out into notification_recipients, one row
       per villager, which the author has no read access to;
     - recording SOS delivery attempts, including the ones that failed.

   Anything a signed-in user is allowed to do for themselves should go
   through their own token from the browser instead, so that RLS stays
   the thing being tested in production rather than a policy nobody
   exercises.
   ===================================================================== */

let cached: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!supabaseReady) {
    throw new Error(
      "Supabase is not configured on the server. Set SUPABASE_URL and " +
        "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local.",
    );
  }
  if (!cached) {
    cached = createClient(env.supabaseUrl!, env.supabaseSecretKey!, {
      auth: {
        // A server process has no session to persist and no URL to read a
        // token out of. Leaving these on causes surprising cross-request
        // state.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { "x-application-name": "sehat-sathi-server" } },
    });
  }
  return cached;
}

/**
 * A client that acts *as the caller*, carrying their bearer token so
 * every policy still applies. Preferred over `admin()` whenever the
 * operation is something the user is entitled to do themselves.
 */
export function asUser(accessToken: string): SupabaseClient {
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured on the server. Set SUPABASE_URL and " +
        "SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env.local.",
    );
  }
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-application-name": "sehat-sathi-server",
      },
    },
  });
}

/**
 * Append-only audit trail. Deliberately swallows its own errors: an
 * audit write that fails must not take down the operation it was
 * describing, but it must be visible in the log.
 */
export async function audit(entry: {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await admin()
      .from("audit_logs")
      .insert({
        actor_id: entry.actorId ?? null,
        actor_role: entry.actorRole ?? null,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        subject_id: entry.subjectId ?? null,
        detail: entry.detail ?? {},
        ip: entry.ip ?? null,
      });
  } catch (err: any) {
    console.warn("[audit] could not record %s: %s", entry.action, err?.message ?? err);
  }
}
