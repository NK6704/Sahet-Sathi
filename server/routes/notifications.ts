import { Router, type Request, type Response } from "express";
import {
  HttpError,
  handler,
  requireAsha,
  requireAuth,
  type Caller,
} from "../lib/auth";
import { admin, asUser, audit } from "../lib/supabaseAdmin";

/* =====================================================================
   Notifications — one ASHA writes, a whole village is told.

   A worker composes one message for a village she covers and every
   person registered to that village gets it. The one decision that
   shapes every handler below is that the fan-out is materialised: at
   send time the server writes one `notification_recipients` row per
   villager rather than working out the audience again at read time from
   whoever happens to live there now.

   That costs a row per person and it is worth it, because the alternative
   quietly rewrites history. If the audience were computed from
   `profiles.village_id` on every read, then a villager who moves away
   next month would stop being able to see a message she was actually
   sent, and somebody who registers tomorrow would appear to have
   received a message that predates her account. Materialised rows also
   give read state a place to live — one `read_at` per person — so "did
   anyone open it" is a question with a real answer rather than an
   estimate.

   Three places where this router had to be written against the schema
   that exists rather than the one the feature description assumed, and
   each is stated here because a caller reading the route list will
   otherwise expect something that is not there.

   The audience vocabulary is translated. `notification_audience` in
   05_platform.sql is ('village', 'user', 'all'), and the insert policy
   in 06_platform_rls.sql reserves 'all' for admins. This API speaks
   'village', 'citizen' and 'all_my_villages' instead: 'citizen' becomes
   the database's 'user', and 'all_my_villages' is not 'all' at all — it
   expands into one notification per village the worker is assigned to,
   so every stored row still names exactly one village and still has to
   pass `asha_covers_village`. A worker can therefore address everybody
   she serves without ever being able to address the state.

   A notification is stored in one language. `public.notifications` has
   one `title`, one `body` and one `language` column, and there is no
   `title_hi` or `body_hi` to put a second version in. So this endpoint
   accepts either `title` + `body` or `titleHi` + `bodyHi` and refuses a
   request carrying both, naming the limitation. Storing one half of what
   a health worker typed and answering 200 would be the worst of the
   available options: she would believe her village had been told in
   Hindi when it had not.

   There is no `action_url` column and no `sent_at` column. A supplied
   `actionUrl` is refused with an explanation rather than silently
   dropped, the same way /api/hospitals/search refuses `pincode`; and
   `published_at` is the column that records when a notification went
   out, so it is stamped together with `recipient_count` once the
   recipient rows are in and returned as `sentAt`.

   Nothing here logs a bearer token, and no phone number is read into a
   notification payload at all — the covering worker's number belongs to
   /api/asha/contact in messaging.ts, where handing it over is the whole
   point of the endpoint.
   ===================================================================== */

export const notificationsRouter = Router();

// ---------------------------------------------------------------------
// Small helpers, shaped like the ones in ashaAuth.ts so the two routers
// answer a malformed request the same way.
// ---------------------------------------------------------------------

/**
 * requireAuth has already run wherever this is called, so a missing
 * caller is a wiring mistake. It still answers 401 rather than throwing
 * a TypeError, because a 500 here would look like a database fault.
 */
function callerOf(req: Request): Caller {
  if (!req.caller) throw new HttpError(401, "Sign in to continue");
  return req.caller;
}

/** Trimmed string, or null for anything absent, blank or not a string. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres answers a malformed uuid with a 22P02, which would surface as
 * a 500. An id that is obviously not an id is a bad request.
 */
function uuid(value: unknown, label: string): string {
  const out = str(value);
  if (!out) throw new HttpError(400, `${label} is required.`);
  if (!UUID_RE.test(out)) throw new HttpError(400, `${label} is not a valid id.`);
  return out;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function boolQuery(value: unknown): boolean {
  const raw = String(Array.isArray(value) ? value[0] : (value ?? "")).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

// ---------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------

/** What a client may ask for. Translated to the database enum below. */
const API_AUDIENCES = ["village", "citizen", "all_my_villages"] as const;
type ApiAudience = (typeof API_AUDIENCES)[number];

/** The `alert_severity` enum from 01_schema.sql, in order. */
const SEVERITIES = ["low", "moderate", "high", "critical"] as const;

/**
 * Recipient rows go in 500 at a time. One statement per villager would
 * be a round trip per person, and one statement for a whole block would
 * be a request body large enough to be refused.
 */
const FANOUT_CHUNK = 500;

/**
 * Above this page size the sent-list stops counting reads per
 * notification, because the count is one query each and a page of fifty
 * would be fifty round trips before the worker sees anything.
 */
const READ_COUNT_PAGE_CEILING = 20;

/**
 * One string literal per select, not a built-up one. supabase-js infers
 * the row type from the literal and cannot read a concatenation, which
 * turns the result into an error type.
 */
const NOTIFICATION_COLUMNS =
  "id, author_id, audience, village_id, target_user_id, title, body, category, severity, language, scheme_id, camp_id, verification, source, published_at, expires_at, recipient_count, created_at";

type Row = Record<string, any>;

// ---------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------

/**
 * `title` and `body` always carry the stored text, whatever language it
 * happens to be in, so a template always has something to render.
 * `titleHi` and `bodyHi` are non-null only when the row's own `language`
 * really is Hindi. That distinction is the point: a screen in Hindi mode
 * can then tell "this message is in Hindi" apart from "this is English
 * text I am about to show on a Hindi screen", instead of assuming.
 */
function languageVariants(row: Row): Record<string, unknown> {
  const isHindi = String(row.language ?? "").toLowerCase().startsWith("hindi");
  return {
    title: row.title,
    body: row.body,
    titleHi: isHindi ? row.title : null,
    bodyHi: isHindi ? row.body : null,
    language: row.language ?? null,
  };
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

// ---------------------------------------------------------------------
// Resolving who sent a message
//
// A recipient is entitled to know the name of the worker who wrote to
// her, and cannot read it herself: profiles_select_own in 02_rls.sql
// lets an account read its own row, a citizen an ASHA already has an
// alert or referral for, and nothing else. So the name is resolved on
// the server in two steps, and if neither finds one the key is omitted
// from the payload entirely. Printing "ASHA worker" in a field a UI will
// render as a name would be inventing a person.
// ---------------------------------------------------------------------

async function resolveSenderNames(
  caller: Caller,
  rows: Array<{ author_id: string | null; village_id: string | null }>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  const authorIds = new Set(
    rows.map((r) => r.author_id).filter((id): id is string => Boolean(id)),
  );
  if (authorIds.size === 0) return names;

  const villageIds = new Set(
    rows.map((r) => r.village_id).filter((id): id is string => Boolean(id)),
  );

  // First choice, and the sanctioned one: asha_for_village is security
  // definer and 06_platform_rls.sql grants execute on it to
  // `authenticated`, so the caller's own token is enough and no service
  // role is needed. It also happens to confirm that the author really
  // does cover the village the notification names. Only full_name is
  // taken from it; the phone it also returns has no business in a feed.
  const client = asUser(caller.token);
  for (const villageId of villageIds) {
    const { data, error } = await client.rpc("asha_for_village", {
      p_village_id: villageId,
    });
    // A failed lookup leaves the name unresolved, which the payload
    // reports by omission. It is not worth failing a whole feed over.
    if (error) continue;
    for (const worker of (data ?? []) as Row[]) {
      const id = worker.asha_user_id as string | null;
      const name = str(worker.full_name);
      if (id && name && authorIds.has(id)) names.set(id, name);
    }
  }

  // Anything still unresolved: a notification addressed to one person
  // carries no village_id, and a worker may have been unassigned from
  // the village since she wrote. The service role is used here because
  // the caller genuinely cannot read these rows under any policy, and
  // the lookup is pinned to the exact author ids of notifications this
  // caller was actually sent — it can never become a way to enumerate
  // profiles. Only id and full_name are selected.
  const unresolved = [...authorIds].filter((id) => !names.has(id));
  if (unresolved.length > 0) {
    const { data } = await admin()
      .from("profiles")
      .select("id, full_name")
      .in("id", unresolved);
    for (const profile of (data ?? []) as Row[]) {
      const name = str(profile.full_name);
      if (name) names.set(profile.id as string, name);
    }
  }

  return names;
}

// =====================================================================
// POST /asha/notifications — write once, tell a village
// =====================================================================

interface ComposedText {
  title: string;
  body: string;
  language: string;
}

/**
 * Reads the two language pairs and returns the one that will be stored.
 * Every failure here names the field that is missing, so the worker is
 * never left guessing which half of the form was empty.
 */
function composeText(body: Record<string, unknown>): ComposedText {
  const title = str(body.title);
  const text = str(body.body);
  const titleHi = str(body.titleHi);
  const textHi = str(body.bodyHi);

  if (title && !text) throw new HttpError(400, "body is required when you send title.");
  if (text && !title) throw new HttpError(400, "title is required when you send body.");
  if (titleHi && !textHi) {
    throw new HttpError(400, "bodyHi is required when you send titleHi.");
  }
  if (textHi && !titleHi) {
    throw new HttpError(400, "titleHi is required when you send bodyHi.");
  }
  if (!title && !titleHi) {
    throw new HttpError(
      400,
      "Send either title and body, or titleHi and bodyHi. A notification with " +
        "no text cannot be sent.",
    );
  }

  // Refused rather than half-stored. See the note in the file header:
  // the table holds one title, one body and one language, so accepting
  // both pairs would mean dropping one of them and telling her it went.
  if (title && titleHi) {
    throw new HttpError(
      400,
      "Send one language, not both. A notification row holds a single title, " +
        "a single body and a single language, so there is nowhere to keep a " +
        "second version and half of what you typed would be discarded. Send " +
        "title and body, or titleHi and bodyHi.",
    );
  }

  return title
    ? { title, body: text!, language: "English" }
    : { title: titleHi!, body: textHi!, language: "Hindi" };
}

/**
 * The recipient list for one village, and the rows to prove it. Runs
 * with the service role because the author has no read access to other
 * villagers' profiles — profiles_select_own in 02_rls.sql scopes a
 * worker to her own row plus citizens she already holds an alert or
 * referral for — so a village-wide recipient list can only be built
 * server-side. This is the same job supabaseAdmin.ts names as one of the
 * four sanctioned uses of the service key.
 */
async function fanOutToVillage(
  notificationId: string,
  villageId: string,
  authorId: string,
): Promise<{ count: number; warning?: string }> {
  const db = admin();

  const { data: villagers, error } = await db
    .from("profiles")
    .select("id")
    // The author is left out on purpose. A worker broadcasting to her
    // own village should not find her own message in her feed; anybody
    // else living there is a resident and is included.
    .eq("village_id", villageId)
    .neq("id", authorId);

  if (error) {
    throw new HttpError(
      500,
      `The notification was saved but the recipient list could not be built: ${error.message}`,
    );
  }

  const ids = ((villagers ?? []) as Row[]).map((row) => row.id as string);
  return writeRecipients(notificationId, ids);
}

async function writeRecipients(
  notificationId: string,
  userIds: string[],
): Promise<{ count: number; warning?: string }> {
  const db = admin();
  let written = 0;

  for (let i = 0; i < userIds.length; i += FANOUT_CHUNK) {
    const chunk = userIds
      .slice(i, i + FANOUT_CHUNK)
      .map((userId) => ({ notification_id: notificationId, user_id: userId }));

    // upsert rather than insert, against unique (notification_id,
    // user_id), so a retried fan-out cannot give one person two copies.
    const { error } = await db
      .from("notification_recipients")
      .upsert(chunk, { onConflict: "notification_id,user_id", ignoreDuplicates: true });

    if (error) {
      // A partial fan-out is reported truthfully rather than raised. The
      // notification row exists and some people have it, and the worker
      // needs to know both of those things; a 500 here would leave her
      // unable to tell whether anything went out at all.
      return {
        count: written,
        warning:
          `Only ${written} of ${userIds.length} recipients could be recorded ` +
          `(${error.message}). The people counted above have the message; the ` +
          `rest do not. Do not assume the village has been told.`,
      };
    }
    written += chunk.length;
  }

  return { count: written };
}

/** Stamps the count and the publish time together so the two agree. */
async function stampSent(notificationId: string, count: number): Promise<string> {
  const sentAt = new Date().toISOString();
  // published_at is the column that records when a notification went
  // out; there is no sent_at on this table. It is re-stamped here rather
  // than left at its insert default so that it means "the recipient rows
  // exist" rather than "the row was created", and it moves in the same
  // statement as recipient_count so the two can never disagree.
  const { error } = await admin()
    .from("notifications")
    .update({ recipient_count: count, published_at: sentAt })
    .eq("id", notificationId);

  if (error) {
    throw new HttpError(
      500,
      `The notification was sent to ${count} people but the count could not be ` +
        `recorded: ${error.message}`,
    );
  }
  return sentAt;
}

function emptyVillageNote(villageCount: number): string {
  const where = villageCount > 1 ? "any of those villages" : "that village";
  return (
    `Saved, but nobody received it: no resident of ${where} has registered on ` +
    `Sehat Sathi yet, so there was no one to send it to. The message reached ` +
    `nobody. It will not be delivered to people who register later, because a ` +
    `notification is sent to the people who were registered at the time.`
  );
}

notificationsRouter.post(
  "/asha/notifications",
  requireAsha,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Refused rather than ignored, following /api/hospitals/search: a
    // parameter that appears to be accepted and then does nothing is
    // worse than one that is turned down with a reason.
    if (body.actionUrl !== undefined) {
      throw new HttpError(
        400,
        "There is no action_url column on notifications, so a link cannot be " +
          "stored and this endpoint will not pretend to have kept one. Use " +
          "schemeId or campId to point at a real record instead.",
      );
    }
    if (body.verification !== undefined) {
      throw new HttpError(
        400,
        "verification cannot be set here. A broadcast is a worker's own words " +
          "and nothing in this endpoint checks them, so it is stored as " +
          "'unverified' and the app is expected to say so on screen.",
      );
    }

    const audience = (str(body.audience) ?? "village") as ApiAudience;
    if (!API_AUDIENCES.includes(audience)) {
      throw new HttpError(
        400,
        `audience must be one of ${API_AUDIENCES.join(", ")}.`,
      );
    }

    const text = composeText(body);

    const severity = str(body.severity) ?? "low";
    if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
      throw new HttpError(400, `severity must be one of ${SEVERITIES.join(", ")}.`);
    }

    let expiresAt: string | null = null;
    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      const raw = str(body.expiresAt);
      const at = raw ? Date.parse(raw) : Number.NaN;
      if (!Number.isFinite(at)) {
        throw new HttpError(400, "expiresAt must be a date and time this app can read.");
      }
      if (at <= Date.now()) {
        throw new HttpError(
          400,
          "expiresAt is in the past, so this notification would arrive already " +
            "expired. Leave it out if the message does not expire.",
        );
      }
      expiresAt = new Date(at).toISOString();
    }

    // --- the one target column the CHECK constraint requires ---------
    //
    // notifications_target_matches_audience in 05_platform.sql insists
    // that a 'village' row has village_id and no target_user_id, and a
    // 'user' row the reverse. Every mismatch is caught here and named,
    // because a raw 23514 from Postgres tells a worker nothing she can
    // act on.
    let villageIds: string[] = [];
    let targetUserId: string | null = null;

    if (audience === "village") {
      if (body.citizenId !== undefined && body.citizenId !== null) {
        throw new HttpError(
          400,
          "citizenId does not belong on a village broadcast. Use audience " +
            "'citizen' to write to one person.",
        );
      }
      villageIds = [uuid(body.villageId, "villageId")];
    } else if (audience === "citizen") {
      if (body.villageId !== undefined && body.villageId !== null) {
        throw new HttpError(
          400,
          "villageId does not belong on a message to one person. Use audience " +
            "'village' to broadcast.",
        );
      }
      targetUserId = uuid(body.citizenId, "citizenId");
    } else {
      if (
        (body.villageId !== undefined && body.villageId !== null) ||
        (body.citizenId !== undefined && body.citizenId !== null)
      ) {
        throw new HttpError(
          400,
          "audience 'all_my_villages' takes neither villageId nor citizenId. " +
            "The villages are read from your own assignment.",
        );
      }

      // Read as herself: asha_villages_select scopes this to
      // asha_user_id = auth.uid(), so her token is the right key and the
      // list cannot include a village she does not cover.
      const { data, error } = await asUser(caller.token)
        .from("asha_villages")
        .select("village_id, is_primary")
        .eq("asha_user_id", caller.id)
        .order("is_primary", { ascending: false });

      if (error) {
        throw new HttpError(500, `Could not read your villages: ${error.message}`);
      }
      villageIds = ((data ?? []) as Row[]).map((row) => row.village_id as string);

      if (villageIds.length === 0) {
        throw new HttpError(
          409,
          "No village is mapped to your account in asha_villages, so there is " +
            "nobody you are authorised to address yet. Ask your block office or " +
            "an admin to assign your villages, then try again.",
        );
      }
    }

    // --- insert, then fan out ----------------------------------------
    const targets: Array<{ villageId: string | null }> =
      audience === "citizen"
        ? [{ villageId: null }]
        : villageIds.map((villageId) => ({ villageId }));

    const client = asUser(caller.token);
    const sent: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    let totalRecipients = 0;

    for (const target of targets) {
      // Inserted as the worker, deliberately. notifications_insert in
      // 06_platform_rls.sql is what checks asha_covers_village, so a
      // worker posting a village id that is not hers is refused by the
      // database rather than filtered out here afterwards. Doing this
      // with the service role would leave that policy untested in
      // production, which is the one place it matters.
      const { data, error } = await client
        .from("notifications")
        .insert({
          author_id: caller.id,
          // The database enum is ('village', 'user', 'all'); 'all' is
          // admin-only, and 'all_my_villages' became one 'village' row
          // per village above rather than an 'all' row.
          audience: audience === "citizen" ? "user" : "village",
          village_id: target.villageId,
          target_user_id: targetUserId,
          title: text.title,
          body: text.body,
          language: text.language,
          category: str(body.category),
          severity,
          scheme_id: str(body.schemeId),
          camp_id: str(body.campId),
          source: str(body.source),
          expires_at: expiresAt,
        })
        .select(NOTIFICATION_COLUMNS)
        .single();

      if (error) {
        if (error.code === "42501") {
          throw new HttpError(
            403,
            targetUserId
              ? "The database refused this message. You may only write to " +
                  "someone living in a village you are assigned to."
              : "The database refused this broadcast. You may only address a " +
                  "village you are assigned to in asha_villages.",
          );
        }
        if (error.code === "23503") {
          // A foreign key, most often scheme_id or camp_id. This is the
          // constraint that stops a broadcast citing a scheme that does
          // not exist, so it is surfaced as a bad request rather than a
          // server fault.
          throw new HttpError(
            400,
            "One of villageId, citizenId, schemeId or campId does not match a " +
              "row in the database. Nothing was sent.",
          );
        }
        if (error.code === "23514") {
          throw new HttpError(
            400,
            "That combination of audience and target was refused by the " +
              "notifications_target_matches_audience constraint. A village " +
              "broadcast needs villageId alone; a message to one person needs " +
              "citizenId alone.",
          );
        }
        throw new HttpError(500, `Could not save the notification: ${error.message}`);
      }

      const notification = data as Row;
      const fan = target.villageId
        ? await fanOutToVillage(notification.id, target.villageId, caller.id)
        : await writeRecipients(notification.id, [targetUserId!]);

      if (fan.warning) warnings.push(fan.warning);
      const sentAt = await stampSent(notification.id, fan.count);
      totalRecipients += fan.count;

      sent.push({
        id: notification.id,
        audience: notification.audience,
        villageId: notification.village_id ?? null,
        targetUserId: notification.target_user_id ?? null,
        ...languageVariants(notification),
        category: notification.category ?? null,
        severity: notification.severity,
        schemeId: notification.scheme_id ?? null,
        campId: notification.camp_id ?? null,
        verification: notification.verification,
        source: notification.source ?? null,
        expiresAt: notification.expires_at ?? null,
        recipientCount: fan.count,
        sentAt,
      });
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "notification.broadcast",
      entity: "notifications",
      entityId: sent.length === 1 ? (sent[0].id as string) : null,
      subjectId: targetUserId,
      detail: {
        api_audience: audience,
        notification_ids: sent.map((n) => n.id),
        village_ids: villageIds,
        recipient_count: totalRecipients,
        language: text.language,
        category: str(body.category),
        severity,
        title: text.title,
        partial: warnings.length > 0,
      },
      ip: req.ip ?? null,
    });

    // 200 rather than 201 throughout. The row exists either way, and the
    // answer that matters is how many people were actually told, so the
    // caller is meant to read recipientCount rather than infer delivery
    // from the status line.
    res.json({
      ok: true,
      audience,
      language: text.language,
      notifications: sent,
      recipientCount: totalRecipients,
      ...(totalRecipients === 0 && targetUserId === null
        ? { note: emptyVillageNote(villageIds.length) }
        : {}),
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
    });
  }),
);

// =====================================================================
// GET /notifications — the caller's own feed
// =====================================================================

notificationsRouter.get(
  "/notifications",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const client = asUser(caller.token);

    const unreadOnly = boolQuery(req.query.unreadOnly);
    const page = intQuery(req.query.page, 1, 1, 10000);
    const size = intQuery(req.query.size, 20, 1, 50);
    const from = (page - 1) * size;

    // Read as the caller. notif_recipients_select scopes this to
    // user_id = auth.uid() already; the explicit filter is here so a
    // future policy change cannot widen this endpoint by accident.
    //
    // The join is an inner one because a recipient row without its
    // notification is meaningless, and the ordering is on the recipient
    // row's created_at rather than the notification's published_at: that
    // is the column idx_notif_recipients_unread covers, and it is the
    // honest answer to "when was I told".
    let query = client
      .from("notification_recipients")
      .select(
        "id, notification_id, read_at, created_at, notifications!inner ( id, author_id, audience, village_id, title, body, category, severity, language, scheme_id, camp_id, verification, source, published_at, expires_at )",
        { count: "exact" },
      )
      .eq("user_id", caller.id)
      .order("created_at", { ascending: false })
      .range(from, from + size - 1);

    if (unreadOnly) query = query.is("read_at", null);

    const { data, error, count } = await query;
    if (error) {
      throw new HttpError(500, `Could not load your notifications: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];

    // A separate cheap count, because `count` above is the number of
    // rows matching the current filter and would equal the page total
    // when unreadOnly is on.
    const { count: unreadCount, error: unreadError } = await client
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("user_id", caller.id)
      .is("read_at", null);

    if (unreadError) {
      throw new HttpError(500, `Could not count unread notifications: ${unreadError.message}`);
    }

    const senderNames = await resolveSenderNames(
      caller,
      rows.map((row) => ({
        author_id: row.notifications?.author_id ?? null,
        village_id: row.notifications?.village_id ?? null,
      })),
    );

    const notifications = rows.map((row) => {
      const n = (row.notifications ?? {}) as Row;
      const senderName = n.author_id ? senderNames.get(n.author_id as string) : undefined;

      return {
        id: row.id,
        notificationId: row.notification_id,
        ...languageVariants(n),
        category: n.category ?? null,
        severity: n.severity ?? null,
        audience: n.audience ?? null,
        villageId: n.village_id ?? null,
        schemeId: n.scheme_id ?? null,
        campId: n.camp_id ?? null,
        verification: n.verification ?? null,
        source: n.source ?? null,
        publishedAt: n.published_at ?? null,
        expiresAt: n.expires_at ?? null,
        expired: isExpired(n.expires_at ?? null),
        readAt: row.read_at ?? null,
        receivedAt: row.created_at,
        // The key is absent, not null and not a placeholder, when the
        // sender's name could not be resolved. Nothing renders what it
        // cannot find, and "ASHA worker" is not a name.
        ...(senderName ? { senderName } : {}),
      };
    });

    res.json({
      notifications,
      unreadCount: unreadCount ?? 0,
      count: count ?? 0,
      page,
      size,
      ...(notifications.length === 0
        ? {
            note: unreadOnly
              ? "Nothing is unread."
              : "You have no notifications yet. Messages appear here when the " +
                "ASHA worker for your village sends one, so an empty list means " +
                "none has been sent rather than that something failed.",
          }
        : {}),
    });
  }),
);

// =====================================================================
// GET /notifications/unread-count — for a badge
//
// Declared before /notifications/:id/read is irrelevant (different verb
// and shape), but kept next to the feed because it answers the same
// question more cheaply: a head request with an exact count and no rows
// crossing the wire.
// =====================================================================

notificationsRouter.get(
  "/notifications/unread-count",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const { count, error } = await asUser(caller.token)
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("user_id", caller.id)
      .is("read_at", null);

    if (error) {
      throw new HttpError(500, `Could not count unread notifications: ${error.message}`);
    }

    res.json({ unreadCount: count ?? 0 });
  }),
);

// =====================================================================
// POST /notifications/:id/read
// =====================================================================

notificationsRouter.post(
  "/notifications/:id/read",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const notificationId = uuid(req.params.id, "Notification id");
    const client = asUser(caller.token);

    // Written as the caller, leaning on the column-level
    // `grant update (read_at)` from 06_platform_rls.sql. Table-level
    // update is revoked from `authenticated`, so this statement can only
    // ever touch read_at — RLS alone cannot restrict a policy to one
    // column, and the grant is what does it.
    const { data, error } = await client
      .from("notification_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("notification_id", notificationId)
      .eq("user_id", caller.id)
      .is("read_at", null)
      .select("id, notification_id, read_at")
      .maybeSingle();

    if (error) {
      if (error.code === "42501") {
        throw new HttpError(403, "You can only mark your own notifications read.");
      }
      throw new HttpError(500, `Could not mark that read: ${error.message}`);
    }

    if (data) {
      res.json({
        ok: true,
        notificationId,
        readAt: (data as Row).read_at,
        alreadyRead: false,
      });
      return;
    }

    // Nothing was updated, which means either the row was already read
    // or it was never sent to this person. Idempotent for the first and
    // a plain 404 for the second.
    const { data: existing, error: lookupError } = await client
      .from("notification_recipients")
      .select("id, read_at")
      .eq("notification_id", notificationId)
      .eq("user_id", caller.id)
      .maybeSingle();

    if (lookupError) {
      throw new HttpError(500, `Could not check that notification: ${lookupError.message}`);
    }
    if (!existing) {
      throw new HttpError(
        404,
        "That notification was not sent to you, so there is nothing to mark read.",
      );
    }

    res.json({
      ok: true,
      notificationId,
      readAt: (existing as Row).read_at,
      alreadyRead: true,
    });
  }),
);

// =====================================================================
// POST /notifications/read-all
// =====================================================================

notificationsRouter.post(
  "/notifications/read-all",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const { data, error } = await asUser(caller.token)
      .from("notification_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", caller.id)
      .is("read_at", null)
      .select("id");

    if (error) {
      if (error.code === "42501") {
        throw new HttpError(403, "You can only mark your own notifications read.");
      }
      throw new HttpError(500, `Could not mark them read: ${error.message}`);
    }

    const marked = ((data ?? []) as Row[]).length;
    res.json({
      ok: true,
      marked,
      unreadCount: 0,
      ...(marked === 0 ? { note: "Nothing was unread." } : {}),
    });
  }),
);

// =====================================================================
// GET /asha/notifications — what she has sent, and whether it landed
// =====================================================================

notificationsRouter.get(
  "/asha/notifications",
  requireAsha,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const page = intQuery(req.query.page, 1, 1, 10000);
    const size = intQuery(req.query.size, 20, 1, 50);
    const from = (page - 1) * size;

    // Read as herself. notifications_select already grants an author her
    // own rows, and villages_read grants every signed-in user the
    // village names, so the embed needs no service role either.
    const { data, error, count } = await asUser(caller.token)
      .from("notifications")
      .select(
        "id, audience, village_id, target_user_id, title, body, category, severity, language, scheme_id, camp_id, verification, source, published_at, expires_at, recipient_count, created_at, villages ( id, name, block, district, state )",
        { count: "exact" },
      )
      .eq("author_id", caller.id)
      .order("published_at", { ascending: false })
      .range(from, from + size - 1);

    if (error) {
      throw new HttpError(500, `Could not load what you have sent: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];

    // One count query per notification, so it is only done for a page
    // small enough to make that reasonable. Above the ceiling the field
    // is left out and readCountsOmitted says so, rather than a zero
    // being shown as if nobody had opened the message.
    const readCountsOmitted = size > READ_COUNT_PAGE_CEILING;
    const readCounts = new Map<string, number>();

    if (!readCountsOmitted && rows.length > 0) {
      // Service role, because the author cannot see this. The
      // notif_recipients_select policy scopes that table to
      // user_id = auth.uid(), so under her own token a worker can read
      // her own recipient rows and nobody else's — the number of
      // villagers who opened her broadcast is only answerable
      // server-side.
      const db = admin();
      await Promise.all(
        rows.map(async (row) => {
          const { count: read } = await db
            .from("notification_recipients")
            .select("id", { count: "exact", head: true })
            .eq("notification_id", row.id)
            .not("read_at", "is", null);
          readCounts.set(row.id as string, read ?? 0);
        }),
      );
    }

    const notifications = rows.map((row) => {
      const village = (row.villages ?? null) as Row | null;
      const recipientCount = Number(row.recipient_count ?? 0);
      const readCount = readCounts.get(row.id as string);

      return {
        id: row.id,
        audience: row.audience,
        villageId: row.village_id ?? null,
        village: village
          ? {
              id: village.id,
              name: village.name ?? null,
              block: village.block ?? null,
              district: village.district ?? null,
              state: village.state ?? null,
            }
          : null,
        targetUserId: row.target_user_id ?? null,
        ...languageVariants(row),
        category: row.category ?? null,
        severity: row.severity,
        schemeId: row.scheme_id ?? null,
        campId: row.camp_id ?? null,
        verification: row.verification,
        source: row.source ?? null,
        sentAt: row.published_at ?? null,
        expiresAt: row.expires_at ?? null,
        expired: isExpired(row.expires_at ?? null),
        recipientCount,
        ...(readCount === undefined ? {} : { readCount }),
        // Only stated when the read count is actually known. A worker
        // reading "0 of 0 opened" for a broadcast that reached nobody
        // should see the recipient count as the reason.
        ...(readCount === undefined || recipientCount === 0
          ? {}
          : { unreadByRecipients: Math.max(recipientCount - readCount, 0) }),
      };
    });

    // One note key, assembled rather than spread twice: two conditional
    // spreads both carrying `note` would silently let the later one win.
    const notes: string[] = [];
    if (notifications.length === 0) {
      notes.push("You have not sent any notifications yet.");
    }
    if (readCountsOmitted) {
      notes.push(
        `Read counts are one query each, so they are only computed for pages of ` +
          `${READ_COUNT_PAGE_CEILING} or fewer. Ask for a smaller size to see how ` +
          `many people opened each message.`,
      );
    }

    res.json({
      notifications,
      count: count ?? 0,
      page,
      size,
      readCountsOmitted,
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    });
  }),
);

// =====================================================================
// DELETE /asha/notifications/:id — unsend, but only while it is unread
// =====================================================================

notificationsRouter.delete(
  "/asha/notifications/:id",
  requireAsha,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const notificationId = uuid(req.params.id, "Notification id");

    // Authorship is established through her own token first, so the
    // service role below is only ever pointed at a row she is allowed to
    // see. notifications_select grants an author her own rows.
    const { data: existing, error: lookupError } = await asUser(caller.token)
      .from("notifications")
      .select("id, author_id, village_id, title, audience, recipient_count")
      .eq("id", notificationId)
      .eq("author_id", caller.id)
      .maybeSingle();

    if (lookupError) {
      throw new HttpError(500, `Could not read that notification: ${lookupError.message}`);
    }
    if (!existing) {
      throw new HttpError(
        404,
        "No notification of yours has that id. You can only withdraw a message " +
          "you wrote yourself.",
      );
    }

    // Service role, because the author cannot count other people's read
    // state under notif_recipients_select. This is the check the whole
    // endpoint turns on, so it has to be able to see the real number.
    const { count: readCount, error: countError } = await admin()
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", notificationId)
      .not("read_at", "is", null);

    if (countError) {
      throw new HttpError(500, `Could not check who has read it: ${countError.message}`);
    }

    if ((readCount ?? 0) > 0) {
      throw new HttpError(
        409,
        `${readCount} ${(readCount ?? 0) === 1 ? "person has" : "people have"} ` +
          "already read this, so it cannot be unsent. Deleting it now would " +
          "remove a message people have seen and leave them with no record of " +
          "what they were told. Send a correction instead.",
      );
    }

    // The service role again, and for a different reason worth naming:
    // 06_platform_rls.sql creates select, insert and update policies on
    // notifications and no delete policy at all, so with RLS on there is
    // no row any client key can delete. The database has no policy that
    // could authorise this, which is why the author check above is done
    // by hand before the key is used. The author_id filter is repeated
    // on the statement itself as a second guard.
    const { error: deleteError } = await admin()
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .eq("author_id", caller.id);

    if (deleteError) {
      throw new HttpError(500, `Could not withdraw that notification: ${deleteError.message}`);
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "notification.withdrawn",
      entity: "notifications",
      entityId: notificationId,
      detail: {
        village_id: (existing as Row).village_id ?? null,
        audience: (existing as Row).audience,
        title: (existing as Row).title,
        recipient_count: Number((existing as Row).recipient_count ?? 0),
        read_count: readCount ?? 0,
      },
      ip: req.ip ?? null,
    });

    res.json({
      ok: true,
      id: notificationId,
      // notification_recipients references notifications on delete
      // cascade, so the recipient rows went with it. Saying how many is
      // more useful than an unqualified "deleted".
      recipientsRemoved: Number((existing as Row).recipient_count ?? 0),
      note:
        "Withdrawn. Nobody had opened it, and the recipient rows were removed " +
        "with it, so it will not appear in anyone's feed.",
    });
  }),
);
