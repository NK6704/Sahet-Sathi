import { admin } from "./supabaseAdmin";

/* =====================================================================
   One notification, to one person.

   The village broadcast in server/routes/notifications.ts is a
   worker deliberately composing something and being told how many people
   received it. This is the other kind: a notification the app raises by
   itself because something happened that the other party would otherwise
   only discover by opening the right screen at the right moment. A
   message sent to an ASHA worker at nine in the evening is the case that
   matters — without this, she has to remember to check.

   Two rules shape the whole file.

   The first is that this never throws. It is called after the thing it
   describes has already been written, so a failure here must not turn a
   sent message into an error the sender reads as "not sent". It reports
   `delivered: false` with a reason and lets the caller decide what to
   say. Losing a nudge is a small harm; telling somebody their message
   failed when it is sitting in the other person's inbox is a large one.

   The second is that the body carries no quoted content. A notification
   row is visible to admins under notif_admin_all, whereas thread_messages
   is readable only by the two people in the conversation. Putting a
   preview in the title would quietly move private text into a table with
   a wider audience — so these say that something arrived and where to
   read it, and nothing about what it says.

   The service role is used because the fan-out is precisely the third of
   the four jobs supabaseAdmin.ts sanctions it for: notifications.author_id
   is the sender, but the recipient row belongs to somebody else and no
   policy lets one account write a row on another's behalf.
   ===================================================================== */

export type Severity = "low" | "moderate" | "high" | "critical";
export type Verification = "verified" | "inferred" | "unverified";

export interface DirectNotification {
  /** Who caused it. Shown to the recipient as the sender. */
  authorId: string;
  /** Who receives it. */
  targetUserId: string;
  title: string;
  body: string;
  /** Free text; the citizen feed prints an unknown code as it was stored. */
  category?: string | null;
  severity?: Severity;
  /** Language the title and body are written in, as spelled in profiles.language. */
  language?: string | null;
  verification?: Verification;
  source?: string | null;
}

export interface NotifyResult {
  delivered: boolean;
  notificationId: string | null;
  /** Present only when delivered is false. Safe to show a user. */
  warning: string | null;
}

/**
 * Writes a notification addressed to one person, plus the recipient row
 * that puts it in their feed. Resolves rather than rejects on failure.
 */
export async function notifyUser(n: DirectNotification): Promise<NotifyResult> {
  if (n.authorId === n.targetUserId) {
    // Not an error worth surfacing: it means the only other party to
    // whatever happened is the person who did it, so there is nobody to
    // tell. Treated as delivered-to-nobody with no warning.
    return { delivered: false, notificationId: null, warning: null };
  }

  try {
    const db = admin();

    // audience 'user' with target_user_id set and village_id null is what
    // notifications_target_matches_audience requires; any other
    // combination is refused by the check constraint.
    const { data, error } = await db
      .from("notifications")
      .insert({
        author_id: n.authorId,
        audience: "user",
        target_user_id: n.targetUserId,
        village_id: null,
        title: n.title,
        body: n.body,
        category: n.category ?? null,
        severity: n.severity ?? "low",
        language: n.language ?? "English",
        // 'verified' is right here and is not a boast: unlike a scheme
        // description, the app watched this happen. The claim being
        // verified is only "a message arrived", which is exactly what the
        // body says.
        verification: n.verification ?? "verified",
        source: n.source ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      return {
        delivered: false,
        notificationId: null,
        warning: `Could not raise a notification: ${error?.message ?? "no row returned"}`,
      };
    }

    const notificationId = (data as { id: string }).id;

    // upsert against unique (notification_id, user_id) so a retry cannot
    // put two copies in one feed.
    const { error: recipientError } = await db
      .from("notification_recipients")
      .upsert(
        { notification_id: notificationId, user_id: n.targetUserId },
        { onConflict: "notification_id,user_id", ignoreDuplicates: true },
      );

    if (recipientError) {
      // The notification row exists but is in nobody's feed. Reported as
      // undelivered, because that is the truth: GET /notifications reads
      // through notification_recipients.
      return {
        delivered: false,
        notificationId,
        warning:
          `The notification was saved but did not reach the recipient's feed: ` +
          `${recipientError.message}`,
      };
    }

    // recipient_count and published_at move together, so the count always
    // means "this many recipient rows exist".
    await db
      .from("notifications")
      .update({ recipient_count: 1, published_at: new Date().toISOString() })
      .eq("id", notificationId);

    return { delivered: true, notificationId, warning: null };
  } catch (err: any) {
    // Includes the case where Supabase is not configured at all, which
    // admin() throws for. A missing notification must not break the
    // action that triggered it.
    return {
      delivered: false,
      notificationId: null,
      warning: `Could not raise a notification: ${err?.message ?? String(err)}`,
    };
  }
}

/**
 * The language to write a notification in, read from the recipient's own
 * profile because a nudge in a script somebody cannot read is not a nudge.
 *
 * Service role: the sender has no read access to the recipient's profiles
 * row under profiles_select_own, and this is pinned to a single id the
 * caller has already been shown to be in a conversation with, so it
 * cannot become a way to enumerate anybody. Only `language` is selected —
 * not the name, not the phone.
 *
 * Falls back to English rather than guessing. profiles.language defaults
 * to 'Hindi' in 01_schema.sql, so a person who has never chosen keeps the
 * Hindi default and only an unreadable row lands on English.
 */
export async function recipientLanguage(userId: string): Promise<string> {
  try {
    const { data, error } = await admin()
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) return "English";
    const language = (data as { language: string | null }).language;
    return typeof language === "string" && language.trim() !== "" ? language.trim() : "English";
  } catch {
    return "English";
  }
}

/** True when a profiles.language value means Hindi. */
export function wantsHindi(language: string | null | undefined): boolean {
  const value = String(language ?? "").trim().toLowerCase();
  return (
    value.startsWith("hindi") || value === "hi" || value === "hin" || value === "हिन्दी" ||
    value === "हिंदी"
  );
}
