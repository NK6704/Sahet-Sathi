import { Router, type Request, type Response } from "express";
import { HttpError, handler, requireAuth, type Caller } from "../lib/auth";
import { admin, asUser, audit } from "../lib/supabaseAdmin";

/* =====================================================================
   The citizen's own profile — and the one column that makes the rest of
   the app work.

   What this replaces. GET and PATCH /api/profile used to read and write
   `activeUserProfile`, a single object in the server process shared by
   every request. Nothing reached public.profiles. The consequences went
   well beyond "details are not saved":

     · profiles.village_id stayed null for every citizen for ever, and
       that column is the *only* link between a household and its ASHA
       worker. GET /asha/contact, thread creation, SOS routing and the
       whole village broadcast fan-out all key on it, so all four took
       their "we don't know your village" branch permanently. A worker
       could register, be approved, be mapped to her village — and remain
       invisible to every household in it.
     · Two people using the app at once overwrote each other's details,
       and a restart discarded everyone's.

   The shape of this file follows from one rule: a citizen may edit her
   own details, so those writes go through her own token and are decided
   by profiles_update_own. She may NOT choose her own village_id — that
   would let anyone join any village and receive its broadcasts — so that
   single column is written with the service role after
   public.resolve_village() has decided what it should be. The column-level
   grant in 10_profile_village.sql is what enforces the distinction.

   The second rule is the one that governs the whole app: never assert a
   fact nobody established. If the village she typed matches two villages
   in her district, this route does not pick one. It saves everything else
   and hands back `villageMatch.kind = 'ambiguous'` so the screen can ask
   her for her block instead of quietly attaching her household to a
   stranger's worker.
   ===================================================================== */

export const profileRouter = Router();

type Row = Record<string, any>;

function callerOf(req: Request): Caller {
  if (!req.caller) throw new HttpError(401, "Sign in to continue");
  return req.caller;
}

// Everything the citizen screens read back. `role` is deliberately absent:
// the client must not start believing it can act on a role it read from a
// profile response. server/lib/auth.ts reads the role from the database on
// every request and that is the only copy that decides anything.
const PROFILE_COLUMNS =
  "id, full_name, phone, age, gender, state, district, village, block, village_id, " +
  "pincode, annual_income, category, has_abha, ration_card_type, family_members, " +
  "is_pregnant_or_lactating, chronic_conditions, consents, saved_schemes, " +
  "consent_data, consent_voice, updated_at";

/* ---------------------------------------------------------------------
   Validation

   Every helper here returns `undefined` for "not sent" and `null` for
   "sent as empty". The difference matters: an untouched field must keep
   what is in the database, and a cleared field must actually clear it.
   --------------------------------------------------------------------- */

function textField(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) {
    throw new HttpError(
      400,
      `${label} can be at most ${max} characters and that one is ${trimmed.length}.`,
    );
  }
  return trimmed;
}

function intField(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpError(400, `${label} must be a whole number.`);
  }
  if (n < min || n > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  }
  return n;
}

function boolField(value: unknown, label: string): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  throw new HttpError(400, `${label} must be true or false.`);
}

function listField(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a list.`);
  }
  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new HttpError(400, `Every entry in ${label} must be text.`);
    }
    const trimmed = item.trim();
    if (trimmed === "") continue;
    if (trimmed.length > maxChars) {
      throw new HttpError(400, `Each entry in ${label} can be at most ${maxChars} characters.`);
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  if (cleaned.length > maxItems) {
    throw new HttpError(400, `${label} can hold at most ${maxItems} entries.`);
  }
  return cleaned;
}

// The four consent keys the app asks about. An unknown key is refused
// rather than stored, because a consent record is only worth keeping if
// every key in it means something a person was actually shown.
const CONSENT_KEYS = [
  "voice_processing",
  "location_access",
  "health_guidance_disclaimer",
  "asha_referral_consent",
] as const;

function consentsField(value: unknown): Record<string, boolean> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "consents must be an object of true/false values.");
  }
  const out: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!(CONSENT_KEYS as readonly string[]).includes(key)) {
      throw new HttpError(
        400,
        `'${key}' is not a consent this app asks for. Known keys: ${CONSENT_KEYS.join(", ")}.`,
      );
    }
    if (typeof raw !== "boolean") {
      throw new HttpError(400, `consents.${key} must be true or false.`);
    }
    out[key] = raw;
  }
  return out;
}

const PINCODE_RE = /^[1-9][0-9]{5}$/;

/* ---------------------------------------------------------------------
   Response shape

   Kept identical to what the screens already read — `name`, not
   `full_name` — so the client keeps working, with village_id and the
   resolver's verdict added.

   `language` is deliberately NOT returned. profiles.language is `not null
   default 'Hindi'`, and the store overwrites the app's language with
   whatever this response carries, so returning the column default would
   flip a fresh English session into Hindi on first load and override the
   choice made on the landing page. The column is still written when the
   client sends it, because the ASHA notification fan-out reads it to pick
   the language a broadcast goes out in.
   --------------------------------------------------------------------- */

interface VillageMatch {
  kind: "exact" | "relaxed" | "created" | "ambiguous" | "blank" | "unchanged";
  candidateCount: number;
  note: string | null;
}

function shapeProfile(row: Row, villageMatch: VillageMatch | null): Record<string, unknown> {
  return {
    name: row.full_name ?? null,
    phone: row.phone ?? null,
    age: row.age ?? null,
    gender: row.gender ?? null,
    state: row.state ?? null,
    district: row.district ?? null,
    village: row.village ?? null,
    block: row.block ?? null,
    village_id: row.village_id ?? null,
    pincode: row.pincode ?? null,
    category: row.category ?? null,
    has_abha: row.has_abha === true,
    ration_card_type: row.ration_card_type ?? null,
    family_members: row.family_members ?? null,
    is_pregnant_or_lactating:
      row.is_pregnant_or_lactating === null || row.is_pregnant_or_lactating === undefined
        ? null
        : row.is_pregnant_or_lactating === true,
    chronic_conditions: Array.isArray(row.chronic_conditions) ? row.chronic_conditions : [],
    consents: row.consents && typeof row.consents === "object" ? row.consents : {},
    saved_schemes: Array.isArray(row.saved_schemes) ? row.saved_schemes : [],
    updated_at: row.updated_at ?? null,
    ...(villageMatch ? { villageMatch } : {}),
  };
}

/* ---------------------------------------------------------------------
   Village resolution
   --------------------------------------------------------------------- */

function villageNote(
  kind: VillageMatch["kind"],
  count: number,
  village: string | null,
  district: string | null,
): string | null {
  switch (kind) {
    case "ambiguous":
      return (
        `There are ${count} villages called ${village} in ${district ?? "that district"}, so ` +
        `we have not linked you to any of them yet — the wrong one would put you in touch ` +
        `with an ASHA worker who does not cover your household. Add your block and save again.`
      );
    case "created":
      return (
        `${village} is not yet on the map in this app, so it has been added. No ASHA worker ` +
        `is mapped to it yet; when one registers for your village she will appear here.`
      );
    case "blank":
      return (
        "No village saved, so we cannot tell you who your ASHA worker is. " +
        "Your village is the only thing that decides that."
      );
    default:
      return null;
  }
}

/**
 * Asks the database which village row the typed name means.
 *
 * Service role on purpose: resolve_village() may insert into
 * public.villages, which villages_write reserves for admins, and its
 * EXECUTE grant is service-role only for that reason. What keeps this
 * safe is that the caller cannot pass a village_id — only text, which the
 * function either matches or refuses.
 */
async function resolveVillage(
  village: string | null,
  block: string | null,
  district: string | null,
  state: string | null,
): Promise<{ villageId: string | null; kind: VillageMatch["kind"]; count: number }> {
  if (!village) return { villageId: null, kind: "blank", count: 0 };

  const { data, error } = await admin().rpc("resolve_village", {
    p_name: village,
    p_block: block,
    p_district: district,
    p_state: state,
  });

  if (error) {
    if (/could not find the function|does not exist/i.test(error.message)) {
      throw new HttpError(
        500,
        "The village resolver is missing from the database, so your village cannot be " +
          "linked to your ASHA worker. Run supabase/10_profile_village.sql.",
      );
    }
    throw new HttpError(500, `Could not look up your village: ${error.message}`);
  }

  // A returns-table function comes back as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) return { villageId: null, kind: "blank", count: 0 };

  return {
    villageId: (row.village_id as string | null) ?? null,
    kind: (row.match_kind as VillageMatch["kind"]) ?? "blank",
    count: Number(row.candidate_count ?? 0),
  };
}

async function readOwnProfile(caller: Caller): Promise<Row> {
  // Read as the caller: profiles_select_own is what allows it, and using
  // her own token here means that policy is exercised on every load
  // rather than only in whatever test remembered to check it.
  const { data, error } = await asUser(caller.token)
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", caller.id)
    .maybeSingle();

  if (error) {
    if (error.code === "42703") {
      throw new HttpError(
        500,
        "Your profile is missing some columns this app writes. Run " +
          "supabase/10_profile_village.sql in the SQL editor, then try again.",
      );
    }
    throw new HttpError(500, `Could not read your details: ${error.message}`);
  }
  if (!data) {
    throw new HttpError(
      404,
      "No profile row exists for this account. Run supabase/01_schema.sql so the " +
        "on_auth_user_created trigger is installed, then sign in again.",
    );
  }
  return data as Row;
}

// =====================================================================
// GET /profile
// =====================================================================

profileRouter.get(
  "/profile",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const row = await readOwnProfile(caller);

    // Somebody who typed a village but has no village_id is either mid-way
    // through 10_profile_village.sql's backfill or hit an ambiguity. Say
    // so on read, rather than leaving the contact card to explain a
    // silence it cannot account for.
    const stranded =
      !row.village_id && typeof row.village === "string" && row.village.trim() !== "";

    // villageMatch is always present, never omitted. The client merges
    // this response into its store, so a key that disappears leaves the
    // previous value behind — an ambiguity the person has since resolved
    // would keep being reported at her.
    res.json(
      shapeProfile(
        row,
        stranded
          ? {
              kind: "ambiguous",
              candidateCount: 0,
              note:
                `Your village is saved as ${row.village} but it has not been matched to a ` +
                `village record yet, so we cannot yet tell you who your ASHA worker is. ` +
                `Open My details, add your block, and save.`,
            }
          : { kind: "unchanged", candidateCount: 0, note: null },
      ),
    );
  }),
);

// =====================================================================
// PATCH /profile
// =====================================================================

profileRouter.patch(
  "/profile",
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Send an object of the fields you want to change.");
    }
    if ("role" in body) {
      throw new HttpError(
        403,
        "A role cannot be set from here. An ASHA worker is verified against the " +
          "roster or approved by a supervisor.",
      );
    }
    if ("village_id" in body || "villageId" in body) {
      throw new HttpError(
        400,
        "village_id is worked out from the village you type, not sent. Send `village` " +
          "(and `block` if two villages nearby share a name).",
      );
    }

    const current = await readOwnProfile(caller);

    /* ---- build the patch, column by column ---- */
    const patch: Row = {};
    const set = (column: string, value: unknown) => {
      if (value !== undefined) patch[column] = value;
    };

    set("full_name", textField(body.name, "Name", 120));
    set("phone", textField(body.phone, "Phone number", 24));
    set("age", intField(body.age, "Age", 0, 130));
    set("gender", textField(body.gender, "Gender", 32));
    set("state", textField(body.state, "State", 80));
    set("district", textField(body.district, "District", 80));
    set("village", textField(body.village, "Village", 120));
    set("block", textField(body.block, "Block", 80));
    set("category", textField(body.category, "Category", 40));
    set("ration_card_type", textField(body.ration_card_type, "Ration card type", 64));
    set("family_members", intField(body.family_members, "Number of family members", 1, 60));
    set(
      "is_pregnant_or_lactating",
      boolField(body.is_pregnant_or_lactating, "Pregnant or lactating"),
    );
    set("chronic_conditions", listField(body.chronic_conditions, "Ongoing conditions", 20, 80));
    set("saved_schemes", listField(body.saved_schemes, "Saved schemes", 200, 80));
    set("language", textField(body.language, "Language", 40));

    if (body.has_abha !== undefined) {
      const flag = boolField(body.has_abha, "ABHA");
      if (flag !== null && flag !== undefined) patch.has_abha = flag;
    }

    const pincode = textField(body.pincode, "PIN code", 6);
    if (pincode !== undefined) {
      if (pincode !== null && !PINCODE_RE.test(pincode)) {
        throw new HttpError(400, "A PIN code is six digits and does not start with zero.");
      }
      patch.pincode = pincode;
    }

    // Consents merge rather than replace, because the dialog that collects
    // them can be shown one section at a time and a partial answer must
    // not read as a withdrawal of the others.
    const consents = consentsField(body.consents);
    if (consents !== undefined) {
      const existing =
        current.consents && typeof current.consents === "object" ? current.consents : {};
      const merged = { ...existing, ...consents };
      patch.consents = merged;

      // consent_voice and consent_data predate the jsonb column and are
      // what 02_rls.sql-era code reads. Mirrored, never diverged: two
      // columns claiming different things about the same permission is
      // worse than one.
      if ("voice_processing" in consents) patch.consent_voice = consents.voice_processing;
      if ("asha_referral_consent" in consents) patch.consent_data = consents.asha_referral_consent;
    }

    /* ---- the village, which is the whole point ---- */

    // Merge patch over current, so resolution uses the full picture even
    // when only one of the four parts was edited.
    const effective = {
      village: (patch.village !== undefined ? patch.village : current.village) as string | null,
      block: (patch.block !== undefined ? patch.block : current.block) as string | null,
      district: (patch.district !== undefined ? patch.district : current.district) as string | null,
      state: (patch.state !== undefined ? patch.state : current.state) as string | null,
    };

    const villageTouched =
      patch.village !== undefined ||
      patch.block !== undefined ||
      patch.district !== undefined ||
      patch.state !== undefined;

    // Also re-resolve when nothing about the village changed but it was
    // never linked. That is the self-healing path for every account that
    // saved a village while the old handler was throwing it away.
    const needsResolution =
      villageTouched || (!current.village_id && !!(effective.village ?? "").trim());

    let match: VillageMatch = { kind: "unchanged", candidateCount: 0, note: null };
    let nextVillageId: string | null | undefined;

    if (needsResolution) {
      const resolved = await resolveVillage(
        effective.village,
        effective.block,
        effective.district,
        effective.state,
      );
      match = {
        kind: resolved.kind,
        candidateCount: resolved.count,
        note: villageNote(resolved.kind, resolved.count, effective.village, effective.district),
      };

      if (resolved.kind === "ambiguous") {
        // Leave whatever link she already had alone. Replacing a working
        // link with null because a later edit was ambiguous would take her
        // worker away for no reason she could see.
        nextVillageId = undefined;
      } else if (resolved.villageId !== (current.village_id ?? null)) {
        nextVillageId = resolved.villageId;
      }
    }

    if (Object.keys(patch).length === 0 && nextVillageId === undefined) {
      res.json(shapeProfile(current, match));
      return;
    }

    /* ---- write ---- */

    if (Object.keys(patch).length > 0) {
      // As the caller. profiles_update_own decides it, and the
      // column-level grant from 10_profile_village.sql is what would
      // refuse village_id if this ever tried to smuggle it through.
      const { error } = await asUser(caller.token)
        .from("profiles")
        .update(patch)
        .eq("id", caller.id);

      if (error) {
        if (error.code === "42501") {
          throw new HttpError(
            403,
            "The database refused this change. If it names a column, that column is " +
              "not one an account may set for itself.",
          );
        }
        if (error.code === "42703") {
          throw new HttpError(
            500,
            "Your profile is missing a column this form writes. Run " +
              "supabase/10_profile_village.sql, then save again.",
          );
        }
        if (error.code === "23514") {
          throw new HttpError(400, `One of those values is out of range: ${error.message}`);
        }
        throw new HttpError(500, `Could not save your details: ${error.message}`);
      }
    }

    if (nextVillageId !== undefined) {
      // Service role, because UPDATE (village_id) is granted to nobody but
      // the service role and the claim functions. This is the one column
      // on this table a person may not choose for herself: it decides
      // which ASHA worker sees her and which broadcasts reach her.
      const { error } = await admin()
        .from("profiles")
        .update({ village_id: nextVillageId })
        .eq("id", caller.id);

      if (error) {
        throw new HttpError(
          500,
          `Your details were saved, but linking you to ${effective.village} failed, so ` +
            `your ASHA worker will not appear yet: ${error.message}`,
        );
      }
    }

    const saved = await readOwnProfile(caller);

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "profile.updated",
      entity: "profiles",
      entityId: caller.id,
      // Field NAMES only. A phone number, a village or a chronic condition
      // must never reach the audit trail, which is read by admins.
      detail: {
        fields: Object.keys(patch),
        village_link: match.kind,
        village_relinked: nextVillageId !== undefined,
      },
      ip: req.ip ?? null,
    });

    res.json(shapeProfile(saved, match));
  }),
);
