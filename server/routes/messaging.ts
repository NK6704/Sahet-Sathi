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
   Messaging — a citizen and the ASHA worker who covers her village.

   Two things live here. A contact card, so somebody with a sick child at
   nine in the evening can read the covering worker's name and phone and
   simply ring her; and a thread, so a question that is not an emergency
   can be asked in writing and answered when the worker is next on her
   phone.

   The decision that shapes this file is how the contact lookup gets a
   phone number out of a table the caller cannot read.

   `profiles_select_own` in 02_rls.sql lets an account read its own row,
   lets a worker read a citizen she already holds an alert or referral
   for, and lets nobody read anything else. A citizen therefore has no
   read access to any ASHA worker's profile, which is the correct default
   — the alternative is an app where anybody who signs up can enumerate
   every health worker in the state along with her mobile number.

   `public.asha_for_village()` exists to make exactly one hole in that,
   of exactly the right size. It is `security definer`, so it runs with
   the privileges of its owner rather than the caller's, and it returns
   six columns and no more: the worker's user id, name, phone, ASHA code,
   sub-centre and whether the posting is her primary one. Execute is
   granted to `authenticated` and revoked from `anon` in
   06_platform_rls.sql. A signed-in villager can ask "who covers this
   village" and gets an answer; she cannot ask "list every worker", and
   she is never handed a profiles row.

   Because the grant exists, these handlers call the function with the
   caller's own token rather than the service role. That is the standing
   rule in supabaseAdmin.ts — the service key is for work the database
   cannot authorise from the caller's token — and it has a practical
   edge too: a grant that only the server ever exercises is a grant
   nobody notices has been dropped. The service role is used in exactly
   one place below, to read the display name of the person on the other
   side of a thread the caller is already in, and the comment there says
   why.

   Two standing rules. A phone number is never written to a log, an audit
   detail or an error message, and neither is a token. And when there is
   no worker mapped to a village the answer is a 200 carrying
   `asha: null` and a sentence explaining that, never a 404 and never a
   worker from somewhere else — "no worker is mapped to your village" and
   "no worker exists" are different claims, and substituting a
   neighbouring village's worker would send somebody to a stranger who
   has no duty of care for her household.
   ===================================================================== */

export const messagingRouter = Router();

// ---------------------------------------------------------------------
// Small helpers, matching ashaAuth.ts so a malformed request is answered
// the same way across the server.
// ---------------------------------------------------------------------

function callerOf(req: Request): Caller {
  if (!req.caller) throw new HttpError(401, "Sign in to continue");
  return req.caller;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown, label: string): string {
  const out = str(value);
  if (!out) throw new HttpError(400, `${label} is required.`);
  if (!UUID_RE.test(out)) throw new HttpError(400, `${label} is not a valid id.`);
  return out;
}

/** Optional id: null when absent, validated when present. */
function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, label);
}

function firstValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(firstValue(value) ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

/** The check constraint on thread_messages.body, restated as a limit. */
const MAX_MESSAGE_CHARS = 2000;

/** How much of the last message goes into an inbox preview. */
const PREVIEW_CHARS = 160;

/**
 * The 104 health helpline is the verified national alternative when no
 * worker is mapped to a village. It is the only phone number this file
 * ever produces from itself; every other number comes out of the
 * database through asha_for_village.
 */
const HELPLINE = {
  number: "104",
  label: "National health helpline",
} as const;

/**
 * A worker with more threads than this has the counts on her portal
 * header computed from a bounded scan, and the response says so rather
 * than presenting a truncated number as exact.
 */
const THREAD_SCAN_LIMIT = 1000;

/**
 * Unread counts for the inbox come from one bounded query rather than
 * one per thread. A backlog larger than this is not a real state, but if
 * it ever happened the response flags the numbers as approximate instead
 * of quietly under-reporting.
 */
const UNREAD_SCAN_LIMIT = 5000;

const THREAD_COLUMNS =
  "id, citizen_id, asha_id, village_id, subject, last_message_at, closed, created_at";

const MESSAGE_COLUMNS = "id, thread_id, sender_id, body, attachment_path, read_at, created_at";

const VILLAGE_COLUMNS = "id, name, block, district, state";

type Row = Record<string, any>;

// ---------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------

function shapeWorker(row: Row): Record<string, unknown> {
  return {
    userId: row.asha_user_id,
    fullName: str(row.full_name),
    // The number comes straight out of asha_for_village and is handed to
    // the caller because reaching her is the point. It is not logged, not
    // audited and not echoed in any error message.
    phone: str(row.phone),
    ashaCode: str(row.asha_code),
    subCentre: str(row.sub_centre),
    isPrimary: row.is_primary === true,
  };
}

function shapeVillage(row: Row | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? null,
    block: row.block ?? null,
    district: row.district ?? null,
    state: row.state ?? null,
  };
}

function shapeThread(row: Row, callerId: string): Record<string, unknown> {
  const iAmCitizen = row.citizen_id === callerId;
  return {
    id: row.id,
    citizenId: row.citizen_id,
    ashaId: row.asha_id,
    villageId: row.village_id ?? null,
    subject: row.subject ?? null,
    closed: row.closed === true,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    // Which side of the conversation the caller is on, so a shared inbox
    // component does not have to work it out from ids.
    mySide: iAmCitizen ? "citizen" : "asha",
    counterpartyId: iAmCitizen ? row.asha_id : row.citizen_id,
  };
}

function shapeMessage(row: Row, callerId: string): Record<string, unknown> {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    mine: row.sender_id === callerId,
    body: row.body,
    attachmentPath: row.attachment_path ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Display names for the people on the other side of the caller's own
 * threads.
 *
 * This is the one service-role read in the file. Neither direction works
 * from the caller's token: a citizen can read no worker's profile at
 * all, and `asha_serves()` only lets a worker read a citizen she already
 * has an alert or a referral for, so a household that has only ever sent
 * her a message is invisible to her under RLS. Somebody who is already a
 * participant in a thread is plainly entitled to see who they are
 * talking to, and the lookup is pinned to the counterparty ids of that
 * caller's own threads, so it cannot become a way to enumerate profiles.
 * Only id and full_name are selected — no phone, and nothing else.
 */
async function resolveNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return names;

  const { data } = await admin().from("profiles").select("id, full_name").in("id", wanted);
  for (const row of (data ?? []) as Row[]) {
    const name = str(row.full_name);
    if (name) names.set(row.id as string, name);
  }
  return names;
}

/**
 * The covering workers for a village, primary posting first. Called with
 * the caller's own token: asha_for_village is security definer and
 * execute is granted to `authenticated`, so the database can authorise
 * this and the service role is not needed. See the file header.
 */
async function coveringWorkers(caller: Caller, villageId: string): Promise<Row[]> {
  const { data, error } = await asUser(caller.token).rpc("asha_for_village", {
    p_village_id: villageId,
  });
  if (error) {
    throw new HttpError(
      500,
      `Could not look up the ASHA worker for that village: ${error.message}`,
    );
  }
  return (data ?? []) as Row[];
}

/** The village row, for a name to put on screen. villages_read is open to
 *  every signed-in user, so this needs no service role either. */
async function villageOf(caller: Caller, villageId: string): Promise<Row | null> {
  const { data } = await asUser(caller.token)
    .from("villages")
    .select(VILLAGE_COLUMNS)
    .eq("id", villageId)
    .maybeSingle();
  return (data ?? null) as Row | null;
}

// =====================================================================
// GET /asha/contact — who covers my village, and her number
// =====================================================================

messagingRouter.get(
  "/asha/contact",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const villageId =
      optionalUuid(firstValue(req.query.villageId), "villageId") ?? caller.villageId;

    // A 200 with asha: null, not a 404. A 404 says "there is no such
    // thing", and what is actually true is that this account has not
    // told us where it lives yet — a different statement, and one the
    // user can act on.
    if (!villageId) {
      res.json({
        asha: null,
        alsoCovering: [],
        villageId: null,
        village: null,
        helpline: HELPLINE,
        note:
          "Your village is not set on your profile yet, so we cannot tell which " +
          "ASHA worker covers you. Open My details and choose your village, then " +
          "come back. In the meantime the national health helpline is " +
          `${HELPLINE.number}.`,
      });
      return;
    }

    const [workers, village] = await Promise.all([
      coveringWorkers(caller, villageId),
      villageOf(caller, villageId),
    ]);

    if (workers.length === 0) {
      // Deliberately no fallback to a nearby village. A worker who does
      // not cover this household has no duty of care for it and may be
      // an hour away; naming her here would be a fabrication dressed up
      // as helpfulness. The helpline is the honest alternative because it
      // is a real, staffed, national number.
      res.json({
        asha: null,
        alsoCovering: [],
        villageId,
        village: shapeVillage(village),
        helpline: HELPLINE,
        note:
          `No ASHA worker is currently mapped to ${
            str(village?.name) ?? "that village"
          } in this app, so there is no name or number to show you. We will not ` +
          `show a worker from a neighbouring village, because she is not ` +
          `responsible for your household. For health advice now, call ` +
          `${HELPLINE.number} — the ${HELPLINE.label.toLowerCase()}. If you know ` +
          `your ASHA worker, ask her to register so she appears here.`,
      });
      return;
    }

    // asha_for_village orders is_primary first, so the first row is the
    // primary posting. Any others genuinely cover the same village and
    // are listed rather than hidden: a worker who is away or unreachable
    // is a real problem for somebody who needs help now.
    const [primary, ...others] = workers;

    res.json({
      asha: shapeWorker(primary),
      alsoCovering: others.map(shapeWorker),
      villageId,
      village: shapeVillage(village),
      source:
        "Read from the ASHA village assignment in this app, not from an external " +
        "directory.",
    });
  }),
);

// =====================================================================
// GET /messages/threads — the inbox, for either side
// =====================================================================

messagingRouter.get(
  "/messages/threads",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const client = asUser(caller.token);

    const page = intQuery(req.query.page, 1, 1, 10000);
    const size = intQuery(req.query.size, 20, 1, 50);
    const from = (page - 1) * size;

    // threads_select already scopes this to the two participants, and the
    // explicit `or` keeps the endpoint narrow if that policy is ever
    // widened. caller.id came out of the database via a verified token
    // and is matched against UUID_RE-shaped ids everywhere else in this
    // file, so it cannot smuggle a filter of its own into the string.
    const { data, error, count } = await client
      .from("message_threads")
      .select(THREAD_COLUMNS, { count: "exact" })
      .or(`citizen_id.eq.${caller.id},asha_id.eq.${caller.id}`)
      .order("last_message_at", { ascending: false })
      .range(from, from + size - 1);

    if (error) {
      throw new HttpError(500, `Could not load your conversations: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];
    const threadIds = rows.map((row) => row.id as string);

    if (threadIds.length === 0) {
      res.json({
        threads: [],
        count: count ?? 0,
        page,
        size,
        unreadTotal: 0,
        note:
          caller.role === "asha"
            ? "No household has messaged you yet."
            : "You have no conversations yet. Start one from the ASHA contact card.",
      });
      return;
    }

    // Unread incoming messages for the caller's side, in one bounded
    // query rather than one per thread. thread_messages_select lets a
    // participant read the messages in her own threads, so her token is
    // the right key.
    const { data: unreadRows, error: unreadError } = await client
      .from("thread_messages")
      .select("thread_id")
      .in("thread_id", threadIds)
      .neq("sender_id", caller.id)
      .is("read_at", null)
      .limit(UNREAD_SCAN_LIMIT);

    if (unreadError) {
      throw new HttpError(500, `Could not count unread messages: ${unreadError.message}`);
    }

    const unread = new Map<string, number>();
    for (const row of (unreadRows ?? []) as Row[]) {
      const key = row.thread_id as string;
      unread.set(key, (unread.get(key) ?? 0) + 1);
    }
    const unreadCountsApproximate = (unreadRows ?? []).length >= UNREAD_SCAN_LIMIT;

    // The preview is one small query per thread on the page. That is up
    // to fifty round trips at the largest page size, which is the honest
    // cost of a correct answer here: `last_message_at` gives the time of
    // the last message but not its text, and there is no single query
    // that returns the newest row per group through PostgREST.
    const previews = await Promise.all(
      threadIds.map(async (threadId) => {
        const { data: last } = await client
          .from("thread_messages")
          .select(MESSAGE_COLUMNS)
          .eq("thread_id", threadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return [threadId, (last ?? null) as Row | null] as const;
      }),
    );
    const lastMessages = new Map(previews);

    const names = await resolveNames(
      rows.map((row) => (row.citizen_id === caller.id ? row.asha_id : row.citizen_id)),
    );

    const threads = rows.map((row) => {
      const base = shapeThread(row, caller.id);
      const counterpartyId = base.counterpartyId as string;
      const name = names.get(counterpartyId);
      const last = lastMessages.get(row.id as string) ?? null;
      const body: string = last ? String(last.body ?? "") : "";
      const truncated = body.length > PREVIEW_CHARS;

      return {
        ...base,
        counterparty: {
          id: counterpartyId,
          side: base.mySide === "citizen" ? "asha" : "citizen",
          // Absent, not a placeholder, when the name is not on record.
          // A blank full_name is a real state and inventing a label for
          // it would put a made-up person on screen.
          ...(name ? { fullName: name } : {}),
        },
        unreadCount: unread.get(row.id as string) ?? 0,
        lastMessage: last
          ? {
              id: last.id,
              senderId: last.sender_id,
              mine: last.sender_id === caller.id,
              preview: truncated ? `${body.slice(0, PREVIEW_CHARS)}…` : body,
              truncated,
              readAt: last.read_at ?? null,
              createdAt: last.created_at,
            }
          : null,
      };
    });

    res.json({
      threads,
      count: count ?? 0,
      page,
      size,
      unreadTotal: [...unread.values()].reduce((sum, n) => sum + n, 0),
      ...(unreadCountsApproximate
        ? {
            unreadCountsApproximate: true,
            note:
              `More than ${UNREAD_SCAN_LIMIT} unread messages were found, so the ` +
              `per-thread counts above are a floor rather than an exact figure.`,
          }
        : {}),
    });
  }),
);

// =====================================================================
// POST /messages/threads — find or create, never duplicate
// =====================================================================

messagingRouter.post(
  "/messages/threads",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const client = asUser(caller.token);

    let ashaId = optionalUuid(body.ashaId, "ashaId");
    const villageId = caller.villageId;

    if (!ashaId) {
      if (!villageId) {
        throw new HttpError(
          400,
          "Your village is not set on your profile, so we cannot work out which " +
            "ASHA worker to open a conversation with. Set your village in My " +
            "details, or send ashaId.",
        );
      }

      const workers = await coveringWorkers(caller, villageId);
      if (workers.length === 0) {
        throw new HttpError(
          409,
          "No ASHA worker is mapped to your village yet, so there is nobody to " +
            `open a conversation with. For health advice now, call ` +
            `${HELPLINE.number} — the ${HELPLINE.label.toLowerCase()}.`,
        );
      }
      ashaId = workers[0].asha_user_id as string;
    }

    // message_threads carries `check (citizen_id <> asha_id)`, and this
    // is the case that reaches it: a worker calling the citizen-side
    // endpoint for her own village resolves to herself.
    if (ashaId === caller.id) {
      throw new HttpError(
        400,
        "You are the ASHA worker covering your own village, so there is no " +
          "second person to open a conversation with. Open a thread with a " +
          "household from the ASHA portal instead.",
      );
    }

    // Find first. unique (citizen_id, asha_id) means there is at most one.
    const { data: existing, error: findError } = await client
      .from("message_threads")
      .select(THREAD_COLUMNS)
      .eq("citizen_id", caller.id)
      .eq("asha_id", ashaId)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, `Could not check for an existing conversation: ${findError.message}`);
    }
    if (existing) {
      res.json({ thread: shapeThread(existing as Row, caller.id), created: false });
      return;
    }

    // Inserted as the caller so threads_insert decides it. That policy
    // requires asha_covers_citizen(asha_id, auth.uid()), which is what
    // stops a thread being opened against an arbitrary worker elsewhere
    // in the state — the database refuses it rather than this handler
    // filtering afterwards.
    const { data: created, error: insertError } = await client
      .from("message_threads")
      .insert({
        citizen_id: caller.id,
        asha_id: ashaId,
        village_id: villageId,
        subject: str(body.subject),
      })
      .select(THREAD_COLUMNS)
      .single();

    if (insertError) {
      // Two taps on one button must not produce two threads. A unique
      // violation here means the other request won the race, so the
      // thread it made is re-selected and returned as if this call had
      // found it, which is exactly what the caller wanted.
      if (insertError.code === "23505") {
        const { data: raced } = await client
          .from("message_threads")
          .select(THREAD_COLUMNS)
          .eq("citizen_id", caller.id)
          .eq("asha_id", ashaId)
          .maybeSingle();
        if (raced) {
          res.json({ thread: shapeThread(raced as Row, caller.id), created: false });
          return;
        }
      }
      if (insertError.code === "42501") {
        throw new HttpError(
          403,
          "The database refused this. A conversation can only be opened with an " +
            "ASHA worker who covers your village.",
        );
      }
      if (insertError.code === "23514") {
        throw new HttpError(
          400,
          "A conversation needs two different people. Nothing was created.",
        );
      }
      throw new HttpError(500, `Could not open the conversation: ${insertError.message}`);
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "message_thread.opened",
      entity: "message_threads",
      entityId: (created as Row).id,
      subjectId: ashaId,
      // Ids and the village only. No phone number, and no message text.
      detail: { village_id: villageId, resolved_from: body.ashaId ? "body" : "village" },
      ip: req.ip ?? null,
    });

    res.status(201).json({ thread: shapeThread(created as Row, caller.id), created: true });
  }),
);

// =====================================================================
// GET /messages/threads/:id — the conversation, oldest first
// =====================================================================

messagingRouter.get(
  "/messages/threads/:id",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const threadId = uuid(req.params.id, "Conversation id");
    const client = asUser(caller.token);

    const size = intQuery(req.query.size, 50, 1, 100);
    const beforeRaw = firstValue(req.query.before);
    let before: string | null = null;
    if (beforeRaw) {
      const at = Date.parse(beforeRaw);
      if (!Number.isFinite(at)) {
        throw new HttpError(
          400,
          "before must be the createdAt of the oldest message you already have.",
        );
      }
      before = new Date(at).toISOString();
    }

    // The thread first, so somebody who is not a participant gets a 404
    // rather than an empty message list that reads as "nothing was said".
    // threads_select is what decides this; a non-participant simply sees
    // no row.
    const { data: thread, error: threadError } = await client
      .from("message_threads")
      .select(THREAD_COLUMNS)
      .eq("id", threadId)
      .maybeSingle();

    if (threadError) {
      throw new HttpError(500, `Could not open that conversation: ${threadError.message}`);
    }
    if (!thread) {
      // One message for "no such thread" and "not yours" on purpose.
      // Telling them apart would confirm that a given id exists.
      throw new HttpError(404, "No conversation of yours has that id.");
    }

    // Paged backwards from the newest, then reversed, because a cursor
    // that walks into the past is what an inbox needs; the rows are
    // handed back oldest-first so a transcript renders in order.
    let query = client
      .from("thread_messages")
      .select(MESSAGE_COLUMNS, { count: "exact" })
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(size);

    if (before) query = query.lt("created_at", before);

    const { data, error, count } = await query;
    if (error) {
      throw new HttpError(500, `Could not load the messages: ${error.message}`);
    }

    const newestFirst = (data ?? []) as Row[];
    const oldestFirst = [...newestFirst].reverse();

    // Opening a thread is the read receipt. There is no separate "mark
    // read" call for messages, because a person who has the conversation
    // on screen has read what is on it, and asking the client to report
    // that separately would mean trusting it to.
    //
    // This goes through the column-level `grant update (read_at)` in
    // 06_platform_rls.sql: table-level update is revoked from
    // `authenticated`, so the statement cannot touch anything but
    // read_at, and thread_messages_mark_read restricts it to messages
    // the caller did not send in a thread she is part of.
    const unreadIncoming = oldestFirst
      .filter((row) => row.sender_id !== caller.id && !row.read_at)
      .map((row) => row.id as string);

    let markedRead = 0;
    if (unreadIncoming.length > 0) {
      const { data: marked, error: markError } = await client
        .from("thread_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIncoming)
        .select("id");

      if (markError && markError.code !== "42501") {
        throw new HttpError(500, `Could not mark the messages read: ${markError.message}`);
      }
      markedRead = ((marked ?? []) as Row[]).length;
    }

    const names = await resolveNames([
      (thread as Row).citizen_id === caller.id
        ? ((thread as Row).asha_id as string)
        : ((thread as Row).citizen_id as string),
    ]);
    const shaped = shapeThread(thread as Row, caller.id);
    const counterpartyName = names.get(shaped.counterpartyId as string);

    res.json({
      thread: {
        ...shaped,
        counterparty: {
          id: shaped.counterpartyId,
          side: shaped.mySide === "citizen" ? "asha" : "citizen",
          ...(counterpartyName ? { fullName: counterpartyName } : {}),
        },
      },
      // read_at is reported as it stood when the page was read, not as it
      // stands after the update above, so the screen can still highlight
      // what was new on this open.
      messages: oldestFirst.map((row) => shapeMessage(row, caller.id)),
      count: count ?? 0,
      size,
      markedRead,
      hasMore: newestFirst.length === size,
      // Feed this back as `before` to page further into the past. Null
      // when this page is empty, because there is nothing older to ask
      // for.
      nextBefore: oldestFirst.length > 0 ? oldestFirst[0].created_at : null,
      ...(oldestFirst.length === 0
        ? {
            note: before
              ? "There are no earlier messages in this conversation."
              : "Nothing has been said in this conversation yet.",
          }
        : {}),
    });
  }),
);

// =====================================================================
// POST /messages/threads/:id — say something
// =====================================================================

messagingRouter.post(
  "/messages/threads/:id",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const threadId = uuid(req.params.id, "Conversation id");

    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (typeof raw.body !== "string") {
      throw new HttpError(400, "Send body: the text of your message.");
    }
    const text = raw.body.trim();
    if (text === "") {
      throw new HttpError(400, "Type something before sending.");
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(
        400,
        `A message can be at most ${MAX_MESSAGE_CHARS} characters and that one is ` +
          `${text.length}. Shorten it, or send it in two parts.`,
      );
    }

    // Inserted as the caller so thread_messages_insert decides it: sender
    // must be auth.uid(), the thread must be one she is part of, and it
    // must not be closed. Membership is the database's call, not this
    // handler's.
    //
    // last_message_at is deliberately not set here. The
    // touch_thread_on_message trigger from 05_platform.sql owns that
    // column and copies new.created_at into it, so writing it from here
    // would either be redundant or, worse, disagree with the message it
    // is meant to describe.
    const { data, error } = await asUser(caller.token)
      .from("thread_messages")
      .insert({ thread_id: threadId, sender_id: caller.id, body: text })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) {
      if (error.code === "42501") {
        throw new HttpError(
          403,
          "The database refused this message. Either this is not your " +
            "conversation, or it has been closed.",
        );
      }
      if (error.code === "23503") {
        throw new HttpError(404, "No conversation has that id.");
      }
      if (error.code === "23514") {
        throw new HttpError(400, "A message cannot be blank.");
      }
      throw new HttpError(500, `Could not send your message: ${error.message}`);
    }

    res.status(201).json({ message: shapeMessage(data as Row, caller.id) });
  }),
);

// =====================================================================
// GET /asha/threads/summary — the two numbers on the portal header
// =====================================================================

messagingRouter.get(
  "/asha/threads/summary",
  requireAsha,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const client = asUser(caller.token);

    // Her own threads, read as herself: threads_select covers asha_id =
    // auth.uid(). Bounded, so one worker with an unusually long history
    // cannot turn a header into a slow query.
    const { data, error } = await client
      .from("message_threads")
      .select("id, closed")
      .eq("asha_id", caller.id)
      .order("last_message_at", { ascending: false })
      .limit(THREAD_SCAN_LIMIT);

    if (error) {
      throw new HttpError(500, `Could not summarise your conversations: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];
    const openIds = rows.filter((row) => row.closed !== true).map((row) => row.id as string);
    const truncated = rows.length >= THREAD_SCAN_LIMIT;

    let unreadMessages = 0;
    if (rows.length > 0) {
      const { count, error: unreadError } = await client
        .from("thread_messages")
        .select("id", { count: "exact", head: true })
        .in(
          "thread_id",
          rows.map((row) => row.id as string),
        )
        .neq("sender_id", caller.id)
        .is("read_at", null);

      if (unreadError) {
        throw new HttpError(500, `Could not count unread messages: ${unreadError.message}`);
      }
      unreadMessages = count ?? 0;
    }

    res.json({
      openThreads: openIds.length,
      closedThreads: rows.length - openIds.length,
      totalThreads: rows.length,
      unreadMessages,
      ...(truncated
        ? {
            countsApproximate: true,
            note:
              `These counts cover your ${THREAD_SCAN_LIMIT} most recently active ` +
              `conversations. You have more than that, so the totals are a floor ` +
              `rather than an exact figure.`,
          }
        : {}),
      ...(rows.length === 0
        ? { note: "No household has messaged you yet." }
        : {}),
    });
  }),
);
