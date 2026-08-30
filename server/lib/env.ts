/* =====================================================================
   Environment, in one place.

   Two reasons this file exists rather than reading process.env inline
   at each use site:

   1. The same secret arrives under different names depending on where
      it was copied from. Supabase's dashboard now issues
      `sb_publishable_…` / `sb_secret_…` keys and labels them
      "publishable" and "secret", while older projects and most tutorials
      say "anon" and "service role". Both spellings are accepted here so
      a working .env does not depend on which era of the docs somebody
      read.

   2. `describeConfig()` gives /api/health a truthful account of what is
      wired without ever printing a secret. During a demo the question is
      always "is it actually connected?", and guessing is worse than
      looking.
   ===================================================================== */

function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const env = {
  // --- Supabase ------------------------------------------------------
  supabaseUrl: pick("SUPABASE_URL", "VITE_SUPABASE_URL"),

  /** Safe in a browser. RLS is what protects the data, not this key. */
  supabasePublishableKey: pick(
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  ),

  /**
   * Bypasses every RLS policy. Server process only — if this ever
   * appears in a VITE_-prefixed variable it ships to the browser and the
   * database is effectively public.
   */
  supabaseSecretKey: pick("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),

  /** Public signing keys for local token verification. */
  supabaseJwksUrl: pick("SUPABASE_JWKS_URL"),

  // --- Gemini --------------------------------------------------------
  /**
   * Text assistant and the Live voice session. Kept separate from the
   * prescription key on purpose: the user asked for the load spread
   * across two keys so one quota cannot starve both features.
   */
  geminiApiKey: pick("GEMINI_API_KEY"),

  /** Prescription reading only. Falls back to the primary key. */
  geminiPrescriptionKey:
    pick("GEMINI_PRESCRIPTION_API_KEY", "GEMINI_API_KEY_PRESCRIPTION") ??
    pick("GEMINI_API_KEY"),

  // --- Twilio --------------------------------------------------------
  /**
   * An API Key SID (`SK…`) authenticates as a username, but the REST
   * path still needs the Account SID (`AC…`). Having one without the
   * other is a common half-configured state, so the SMS adapter reports
   * it explicitly instead of failing at send time.
   */
  twilioAccountSid: pick("TWILIO_ACCOUNT_SID"),
  twilioApiKeySid: pick("TWILIO_API_KEY_SID", "TWILIO_SID"),
  twilioApiKeySecret: pick("TWILIO_API_KEY_SECRET", "TWILIO_CLIENT_SECRET"),
  twilioFromNumber: pick("TWILIO_FROM_NUMBER", "TWILIO_PHONE_NUMBER"),
  twilioMessagingServiceSid: pick("TWILIO_MESSAGING_SERVICE_SID"),

  appUrl: pick("APP_URL") ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",
};

export const supabaseReady = Boolean(env.supabaseUrl && env.supabaseSecretKey);

/**
 * Twilio needs four things to send one SMS: an Account SID, an API key
 * pair, and a sender. `missing` lists exactly which are absent so the
 * delivery record can name the reason rather than logging "failed".
 */
export function twilioStatus(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!env.twilioAccountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!env.twilioApiKeySid) missing.push("TWILIO_API_KEY_SID");
  if (!env.twilioApiKeySecret) missing.push("TWILIO_API_KEY_SECRET");
  if (!env.twilioFromNumber && !env.twilioMessagingServiceSid) {
    missing.push("TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID");
  }
  return { ready: missing.length === 0, missing };
}

/** Never returns a secret — only whether one is present. */
export function describeConfig() {
  const twilio = twilioStatus();
  return {
    supabase: {
      configured: supabaseReady,
      url: env.supabaseUrl ?? null,
      publishableKey: Boolean(env.supabasePublishableKey),
      secretKey: Boolean(env.supabaseSecretKey),
      jwks: Boolean(env.supabaseJwksUrl),
    },
    gemini: {
      assistant: Boolean(env.geminiApiKey),
      prescription: Boolean(env.geminiPrescriptionKey),
      separateKeys:
        Boolean(env.geminiPrescriptionKey) &&
        env.geminiPrescriptionKey !== env.geminiApiKey,
    },
    sms: {
      ready: twilio.ready,
      provider: twilio.ready ? "twilio" : null,
      missing: twilio.missing,
    },
  };
}
