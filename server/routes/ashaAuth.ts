import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import {
  HttpError,
  handler,
  requireAdmin,
  requireAuth,
  type Caller,
} from "../lib/auth";
import { admin, asUser, audit } from "../lib/supabaseAdmin";

/* =====================================================================
   Becoming an ASHA worker — the HTTP surface

   A citizen must not be able to register as a health worker, and this
   router is the whole of the sanctioned way around that. There are two
   paths and they are not equivalent.

   The roster path. A block office roster is uploaded by an admin, one
   single-use invite code is issued per row, and only the bcrypt hash of
   that code is stored. A worker posts her official ASHA code together
   with the invite code she was handed; if the pair matches an active,
   unclaimed row her account is promoted and bound to that row's villages
   in one database transaction. This is the fast path and it needs no
   human in the loop, because the block office already made the decision
   when it put her on the roster.

   The approval path. A worker who is genuinely an ASHA but is missing
   from the uploaded file files a request instead. Filing it grants her
   nothing whatsoever: the insert goes in as her own user, through her own
   token, so the RLS policy in 06_platform_rls.sql is the thing pinning
   user_id to auth.uid() and status to 'pending'. Her role stays 'citizen'
   until an admin approves, and only then does a promotion happen.

   Why the roster is service-role only, restated here because it decides
   the shape of every handler below. asha_roster has RLS enabled and not
   one policy, and its grants are revoked, so no publishable key can read
   or write it. Reading the roster plus guessing a short code would be
   enough to impersonate a health worker, so the table is reachable only
   through admin() from this process, and the verification itself happens
   inside claim_asha_roster() rather than out here — supabase-js cannot
   run arbitrary SQL, so a verify-then-claim written in TypeScript would
   be several round trips with no transaction around them and two workers
   submitting the same code at once could both succeed.

   Two standing rules in this file. An invite code, a bearer token and a
   key are never written to a log, an audit row or an error message. And
   a failed claim never reveals whether the ASHA code exists, because
   that would make this endpoint a way to enumerate the roster.
   ===================================================================== */

export const ashaAuthRouter = Router();

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

/**
 * requireAuth has already run wherever this is called, so a missing
 * caller is a wiring mistake rather than an unauthenticated request. It
 * still answers 401 rather than throwing a TypeError, because a 500 on
 * this router would look like a database problem during a demo.
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

function required(value: unknown, label: string): string {
  const out = str(value);
  if (!out) throw new HttpError(400, `${label} is required.`);
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres rejects a malformed uuid with a 22P02, which would surface as
 * a 500. A path parameter that is obviously not an id is a bad request.
 */
function uuidParam(value: unknown, label: string): string {
  const out = required(value, label);
  if (!UUID_RE.test(out)) throw new HttpError(400, `${label} is not a valid id.`);
  return out;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// ---------------------------------------------------------------------
// Attempt limiting on the claim endpoint
//
// An eight character invite code is short enough to read down a phone
// line, which is the point of it, and short enough to brute force if the
// endpoint will answer forever. Five attempts per account per fifteen
// minutes turns a guessable code into a code nobody can guess, and it is
// the control that makes the code length acceptable in the first place.
//
// Keyed by user id rather than by IP on purpose. A whole village can sit
// behind one carrier NAT address, so limiting by IP would lock out
// neighbours who did nothing, and every caller here has already been
// through requireAuth so there is a real identity to count against.
//
// This lives in module scope, which means one process. That is honest
// about what it is: a single-instance control. Behind more than one node
// this belongs in the database or in Redis, and until then the numbers
// below are per instance rather than global.
// ---------------------------------------------------------------------

const CLAIM_WINDOW_MS = 15 * 60 * 1000;
const CLAIM_MAX_ATTEMPTS = 5;

const claimAttempts = new Map<string, number[]>();
let lastSweep = Date.now();

/**
 * Records an attempt and reports whether it is allowed. Called before the
 * database is touched, so a wrong guess costs the attacker an attempt
 * whether or not the ASHA code exists.
 */
function takeClaimAttempt(userId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();

  // Drop stale keys occasionally so a long-running process does not hold
  // an entry for every account that ever tried once.
  if (now - lastSweep > CLAIM_WINDOW_MS) {
    for (const [key, stamps] of claimAttempts) {
      if (stamps.every((t) => now - t >= CLAIM_WINDOW_MS)) claimAttempts.delete(key);
    }
    lastSweep = now;
  }

  const recent = (claimAttempts.get(userId) ?? []).filter(
    (t) => now - t < CLAIM_WINDOW_MS,
  );

  if (recent.length >= CLAIM_MAX_ATTEMPTS) {
    claimAttempts.set(userId, recent);
    const oldest = recent[0];
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((CLAIM_WINDOW_MS - (now - oldest)) / 1000)),
    };
  }

  recent.push(now);
  claimAttempts.set(userId, recent);
  return { allowed: true, retryAfterSec: 0 };
}

/** A successful claim frees the counter; she will not be coming back. */
function clearClaimAttempts(userId: string) {
  claimAttempts.delete(userId);
}

// ---------------------------------------------------------------------
// Invite code generation
//
// These codes are read aloud down a bad phone line and copied onto paper
// by hand, so the alphabet omits 0, O, 1, I and L. Every one of those is
// a transcription error waiting to happen, and a worker who mistypes her
// code burns one of five attempts for a reason that is our fault rather
// than hers. What is left is 31 characters, printed as two groups of four
// because a hyphen in the middle is what stops somebody losing their
// place halfway through dictating it.
//
// Eight characters from 31 is a little over 8.5 x 10^11 combinations,
// which is only safe alongside the attempt limit above; neither control
// carries this on its own.
// ---------------------------------------------------------------------

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_GROUPS = 2;
const CODE_GROUP_LEN = 4;

function generateInviteCode(): string {
  const chars: string[] = [];
  const needed = CODE_GROUPS * CODE_GROUP_LEN;

  // Rejection sampling rather than a plain modulo. With 31 symbols, byte
  // values 248 and above would wrap and make the first eight characters
  // very slightly likelier than the rest; discarding them keeps every
  // code exactly as likely as every other one.
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;

  while (chars.length < needed) {
    const bytes = crypto.randomBytes(needed * 2);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
      if (chars.length === needed) break;
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUPS; i += 1) {
    groups.push(chars.slice(i * CODE_GROUP_LEN, (i + 1) * CODE_GROUP_LEN).join(""));
  }
  return groups.join("-");
}

// ---------------------------------------------------------------------
// Shared copy
//
// The denial message is a constant because it has to be byte-identical
// for a wrong invite code and for an ASHA code that was never issued. If
// those two ever read differently, someone with a list of guessed codes
// can tell which ones the block office actually printed.
// ---------------------------------------------------------------------

const CLAIM_DENIED =
  "That ASHA code and invite code do not match an active roster entry. " +
  "Check both, then ask your block office if the problem continues.";

const REFRESH_NOTE =
  "Your role has been changed in your profile. The app reads your role " +
  "from your profile rather than from the token you are holding, so " +
  "refresh your session or sign out and back in before the ASHA portal " +
  "will open for you.";

// =====================================================================
// POST /asha/claim-code — the roster path
// =====================================================================

ashaAuthRouter.post(
  "/asha/claim-code",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const ashaCode = str(req.body?.ashaCode);
    const inviteCode = str(req.body?.inviteCode);

    if (!ashaCode || !inviteCode) {
      throw new HttpError(
        400,
        "Enter both your official ASHA code and the invite code your block office gave you.",
      );
    }

    // Counted before the database is touched, so a guess costs an attempt
    // regardless of whether the code exists.
    const gate = takeClaimAttempt(caller.id);
    if (!gate.allowed) {
      res.setHeader("Retry-After", String(gate.retryAfterSec));
      throw new HttpError(
        429,
        `Too many attempts. For safety this account can try ${CLAIM_MAX_ATTEMPTS} ` +
          `invite codes every 15 minutes. Wait about ` +
          `${Math.ceil(gate.retryAfterSec / 60)} minute(s) and try again, or ask ` +
          `your block office to confirm the code before you do.`,
      );
    }

    // Service role, because asha_roster is unreadable with any client key
    // and the promotion has to step around guard_role_change. The whole
    // verify-and-claim is one transaction inside the database.
    const { data, error } = await admin().rpc("claim_asha_roster", {
      p_asha_code: ashaCode,
      p_invite_code: inviteCode,
      p_user_id: caller.id,
    });

    if (error) {
      // Never echo the codes back in an error. The message from Postgres
      // is about the function, not about the submitted values.
      throw new HttpError(500, `Could not check that code: ${error.message}`);
    }

    const result = (data ?? {}) as {
      ok?: boolean;
      reason?: string;
      asha_code?: string;
      full_name?: string | null;
      block?: string | null;
      sub_centre?: string | null;
      district?: string | null;
      state?: string | null;
      villages?: string[] | null;
      village_ids?: string[] | null;
      primary_village_id?: string | null;
      roster_id?: string | null;
    };

    if (!result.ok) {
      const reason = result.reason ?? "bad_code";

      // Worth recording: five failures in a row against one account is
      // the signature of somebody working through a list. The reason is
      // recorded, the submitted codes are not.
      await audit({
        actorId: caller.id,
        actorRole: caller.role,
        action: "asha.claim_failed",
        entity: "asha_roster",
        detail: { reason },
        ip: req.ip ?? null,
      });

      switch (reason) {
        // Identical status and identical text on purpose. 'not_found'
        // means the caller has no profile row at all, which is a broken
        // account rather than a wrong code, but telling the two apart out
        // loud would still narrow down the roster for an attacker.
        case "bad_code":
        case "not_found":
          throw new HttpError(401, CLAIM_DENIED);

        case "already_claimed":
          throw new HttpError(
            409,
            "This roster entry has already been claimed by another account. " +
              "If that was not you, tell your block office immediately.",
          );

        case "expired":
          throw new HttpError(
            410,
            "This invite code has expired. Ask your block office to issue a new one.",
          );

        case "inactive":
          throw new HttpError(
            403,
            "This roster entry is no longer active. Your block office will need " +
              "to reactivate it before you can register.",
          );

        case "user_already_asha":
          throw new HttpError(
            409,
            "This account is already registered as an ASHA worker. Refresh the " +
              "app and open the ASHA portal.",
          );

        default:
          throw new HttpError(400, CLAIM_DENIED);
      }
    }

    clearClaimAttempts(caller.id);

    await audit({
      actorId: caller.id,
      actorRole: "asha",
      action: "asha.claimed_roster",
      entity: "asha_roster",
      entityId: result.roster_id ?? null,
      subjectId: caller.id,
      detail: {
        asha_code: result.asha_code ?? ashaCode,
        block: result.block ?? null,
        sub_centre: result.sub_centre ?? null,
        villages: result.villages ?? [],
        // No invite code here, and none anywhere else either.
        method: "roster_invite_code",
      },
      ip: req.ip ?? null,
    });

    res.json({
      ok: true,
      ashaCode: result.asha_code ?? ashaCode,
      fullName: result.full_name ?? null,
      block: result.block ?? null,
      subCentre: result.sub_centre ?? null,
      district: result.district ?? null,
      state: result.state ?? null,
      villages: result.villages ?? [],
      villageIds: result.village_ids ?? [],
      primaryVillageId: result.primary_village_id ?? null,
      note: REFRESH_NOTE,
    });
  }),
);

// =====================================================================
// POST /asha/registration-request — the approval path, filed
// =====================================================================

ashaAuthRouter.post(
  "/asha/registration-request",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = req.body ?? {};

    const fullName = required(body.fullName, "Your full name");
    const phone = required(body.phone, "A phone number");
    const villageName = required(body.villageName, "Your village");

    // Deliberately inserted as the caller, not with admin(). The insert
    // policy asha_requests_insert is what enforces user_id = auth.uid()
    // and status = 'pending', so the rule that filing a request grants
    // nothing is enforced by the database and not by this handler being
    // careful. Using the service role here would leave that policy
    // untested in production.
    const { data, error } = await asUser(caller.token)
      .from("asha_registration_requests")
      .insert({
        user_id: caller.id,
        full_name: fullName,
        phone,
        asha_code_claimed: str(body.ashaCodeClaimed),
        village_name: villageName,
        block: str(body.block),
        district: str(body.district),
        state: str(body.state),
        sub_centre: str(body.subCentre),
        supervisor_name: str(body.supervisorName),
        supervisor_phone: str(body.supervisorPhone),
        note: str(body.note),
        status: "pending",
      })
      .select("*")
      .single();

    if (error) {
      // uq_asha_request_open is a partial unique index on user_id where
      // status = 'pending'. Hitting it means she already has one open,
      // which is a state to explain rather than an error to report.
      if (error.code === "23505") {
        throw new HttpError(
          409,
          "You already have a registration request waiting for review. An admin " +
            "will look at it; withdraw it first if you need to change anything.",
        );
      }
      if (error.code === "42501") {
        throw new HttpError(
          403,
          "A registration request can only be filed for your own account.",
        );
      }
      throw new HttpError(500, `Could not file your request: ${error.message}`);
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "asha.request_filed",
      entity: "asha_registration_requests",
      entityId: data?.id ?? null,
      subjectId: caller.id,
      detail: { village_name: villageName, has_claimed_code: Boolean(str(body.ashaCodeClaimed)) },
      ip: req.ip ?? null,
    });

    res.status(201).json({
      ok: true,
      request: data,
      note:
        "Filed. Your role stays a citizen until an admin approves this, so the " +
        "ASHA portal will not open yet.",
    });
  }),
);

// =====================================================================
// GET /asha/registration-request/mine
// =====================================================================

ashaAuthRouter.get(
  "/asha/registration-request/mine",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    // Her own row, read as herself. asha_requests_select already scopes
    // this to user_id = auth.uid(), and the explicit filter is here so a
    // policy change can never widen this endpoint by accident.
    const { data, error } = await asUser(caller.token)
      .from("asha_registration_requests")
      .select("*")
      .eq("user_id", caller.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not load your request: ${error.message}`);
    }

    // A truthful null rather than an invented placeholder. The screen has
    // to be able to say "you have not filed one".
    res.json({ request: data ?? null });
  }),
);

// =====================================================================
// POST /asha/registration-request/withdraw
// =====================================================================

ashaAuthRouter.post(
  "/asha/registration-request/withdraw",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    // asha_requests_withdraw allows exactly this transition and no other:
    // her own row, from 'pending', to 'withdrawn'. Nothing here needs the
    // service role, so nothing here uses it.
    const { data, error } = await asUser(caller.token)
      .from("asha_registration_requests")
      .update({ status: "withdrawn" })
      .eq("user_id", caller.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not withdraw your request: ${error.message}`);
    }
    if (!data) {
      throw new HttpError(404, "You have no registration request waiting for review.");
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "asha.request_withdrawn",
      entity: "asha_registration_requests",
      entityId: data.id,
      subjectId: caller.id,
      ip: req.ip ?? null,
    });

    res.json({ ok: true, request: data });
  }),
);

// =====================================================================
// GET /admin/asha/requests — the review queue
// =====================================================================

const REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;

ashaAuthRouter.get(
  "/admin/asha/requests",
  requireAdmin,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const status = String(req.query.status ?? "pending");
    if (!REQUEST_STATUSES.includes(status as (typeof REQUEST_STATUSES)[number])) {
      throw new HttpError(
        400,
        `status must be one of ${REQUEST_STATUSES.join(", ")}.`,
      );
    }

    const limit = intQuery(req.query.limit, 25, 1, 100);
    const offset = intQuery(req.query.offset, 0, 0, 100000);

    // Read as the admin. asha_requests_select already grants an admin the
    // whole table through is_admin(), so there is nothing here the
    // caller's own token cannot do, and going through it keeps that policy
    // exercised rather than theoretical.
    const { data, error, count } = await asUser(caller.token)
      .from("asha_registration_requests")
      .select("*", { count: "exact" })
      .eq("status", status)
      // Oldest first for 'pending': a queue somebody works through, not a
      // feed. Anything already reviewed is more useful newest first.
      .order("created_at", { ascending: status === "pending" })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new HttpError(500, `Could not load the request queue: ${error.message}`);
    }

    res.json({
      status,
      requests: data ?? [],
      total: count ?? 0,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
    });
  }),
);

// =====================================================================
// POST /admin/asha/requests/:id/approve
// =====================================================================

ashaAuthRouter.post(
  "/admin/asha/requests/:id/approve",
  requireAdmin,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const requestId = uuidParam(req.params.id, "Request id");
    const note = str(req.body?.note);

    // The promotion happens inside the function, which re-checks that the
    // reviewer really is an admin against profiles rather than trusting
    // this middleware, and rolls the whole approval back if the resulting
    // asha_code collides with somebody else's.
    const { data, error } = await admin().rpc("approve_asha_request", {
      p_request_id: requestId,
      p_reviewer: caller.id,
      p_note: note,
    });

    if (error) {
      throw new HttpError(500, `Could not approve the request: ${error.message}`);
    }

    const result = (data ?? {}) as {
      ok?: boolean;
      reason?: string;
      user_id?: string | null;
      asha_code?: string | null;
      provisional?: boolean;
      village_id?: string | null;
      village?: string | null;
    };

    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
          throw new HttpError(404, "No such registration request.");
        case "already_reviewed":
          throw new HttpError(
            409,
            "This request has already been reviewed. Reload the queue to see " +
              "who handled it and what they recorded.",
          );
        case "not_admin":
          throw new HttpError(403, "Only an admin can approve a registration request.");
        case "asha_code_taken":
          throw new HttpError(
            409,
            "Another worker is already registered under that ASHA code. Correct " +
              "the code on this request before approving it.",
          );
        default:
          throw new HttpError(
            400,
            `Could not approve the request (${result.reason ?? "unknown reason"}).`,
          );
      }
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "asha.request_approved",
      entity: "asha_registration_requests",
      entityId: requestId,
      subjectId: result.user_id ?? null,
      detail: {
        asha_code: result.asha_code ?? null,
        provisional_code: Boolean(result.provisional),
        village: result.village ?? null,
        note,
      },
      ip: req.ip ?? null,
    });

    res.json({
      ok: true,
      requestId,
      userId: result.user_id ?? null,
      ashaCode: result.asha_code ?? null,
      // True means she gave no official code and the database minted a
      // deterministic PROV- one. The queue screen has to show that as
      // provisional, because it is not a block office number.
      provisional: Boolean(result.provisional),
      villageId: result.village_id ?? null,
      note: REFRESH_NOTE,
    });
  }),
);

// =====================================================================
// POST /admin/asha/requests/:id/reject
// =====================================================================

ashaAuthRouter.post(
  "/admin/asha/requests/:id/reject",
  requireAdmin,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const requestId = uuidParam(req.params.id, "Request id");

    // Required, not optional. A rejection with no reason cannot be
    // reviewed by a supervisor, cannot be explained to the worker, and
    // cannot be told apart from a misclick six months later.
    const note = str(req.body?.note);
    if (!note) {
      throw new HttpError(
        400,
        "Give a reason for the rejection. The worker and the next reviewer both " +
          "need to know why this was turned down.",
      );
    }

    // asha_requests_review lets an admin update any row, so this needs no
    // service role. The status filter is what makes it idempotent: a
    // request somebody else already handled will not be quietly rewritten.
    const { data, error } = await asUser(caller.token)
      .from("asha_registration_requests")
      .update({
        status: "rejected",
        reviewed_by: caller.id,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not reject the request: ${error.message}`);
    }
    if (!data) {
      throw new HttpError(
        409,
        "That request is not waiting for review any more. Reload the queue.",
      );
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "asha.request_rejected",
      entity: "asha_registration_requests",
      entityId: requestId,
      subjectId: data.user_id ?? null,
      detail: { note },
      ip: req.ip ?? null,
    });

    res.json({ ok: true, request: data });
  }),
);

// =====================================================================
// POST /admin/asha/roster — upload the block office roster, issue codes
// =====================================================================

interface RosterRowInput {
  ashaCode?: unknown;
  fullName?: unknown;
  phone?: unknown;
  block?: unknown;
  subCentre?: unknown;
  district?: unknown;
  state?: unknown;
  villageNames?: unknown;
  supervisorName?: unknown;
  supervisorPhone?: unknown;
}

// One HTTP body, and the plaintext codes come back in the response
// exactly once. A batch of thousands would mean a page of unrecoverable
// secrets nobody can realistically distribute before losing some, so the
// upload is bounded and an admin does a block at a time.
const MAX_ROSTER_ROWS = 500;

ashaAuthRouter.post(
  "/admin/asha/roster",
  requireAdmin,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const rows = req.body?.rows;
    const source = str(req.body?.source);
    const validDays = intQuery(req.body?.validDays, 30, 1, 365);

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new HttpError(400, "Send rows: an array of roster entries.");
    }
    if (rows.length > MAX_ROSTER_ROWS) {
      throw new HttpError(
        400,
        `Upload at most ${MAX_ROSTER_ROWS} rows at a time. The invite codes are ` +
          `shown once and cannot be recovered, so a smaller batch is easier to ` +
          `hand out without losing any.`,
      );
    }

    const seen = new Set<string>();
    const payload = (rows as RosterRowInput[]).map((row, index) => {
      const ashaCode = str(row.ashaCode);
      const fullName = str(row.fullName);
      if (!ashaCode || !fullName) {
        throw new HttpError(
          400,
          `Row ${index + 1} needs both ashaCode and fullName.`,
        );
      }

      // A repeated code inside one batch would make the upsert try to
      // touch the same row twice, which Postgres refuses outright. Saying
      // which row is duplicated is more use than that error.
      const key = ashaCode.toLowerCase();
      if (seen.has(key)) {
        throw new HttpError(
          400,
          `Row ${index + 1} repeats ASHA code ${ashaCode}. Each code must appear once.`,
        );
      }
      seen.add(key);

      const villageNames = Array.isArray(row.villageNames)
        ? (row.villageNames.map((v) => str(v)).filter((v): v is string => Boolean(v)))
        : [];

      return {
        asha_code: ashaCode,
        full_name: fullName,
        phone: str(row.phone),
        block: str(row.block),
        sub_centre: str(row.subCentre),
        district: str(row.district),
        state: str(row.state),
        village_names: villageNames,
        supervisor_name: str(row.supervisorName),
        supervisor_phone: str(row.supervisorPhone),
        source,
        active: true,
      };
    });

    // Service role, because asha_roster is reachable no other way. The
    // upsert names only the columns above, so invite_code_hash, claimed_by
    // and claimed_at on an existing row are left alone — re-uploading a
    // corrected roster must not un-claim a worker who has already
    // registered.
    const { data: upserted, error } = await admin()
      .from("asha_roster")
      .upsert(payload, { onConflict: "asha_code" })
      .select("id, asha_code, full_name, claimed_by");

    if (error) {
      throw new HttpError(500, `Could not save the roster: ${error.message}`);
    }

    const codes: Array<{
      rosterId: string;
      ashaCode: string;
      fullName: string;
      inviteCode: string;
    }> = [];
    const skipped: Array<{ rosterId: string; ashaCode: string; reason: string }> = [];

    for (const row of upserted ?? []) {
      // Already registered: issuing a code here would put something on
      // the admin's screen that can never be redeemed.
      if (row.claimed_by) {
        skipped.push({
          rosterId: row.id,
          ashaCode: row.asha_code,
          reason: "already_claimed",
        });
        continue;
      }

      const inviteCode = generateInviteCode();
      const { data: stored, error: issueError } = await admin().rpc(
        "issue_asha_invite_code",
        { p_roster_id: row.id, p_code: inviteCode, p_valid_days: validDays },
      );

      if (issueError) {
        throw new HttpError(
          500,
          `Saved the roster but could not issue a code for ${row.asha_code}: ` +
            `${issueError.message}`,
        );
      }
      if (stored !== true) {
        skipped.push({
          rosterId: row.id,
          ashaCode: row.asha_code,
          reason: "code_not_issued",
        });
        continue;
      }

      codes.push({
        rosterId: row.id,
        ashaCode: row.asha_code,
        fullName: row.full_name,
        inviteCode,
      });
    }

    // The audit row records that codes were issued, for which rows, by
    // whom. It does not record the codes, because an audit table somebody
    // can read is not a place to keep a credential.
    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "asha.roster_uploaded",
      entity: "asha_roster",
      detail: {
        source,
        rows_upserted: upserted?.length ?? 0,
        codes_issued: codes.length,
        skipped: skipped.length,
        valid_days: validDays,
        roster_ids: codes.map((c) => c.rosterId),
      },
      ip: req.ip ?? null,
    });

    res.status(201).json({
      ok: true,
      warning:
        "These invite codes are shown once and are stored only as bcrypt " +
        "hashes. They cannot be recovered or re-read from this screen later. " +
        "Distribute them now; any code that is lost has to be re-issued.",
      source,
      validDays,
      expiresAt: new Date(Date.now() + validDays * 86400000).toISOString(),
      upserted: upserted?.length ?? 0,
      codes,
      skipped,
    });
  }),
);

// =====================================================================
// GET /asha/me — who the portal is actually talking to
// =====================================================================

ashaAuthRouter.get(
  "/asha/me",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const client = asUser(caller.token);

    // asha_profiles_select scopes this to user_id = auth.uid(), so the
    // caller's own token is the right key and no service role is needed.
    const { data: ashaProfile, error: profileError } = await client
      .from("asha_profiles")
      // One string literal rather than a concatenation: supabase-js infers
      // the row type from the select at the type level and cannot read a
      // built-up string, which turns the result into an error type.
      .select(
        "id, asha_code, block, sub_centre, villages, households, supervisor_name, supervisor_phone, active, joined_on, created_at",
      )
      .eq("user_id", caller.id)
      .maybeSingle();

    if (profileError) {
      throw new HttpError(500, `Could not load your worker record: ${profileError.message}`);
    }

    // asha_villages is the assignment the notification and SOS policies
    // read, so it is the honest answer to "which villages may I address".
    // asha_profiles.villages is display text and can drift; this cannot.
    const { data: links, error: linkError } = await client
      .from("asha_villages")
      .select(
        "village_id, is_primary, assigned_at, villages ( id, name, block, district, state )",
      )
      .eq("asha_user_id", caller.id)
      .order("is_primary", { ascending: false });

    if (linkError) {
      throw new HttpError(500, `Could not load your villages: ${linkError.message}`);
    }

    const villages = (links ?? []).map((link: any) => ({
      id: link.village_id,
      name: link.villages?.name ?? null,
      block: link.villages?.block ?? null,
      district: link.villages?.district ?? null,
      state: link.villages?.state ?? null,
      isPrimary: Boolean(link.is_primary),
      assignedAt: link.assigned_at ?? null,
    }));

    res.json({
      id: caller.id,
      role: caller.role,
      fullName: caller.fullName,
      phone: caller.phone,
      email: caller.email,
      language: caller.language,
      villageId: caller.villageId,
      isAsha: caller.role === "asha" || caller.role === "admin",
      // Null when there is no worker record, and the portal must render
      // that as nothing rather than falling back to a demo name. A screen
      // that invents "Radha Bai, 240 households" for whoever signed in is
      // worse than a screen that says the record is missing.
      ashaProfile: ashaProfile ?? null,
      villages,
      registeredVia: ashaProfile?.asha_code?.startsWith("PROV-")
        ? "approval_provisional_code"
        : ashaProfile
          ? "roster_or_approval"
          : null,
    });
  }),
);
