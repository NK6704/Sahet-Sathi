import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { HttpError, handler, requireAsha, requireAuth, type Caller } from "../lib/auth";
import { admin, asUser, audit } from "../lib/supabaseAdmin";
import {
  maskNumber,
  normaliseMobile,
  sendSmsBatch,
  smsAvailability,
  type SmsOutcome,
} from "../lib/twilio";

/* =====================================================================
   SOS — the emergency path, and the record of what actually happened.

   This router exists to make one promise and keep it: when somebody
   presses the emergency button, something real happens and the app tells
   them exactly what. On the machine this was written for, Twilio is half
   configured — an API key pair is set, the Account SID is blank and there
   is no sender — so no SMS can leave this server at all. That does not
   make the feature unavailable. It makes the feature honest.

   Two things happen on a broadcast, and they are independent on purpose.
   The in-app path writes a critical asha_alerts row for the worker
   covering the village, which needs no third party and therefore works
   today. The SMS path hands every intended recipient to the Twilio
   adapter, which returns 'skipped' with the missing variables named, and
   each of those recipients still gets a sos_deliveries row carrying that
   reason. Nobody is told a message was sent. Nobody is left wondering why
   the phone never rang. If the SMS path fails entirely the alert still
   reaches the worker, and if no worker is mapped to the village the SMS
   path still runs, because an emergency that gives up at the first
   missing piece is not an emergency system.

   The hospital list is snapshotted rather than looked up on read. The
   PM-JAY registry is re-imported and hospitals are de-empanelled out of
   it, so the only defensible answer to "which hospital was this family
   told about" is the one written into sos_broadcasts.nearest_hospitals at
   the moment of the call. When no coordinate was shared there is no
   snapshot and the response says so; the village centroid is deliberately
   not used as a stand-in, because a village can be twenty kilometres
   across and sending somebody having a heart attack to the wrong hospital
   is materially worse than admitting we do not know where they are.

   On which key does what. Everything the caller is entitled to do for
   themselves goes through asUser() and is therefore authorised by the
   policies in 06_platform_rls.sql rather than by this file being careful:
   raising the SOS, reading their own, resolving it, and their whole
   emergency contact list. Two things cannot work that way and both are
   commented at the site. Writing into another worker's asha_alerts queue
   is not something a citizen has any insert path for, and sos_deliveries
   has no INSERT policy at all by design, because a delivery record the
   subject could forge would be worthless as evidence that anyone was told.

   Nothing here logs a phone number in full. maskNumber() from the SMS
   adapter is used for every log line and for every audit detail, while
   the HTTP response does carry real numbers — the caller owns their own
   contact list, and asha_for_village is security definer precisely so a
   villager may see the name and number of the worker covering them.
   ===================================================================== */

export const sosRouter = Router();

// ---------------------------------------------------------------------
// Running the auth guards
//
// handler() in server/lib/auth.ts wraps an async function and forwards a
// rejection to next(err), which is exactly right for a terminal route
// handler because such a handler ends the exchange by sending a response.
// It does not call next() when the function resolves, and requireAuth,
// requireRole and therefore requireAsha are all built with it. Used
// directly as middleware they would resolve, send nothing and call
// nothing, and Express would hold the request open until the client gave
// up — a hang rather than an error, which is the worst failure mode to
// put in front of an emergency button.
//
// The fix belongs in handler() and is one line, so it is not made here:
// this file was asked to add two files and change none. Instead every
// route below runs its guards through runGuards(), which awaits each one,
// treats a next(err) as the error it is, and continues the chain itself.
// Once handler() calls next() on success this wrapper becomes a harmless
// pass-through rather than something that has to be unpicked.
// ---------------------------------------------------------------------

type Guard = (req: Request, res: Response, next: NextFunction) => unknown;

function runGuards(...guards: Array<Guard | Guard[]>): RequestHandler {
  const chain = guards.flat() as Guard[];
  return async (req, res, next) => {
    try {
      for (const guard of chain) {
        let handedOn = false;
        let forwarded: unknown;
        await guard(req, res, ((err?: unknown) => {
          handedOn = true;
          forwarded = err;
        }) as NextFunction);

        // A guard that called next(err) is rejecting the request; rethrow
        // so the shared error middleware renders it with its own status.
        if (handedOn && forwarded) throw forwarded;
        // A guard that answered the request itself has finished the
        // exchange, and continuing would try to write a second response.
        if (res.headersSent) return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------
// Reading a request
// ---------------------------------------------------------------------

/**
 * The guards have already run wherever this is called, so a missing
 * caller is a wiring mistake rather than an anonymous request. It still
 * answers 401 instead of throwing a TypeError, because a 500 on the
 * emergency route would look like a database outage during a demo.
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

/**
 * Names the field that was empty and then says what it is for. A form
 * that answers "validation failed" makes the person retype everything to
 * find out which box was the problem.
 */
function requiredField(value: unknown, field: string, what: string): string {
  const out = str(value);
  if (!out) throw new HttpError(400, `${field} is missing or empty. ${what}`);
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres rejects a malformed uuid with a 22P02, which would surface as
 * a 500. A path parameter that is obviously not an id is a bad request.
 */
function uuidParam(value: unknown, label: string): string {
  const out = requiredField(value, label, "It should be an id.");
  if (!UUID_RE.test(out)) throw new HttpError(400, `${label} is not a valid id.`);
  return out;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// ---------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------

/**
 * Fifty kilometres, which is wider than the fifteen the ordinary hospital
 * search defaults to. In an emergency a hospital forty kilometres away is
 * still worth naming, and the radius is stated in the response so nobody
 * reads "nearest" as "close".
 */
const HOSPITAL_RADIUS_KM = 50;

/**
 * Five. The snapshot is written into a jsonb column on every SOS row, so
 * it is kept to the handful somebody would actually ring rather than
 * everything inside the radius.
 */
const HOSPITAL_LIMIT = 5;

/**
 * Three hundred characters is two SMS segments with room to spare, and it
 * is the ceiling the message composer is built to respect. Longer costs
 * more per recipient and gets no more read.
 */
const MESSAGE_CEILING = 300;

/** The statuses an SOS is still live in, which is what a queue means. */
const ACTIVE_STATUSES = ["open", "acknowledged"] as const;

const SOS_STATUSES = ["open", "acknowledged", "resolved", "cancelled"] as const;

/**
 * Reasons written by this file rather than by the SMS adapter. Constants
 * for the same reason the adapter's are: sos_deliveries.error is queried
 * by reason when somebody asks why a village stopped receiving alerts.
 */
const REASON_NO_VILLAGE =
  "no village is set on this account, so no ASHA worker could be found to alert";
const REASON_NO_WORKER =
  "no ASHA worker is mapped to this village, so no in-app alert could be queued";
const REASON_WORKER_NO_PHONE =
  "no phone number is on record for this ASHA worker";
const REASON_MISSING =
  "no reason was recorded, which is a bug in the SOS route rather than a silent delivery";

// ---------------------------------------------------------------------
// Shaping rows for a screen
// ---------------------------------------------------------------------

type Row = Record<string, any>;

/**
 * Note what is *not* here: nothing is invented. A null stays null so the
 * UI can omit the line rather than render an empty one, and no field is
 * filled in from a neighbouring row.
 */
function shapeSos(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    patientName: row.patient_name ?? null,
    contactPhone: row.contact_phone ?? null,
    category: row.category ?? null,
    symptoms: row.symptoms ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    accuracyM: row.accuracy_m ?? null,
    locationNote: row.location_note ?? null,
    villageId: row.village_id ?? null,
    status: row.status ?? null,
    alertId: row.alert_id ?? null,
    acknowledgedBy: row.acknowledged_by ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    outcome: row.outcome ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * sos_deliveries.error is surfaced as `reason`, because on a skipped row
 * it is not an error at all — it is the explanation for a deliberate
 * silence, and calling it an error on screen would misdescribe the most
 * common outcome this app currently produces.
 */
function shapeDelivery(row: Row): Record<string, unknown> {
  return {
    id: row.id ?? null,
    channel: row.channel,
    recipientKind: row.recipient_kind,
    recipientName: row.recipient_name ?? null,
    recipientPhone: row.recipient_phone ?? null,
    recipientUserId: row.recipient_user_id ?? null,
    status: row.status,
    provider: row.provider ?? null,
    providerId: row.provider_message_id ?? null,
    reason: row.error ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

/**
 * What gets frozen into sos_broadcasts.nearest_hospitals. Trimmed to the
 * fields somebody acts on, and contactVerified is carried because the
 * PM-JAY listing is official while the phone number in it has never been
 * dialled by anyone here — a screen that presents the two as equally
 * reliable is making a claim the data does not support.
 */
function hospitalSnapshot(row: Row): Record<string, unknown> {
  return {
    id: row.id ?? null,
    facilityId: row.facility_id ?? null,
    name: row.name ?? null,
    address: row.address ?? null,
    phone: row.phone ?? null,
    mobile: row.mobile ?? null,
    typeCode: row.type_code ?? null,
    facilityType: row.facility_type ?? null,
    district: row.district_name ?? null,
    state: row.state_name ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    distanceKm: row.distance_km ?? null,
    contactVerified: row.contact_verified === true,
    verification: row.verification ?? null,
    source: row.source ?? null,
  };
}

function shapeContact(row: Row): Record<string, unknown> {
  const normalised = normaliseMobile(row.phone);
  return {
    id: row.id,
    name: row.name ?? null,
    phone: row.phone ?? null,
    // The E.164 form an SMS would actually be addressed to, and whether
    // one is possible at all. A row saved before this validation existed
    // can carry a number no provider will accept, and the list is the
    // right place to show that rather than the delivery log afterwards.
    normalisedPhone: normalised,
    smsReachable: Boolean(normalised),
    relationship: row.relationship ?? null,
    priority: row.priority ?? null,
    notifySms: row.notify_sms === true,
    notifyVoice: row.notify_voice === true,
    createdAt: row.created_at ?? null,
  };
}

// ---------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------

/**
 * Trims to a length with three dots rather than a single ellipsis
 * character. An ellipsis is outside the GSM-7 alphabet and one such
 * character forces the whole message into UCS-2, which halves the
 * characters per segment — so the tidier punctuation would cost a segment
 * on every message.
 */
function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(limit - 3, 1))}...`;
}

/**
 * The SMS a relative receives. Everything in it is something they can act
 * on without opening the app: who it is about, what kind of emergency,
 * the number to ring back, and where the nearest empanelled hospital is
 * when we know. Each free-text piece is clipped before assembly so that a
 * pasted paragraph in the symptoms box cannot push the callback number
 * off the end of the message — the number is the part that has to survive.
 */
function composeMessage(input: {
  patientName: string;
  category: string;
  contactPhone: string;
  hospitalName: string | null;
  hospitalDistanceKm: number | null;
}): string {
  const pieces = [
    `SOS: ${clip(input.patientName, 40)} needs urgent help.`,
    `${clip(input.category, 60)}.`,
    `Call ${clip(input.contactPhone, 20)}.`,
  ];

  if (input.hospitalName) {
    const distance =
      typeof input.hospitalDistanceKm === "number"
        ? ` (${input.hospitalDistanceKm} km)`
        : "";
    pieces.push(`Nearest PM-JAY hospital: ${clip(input.hospitalName, 60)}${distance}.`);
  }

  // Named so the recipient knows this was raised through the app and is
  // not a scam message asking them to ring a stranger.
  pieces.push("Sent by Sehat Sathi.");

  return clip(pieces.join(" "), MESSAGE_CEILING);
}

// =====================================================================
// POST /sos/broadcast
// =====================================================================

sosRouter.post(
  "/sos/broadcast",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = req.body ?? {};

    // All four are required, and the 400 names which one was empty. An
    // SOS with no callback number or no category is a row nobody can act
    // on, so it is refused at the door rather than stored as a mystery.
    const patientName = requiredField(
      body.patientName,
      "patientName",
      "Say who this emergency is for.",
    );
    const contactPhone = requiredField(
      body.contactPhone,
      "contactPhone",
      "Give a number the ASHA worker can call back on.",
    );
    const category = requiredField(
      body.category,
      "category",
      "Say what kind of emergency this is.",
    );
    const symptoms = requiredField(
      body.symptoms,
      "symptoms",
      "Describe what is happening, even in a few words.",
    );

    const latitude = finite(body.latitude);
    const longitude = finite(body.longitude);

    // Half a coordinate is not a location. Guessing the other half from
    // the village would produce a distance-sorted hospital list that
    // looks authoritative and is not.
    if ((latitude === null) !== (longitude === null)) {
      throw new HttpError(
        400,
        "latitude and longitude have to be sent together. One on its own is not a " +
          "location and cannot be used to find a hospital.",
      );
    }
    if (
      latitude !== null &&
      (latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)
    ) {
      throw new HttpError(400, "latitude and longitude are outside the possible range.");
    }

    // Defaults to the caller's own village, which is what the RLS policy
    // sos_select then uses to decide which worker may see this.
    const villageId =
      str(body.villageId) === null ? caller.villageId : uuidParam(body.villageId, "villageId");

    // The form's free-text "notes" field lands in location_note, which is
    // the only free-text column on the table and is what it was for: "by
    // the school, blue gate". It is repeated into the worker's alert below
    // so she reads it without opening the SOS.
    const notes = str(body.notes);

    // -----------------------------------------------------------------
    // 1. Snapshot the hospitals
    // -----------------------------------------------------------------
    let nearestHospitals: Array<Record<string, unknown>> = [];
    let hospitalsNote: string | null = null;
    const locationShared = latitude !== null && longitude !== null;

    if (locationShared) {
      const { data, error } = await admin().rpc("hospitals_nearby", {
        p_lat: latitude,
        p_lng: longitude,
        p_radius_km: HOSPITAL_RADIUS_KM,
        p_limit: HOSPITAL_LIMIT,
      });

      if (error) {
        // Never fatal. Losing the hospital list is a smaller harm than
        // losing the emergency, so this is recorded and the broadcast
        // carries on with an empty snapshot.
        console.warn("[sos] hospitals_nearby failed: %s", error.message);
        hospitalsNote =
          `The hospital registry could not be searched (${error.message}), so no ` +
          "hospital list is attached to this SOS. Everything else below still happened.";
      } else {
        nearestHospitals = ((data ?? []) as Row[]).map(hospitalSnapshot);
        if (nearestHospitals.length === 0) {
          hospitalsNote =
            `No PM-JAY empanelled hospital is listed within ${HOSPITAL_RADIUS_KM} km of ` +
            "the location you shared. The search was not widened, and this registry " +
            "covers empanelled hospitals only, so a hospital that exists may simply " +
            "not be in it.";
        }
      }
    } else {
      hospitalsNote =
        "Location was not shared, so no hospital list could be produced. The village " +
        "centre was deliberately not used instead: a wrong hospital in an emergency " +
        "is worse than no hospital.";
    }

    // -----------------------------------------------------------------
    // 2. Record the SOS, as the caller
    //
    // asUser() rather than admin(), so the sos_insert policy is what
    // confirms user_id = auth.uid(). Ownership of an emergency record is
    // exactly the sort of thing that should be enforced by the database
    // and exercised on every single call.
    // -----------------------------------------------------------------
    const { data: created, error: insertError } = await asUser(caller.token)
      .from("sos_broadcasts")
      .insert({
        user_id: caller.id,
        patient_name: patientName,
        contact_phone: contactPhone,
        category,
        symptoms,
        latitude,
        longitude,
        location_note: notes,
        village_id: villageId,
        nearest_hospitals: nearestHospitals,
        status: "open",
      })
      .select("*")
      .single();

    if (insertError) {
      if (insertError.code === "42501") {
        throw new HttpError(403, "An SOS can only be raised for your own account.");
      }
      throw new HttpError(500, `Could not record the SOS: ${insertError.message}`);
    }

    const sosRow = created as Row;

    // -----------------------------------------------------------------
    // 3. Put it in the covering worker's queue
    // -----------------------------------------------------------------
    let villageName: string | null = null;
    let worker: Row | null = null;
    let ashaNote: string | null = null;

    if (villageId) {
      // Only the name is read. The village row also carries a centroid,
      // and selecting it here would invite somebody to fall back on it
      // for the hospital search that step 1 refused to fake.
      const { data: village } = await admin()
        .from("villages")
        .select("name")
        .eq("id", villageId)
        .maybeSingle();
      villageName = village?.name ?? null;

      // asha_for_village is security definer and returns just the name,
      // phone, code and sub-centre, which is precisely so a citizen can
      // reach their worker without being able to enumerate every worker
      // in the state.
      const { data: workers, error: workerError } = await admin().rpc("asha_for_village", {
        p_village_id: villageId,
      });

      if (workerError) {
        console.warn("[sos] asha_for_village failed: %s", workerError.message);
        ashaNote =
          `The ASHA worker for this village could not be looked up ` +
          `(${workerError.message}), so no in-app alert was queued. The SMS path ran ` +
          "independently and its results are below.";
      } else {
        // Ordered is_primary first by the function, so the first row is
        // the worker who owns this village rather than a stand-in.
        worker = ((workers ?? []) as Row[])[0] ?? null;
        if (!worker) {
          ashaNote =
            "No ASHA worker is mapped to this village yet, so nobody will see this in " +
            "the portal queue. Tell your block office, and in the meantime rely on the " +
            "phone numbers below.";
        }
      }
    } else {
      ashaNote =
        "Your profile has no village set, so there is no ASHA worker to route this to. " +
        "Set your village in your profile so the next emergency reaches somebody.";
    }

    let alertId: string | null = null;
    let inAppStatus: "sent" | "skipped" | "failed" = "skipped";
    let inAppReason: string | null = villageId ? REASON_NO_WORKER : REASON_NO_VILLAGE;

    if (worker?.asha_user_id) {
      const alertBody = [
        `${patientName} — ${category}.`,
        symptoms,
        notes ? `Location note: ${notes}` : null,
        `Call back on ${contactPhone}.`,
        locationShared
          ? `Shared location: ${latitude}, ${longitude}.`
          : "No location was shared.",
        nearestHospitals.length > 0
          ? `Nearest empanelled hospital on record: ${nearestHospitals[0].name}.`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      // admin(), and this is the one insert in this file that genuinely
      // needs it. A citizen has no insert path into another worker's
      // alert queue and should not have one — asha_alerts is hers — so the
      // server writes the row on the citizen's behalf after deciding, from
      // the village mapping rather than from anything the client sent,
      // which worker it belongs to.
      const { data: alert, error: alertError } = await admin()
        .from("asha_alerts")
        .insert({
          asha_id: worker.asha_user_id,
          citizen_id: caller.id,
          // Denormalised deliberately: an alert has to stay readable even
          // if the citizen's profile is later removed.
          citizen_name: patientName,
          citizen_phone: contactPhone,
          village: villageName,
          title: `EMERGENCY SOS — ${clip(category, 80)}`,
          body: alertBody,
          category: "emergency",
          // Critical and new, always. An SOS is the highest severity this
          // app can raise and it must sort to the top of her queue.
          severity: "critical",
          status: "new",
          source: "emergency_button",
        })
        .select("id")
        .single();

      if (alertError) {
        console.warn("[sos] could not queue asha_alert: %s", alertError.message);
        inAppStatus = "failed";
        inAppReason = `Could not queue the in-app alert: ${alertError.message}`;
        ashaNote =
          "The alert could not be written into the worker's queue, so she will not see " +
          "this in the portal. The delivery record below says why.";
      } else {
        alertId = (alert as Row).id;
        inAppStatus = "sent";
        inAppReason = null;

        // Link the two records together, as the caller, so the
        // sos_update policy is the authority even for a housekeeping
        // write. A failure here loses the cross-reference and nothing
        // else, so it is logged rather than thrown.
        const { error: linkError } = await asUser(caller.token)
          .from("sos_broadcasts")
          .update({ alert_id: alertId })
          .eq("id", sosRow.id);
        if (linkError) {
          console.warn("[sos] could not link alert to broadcast: %s", linkError.message);
        } else {
          sosRow.alert_id = alertId;
        }
      }
    }

    // -----------------------------------------------------------------
    // 4. The SMS fan-out
    // -----------------------------------------------------------------
    let contactsNote: string | null = null;

    // Read as the caller. emergency_contacts_own scopes this to their own
    // rows, and an ASHA is given no read access to it at all, so this is
    // the only key that can see the list.
    const { data: contactRows, error: contactsError } = await asUser(caller.token)
      .from("emergency_contacts")
      .select("id, name, phone, relationship, priority, notify_sms")
      .eq("user_id", caller.id)
      .eq("notify_sms", true)
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (contactsError) {
      console.warn("[sos] could not read emergency contacts: %s", contactsError.message);
      contactsNote =
        `Your emergency contact list could not be read (${contactsError.message}), so no ` +
        "text messages were attempted. The in-app alert above is unaffected.";
    }

    type Recipient = {
      kind: "emergency_contact" | "asha";
      name: string | null;
      phone: string;
      userId: string | null;
    };

    const recipients: Recipient[] = [];
    const seenNumbers = new Set<string>();

    function addRecipient(candidate: Recipient): boolean {
      // Keyed on the normalised form so 98261-55443 and +919826155443 are
      // recognised as one person. A relative who is also the village
      // worker should get one message, not two, and the first entry wins
      // because contacts arrive in the order the family chose.
      const key = normaliseMobile(candidate.phone) ?? candidate.phone.trim();
      if (seenNumbers.has(key)) return false;
      seenNumbers.add(key);
      recipients.push(candidate);
      return true;
    }

    for (const row of (contactRows ?? []) as Row[]) {
      addRecipient({
        kind: "emergency_contact",
        name: row.name ?? null,
        phone: String(row.phone ?? ""),
        userId: null,
      });
    }

    // The worker gets a text as well as the in-app alert when we have a
    // number for her, because she may not be looking at the portal.
    let workerPhoneMissing = false;
    if (worker?.asha_user_id) {
      const workerPhone = str(worker.phone);
      if (workerPhone) {
        addRecipient({
          kind: "asha",
          name: worker.full_name ?? null,
          phone: workerPhone,
          userId: worker.asha_user_id,
        });
      } else {
        // Recorded rather than passed over. "We had no number for her" is
        // a fact somebody has to be able to find out afterwards.
        workerPhoneMissing = true;
      }
    }

    const topHospital = nearestHospitals[0] as Row | undefined;
    const messageBody = composeMessage({
      patientName,
      category,
      contactPhone,
      hospitalName: (topHospital?.name as string) ?? null,
      hospitalDistanceKm:
        typeof topHospital?.distanceKm === "number" ? topHospital.distanceKm : null,
    });

    const availability = smsAvailability();

    // Never rejects, and caps itself at five in flight. The outcomes come
    // back in the same order as the recipients.
    const outcomes: SmsOutcome[] =
      recipients.length > 0
        ? await sendSmsBatch(recipients.map((r) => ({ to: r.phone, body: messageBody })))
        : [];

    // -----------------------------------------------------------------
    // The delivery log
    //
    // admin(), and commented because it is the second deliberate use of
    // the service role here: sos_deliveries has no INSERT and no UPDATE
    // policy at all, so the server is the only writer. The citizen must
    // not be able to forge a delivery record, since the whole value of
    // this table is answering "was my mother actually told" with
    // something nobody involved could have edited.
    // -----------------------------------------------------------------
    const nowIso = new Date().toISOString();
    const deliveryRows: Row[] = [];

    deliveryRows.push({
      sos_id: sosRow.id,
      channel: "in_app",
      recipient_kind: "asha",
      recipient_name: worker?.full_name ?? null,
      recipient_phone: null,
      recipient_user_id: worker?.asha_user_id ?? null,
      status: inAppStatus,
      provider: inAppStatus === "skipped" ? null : "in_app",
      provider_message_id: alertId,
      // The schema's rule: never null on a row that is not 'sent'.
      error: inAppStatus === "sent" ? null : inAppReason ?? REASON_MISSING,
      sent_at: inAppStatus === "sent" ? nowIso : null,
    });

    if (workerPhoneMissing) {
      deliveryRows.push({
        sos_id: sosRow.id,
        channel: "sms",
        recipient_kind: "asha",
        recipient_name: worker?.full_name ?? null,
        recipient_phone: null,
        recipient_user_id: worker?.asha_user_id ?? null,
        status: "skipped",
        provider: null,
        provider_message_id: null,
        error: REASON_WORKER_NO_PHONE,
        sent_at: null,
      });
    }

    recipients.forEach((recipient, index) => {
      const outcome = outcomes[index] ?? {
        channel: "sms" as const,
        status: "failed" as const,
        reason: REASON_MISSING,
      };
      deliveryRows.push({
        sos_id: sosRow.id,
        channel: "sms",
        recipient_kind: recipient.kind,
        recipient_name: recipient.name,
        // Stored as it was held, because that is what was attempted.
        recipient_phone: recipient.phone,
        recipient_user_id: recipient.userId,
        status: outcome.status,
        // Null on a skip: no provider was involved in a message we never
        // handed over, and naming Twilio there would imply it refused.
        provider: outcome.status === "skipped" ? null : "twilio",
        provider_message_id: outcome.providerId ?? null,
        error: outcome.status === "sent" ? null : outcome.reason ?? REASON_MISSING,
        sent_at: outcome.status === "sent" ? nowIso : null,
      });
    });

    let deliveries: Array<Record<string, unknown>> = [];
    let deliveryLogNote: string | null = null;

    const { data: savedDeliveries, error: deliveryError } = await admin()
      .from("sos_deliveries")
      .insert(deliveryRows)
      .select("*");

    if (deliveryError) {
      // The messages were already attempted, so the response still
      // reports what happened; it just says that the permanent record of
      // it is missing, which is a different and worse problem than a
      // failed send and must not be hidden.
      console.warn("[sos] could not write delivery rows: %s", deliveryError.message);
      deliveries = deliveryRows.map(shapeDelivery);
      deliveryLogNote =
        `The delivery log could not be written (${deliveryError.message}). What is ` +
        "listed below is what this request attempted, but it has not been stored, so " +
        "it will not appear when you open this SOS again.";
    } else {
      deliveries = ((savedDeliveries ?? []) as Row[]).map(shapeDelivery);
    }

    // -----------------------------------------------------------------
    // 5. Say what happened, in words
    // -----------------------------------------------------------------
    const smsRows = deliveries.filter((d) => d.channel === "sms");
    const sentCount = smsRows.filter((d) => d.status === "sent").length;
    const skippedCount = smsRows.filter((d) => d.status === "skipped").length;
    const failedCount = smsRows.filter((d) => d.status === "failed").length;

    const noteParts: string[] = [];

    if (!availability.ready) {
      noteParts.push(
        `${availability.reason}, so your ${skippedCount} contact(s) were recorded but ` +
          "not messaged — each one has a delivery row marked skipped with that same " +
          "reason. No text message left this server.",
      );
    } else if (smsRows.length === 0) {
      noteParts.push(
        "No SMS recipient was on record, so nobody was texted. Add people under " +
          "emergency contacts with SMS turned on so the next emergency reaches them.",
      );
    } else {
      noteParts.push(
        `${sentCount} of ${smsRows.length} message(s) were accepted by Twilio for ` +
          `delivery${failedCount > 0 ? `, ${failedCount} failed` : ""}` +
          `${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}. Accepted means ` +
          "handed to the network, not that a phone has rung.",
      );
    }

    if (inAppStatus === "sent") {
      noteParts.push(
        `The ASHA worker covering ${villageName ?? "your village"} will see this at the ` +
          "top of her portal queue, marked critical.",
      );
    } else if (ashaNote) {
      noteParts.push(ashaNote);
    }

    if (workerPhoneMissing) {
      noteParts.push(
        "There is no phone number on record for that worker, so she was alerted in the " +
          "app only.",
      );
    }
    if (hospitalsNote) noteParts.push(hospitalsNote);
    if (contactsNote) noteParts.push(contactsNote);
    if (deliveryLogNote) noteParts.push(deliveryLogNote);

    // Masked in the audit detail as well as in the logs. An audit row is
    // a log with a longer memory, and it is readable by every admin.
    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "sos.broadcast",
      entity: "sos_broadcasts",
      entityId: sosRow.id,
      subjectId: caller.id,
      detail: {
        category,
        village_id: villageId,
        village: villageName,
        contact_phone: maskNumber(contactPhone),
        location_shared: locationShared,
        hospitals_snapshotted: nearestHospitals.length,
        alert_id: alertId,
        asha_user_id: worker?.asha_user_id ?? null,
        sms_available: availability.ready,
        sms_sent: sentCount,
        sms_skipped: skippedCount,
        sms_failed: failedCount,
        deliveries: deliveries.map((d) => ({
          channel: d.channel,
          kind: d.recipientKind,
          status: d.status,
          phone: maskNumber(d.recipientPhone),
          reason: d.reason ?? null,
        })),
        delivery_log_written: !deliveryError,
      },
      ip: req.ip ?? null,
    });

    res.status(201).json({
      sos: shapeSos(sosRow),
      // The snapshot as it was stored, not a fresh lookup. Reading this
      // SOS back in a month returns the same list.
      nearestHospitals,
      // False means no coordinate was shared and no hospital list could be
      // produced. The UI has to say that rather than showing an empty list
      // as though nothing were nearby.
      locationShared,
      hospitalsNote,
      alertedAsha:
        worker && alertId
          ? {
              userId: worker.asha_user_id,
              fullName: worker.full_name ?? null,
              // Exposed on purpose: asha_for_village is security definer
              // so that a villager can be given their worker's number.
              phone: worker.phone ?? null,
              ashaCode: worker.asha_code ?? null,
              subCentre: worker.sub_centre ?? null,
              alertId,
            }
          : null,
      ashaNote,
      deliveries,
      smsAvailable: availability.ready,
      note: noteParts.join(" "),
    });
  }),
);

// =====================================================================
// GET /sos/config
//
// Declared before /sos/:id so that 'config' is read as a route and not as
// an id. The warning is the single most useful thing this endpoint
// produces: knowing that SMS is not configured is worth a great deal
// before an emergency and nothing at all during one.
// =====================================================================

sosRouter.get(
  "/sos/config",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const availability = smsAvailability();

    const { data, error } = await asUser(caller.token)
      .from("emergency_contacts")
      .select("id, phone, notify_sms")
      .eq("user_id", caller.id);

    if (error) {
      throw new HttpError(500, `Could not read your emergency contacts: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];
    const contactCount = rows.length;
    const smsContacts = rows.filter((row) => row.notify_sms === true);
    const unreachable = smsContacts.filter((row) => !normaliseMobile(row.phone)).length;

    let warning: string | null = null;
    if (!availability.ready) {
      warning =
        `${availability.reason}. If you raise an SOS now, your ${smsContacts.length} ` +
        "SMS contact(s) will be recorded and marked skipped, and no text message will " +
        "leave this server. The ASHA worker covering your village will still see the " +
        "alert in her portal.";
    } else if (smsContacts.length === 0) {
      warning =
        "SMS is configured, but you have no emergency contact with SMS turned on, so " +
        "an SOS would text nobody. Add at least one.";
    } else if (unreachable > 0) {
      warning =
        `${unreachable} of your SMS contacts have a number that cannot be sent to. ` +
        "Open your emergency contacts and correct them.";
    }

    res.json({
      sms: availability,
      smsAvailable: availability.ready,
      contactCount,
      smsContactCount: smsContacts.length,
      unreachableContactCount: unreachable,
      warning,
      note:
        "The in-app alert to your ASHA worker does not depend on SMS and works even " +
        "when this says SMS is unavailable.",
    });
  }),
);

// =====================================================================
// GET /sos/mine
//
// Also declared before /sos/:id, for the same reason.
// =====================================================================

sosRouter.get(
  "/sos/mine",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const limit = intInRange(req.query.limit, 20, 1, 100);
    const offset = intInRange(req.query.offset, 0, 0, 100000);

    // '*' on both tables is honest here rather than lazy: every column on
    // an SOS and on its deliveries exists to be shown to the person who
    // raised it, and sos_deliveries_select is what limits the embedded
    // rows to the ones belonging to a broadcast this caller may read.
    const { data, error, count } = await asUser(caller.token)
      .from("sos_broadcasts")
      .select("*, sos_deliveries ( * )", { count: "exact" })
      .eq("user_id", caller.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new HttpError(500, `Could not read your SOS history: ${error.message}`);
    }

    const rows = (data ?? []) as Row[];

    res.json({
      sos: rows.map((row) => ({
        ...shapeSos(row),
        nearestHospitals: row.nearest_hospitals ?? [],
        deliveries: ((row.sos_deliveries ?? []) as Row[]).map(shapeDelivery),
      })),
      count: count ?? rows.length,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + rows.length,
      smsAvailable: smsAvailability().ready,
    });
  }),
);

// =====================================================================
// GET /sos/:id
// =====================================================================

sosRouter.get(
  "/sos/:id",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "SOS id");

    // No branch for the ASHA worker here, and none is needed. The
    // sos_select policy already admits the covering worker through
    // asha_covers_village(village_id), so reading this as the caller
    // returns the row for the owner, for the covering worker and for an
    // admin, and returns nothing for anybody else. Adding a role check in
    // this handler would be a second, weaker copy of that rule.
    const { data, error } = await asUser(caller.token)
      .from("sos_broadcasts")
      .select("*, sos_deliveries ( * )")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new HttpError(500, `Could not read that SOS: ${error.message}`);
    if (!data) {
      // 404 rather than 403, deliberately. Telling somebody an SOS exists
      // but is not theirs to read is itself a disclosure.
      throw new HttpError(404, "No SOS with that id is visible to you.");
    }

    const row = data as Row;

    res.json({
      sos: shapeSos(row),
      // The list as it stood when the SOS was raised. Hospitals leave the
      // PM-JAY registry, and re-running the search now could name a
      // different hospital than the family was actually given.
      nearestHospitals: row.nearest_hospitals ?? [],
      deliveries: ((row.sos_deliveries ?? []) as Row[]).map(shapeDelivery),
      note:
        "The hospital list is the snapshot taken when this SOS was raised, not a fresh " +
        "search, so it is what the family was told at the time.",
    });
  }),
);

// =====================================================================
// POST /sos/:id/acknowledge
// =====================================================================

sosRouter.post(
  "/sos/:id/acknowledge",
  runGuards(requireAsha),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "SOS id");
    const client = asUser(caller.token);

    // As the worker, so asha_covers_village in the sos_update policy is
    // the authority on whether this is her village. A service-role update
    // here would let any account with the asha role acknowledge an
    // emergency two districts away.
    const { data, error } = await client
      .from("sos_broadcasts")
      .update({
        status: "acknowledged",
        acknowledged_by: caller.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", id)
      // The status filter is what makes this idempotent and is what turns
      // a second press into a 409 instead of overwriting the first
      // worker's name and time.
      .eq("status", "open")
      .select("*")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not acknowledge that SOS: ${error.message}`);
    }

    if (!data) {
      // Nothing was updated, which is either "not visible to you" or
      // "already handled", and those deserve different answers.
      const { data: existing } = await client
        .from("sos_broadcasts")
        .select("status, acknowledged_at")
        .eq("id", id)
        .maybeSingle();

      if (!existing) {
        throw new HttpError(
          404,
          "No SOS with that id is in a village you cover, so there is nothing to " +
            "acknowledge.",
        );
      }
      throw new HttpError(
        409,
        `That SOS is already ${(existing as Row).status}. Reload the queue to see who ` +
          "picked it up.",
      );
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "sos.acknowledge",
      entity: "sos_broadcasts",
      entityId: id,
      subjectId: (data as Row).user_id ?? null,
      ip: req.ip ?? null,
    });

    res.json({
      ok: true,
      sos: shapeSos(data as Row),
      note:
        "Acknowledged. The family sees that somebody has picked this up; record an " +
        "outcome when it is over.",
    });
  }),
);

// =====================================================================
// POST /sos/:id/resolve
// =====================================================================

sosRouter.post(
  "/sos/:id/resolve",
  // requireAuth rather than requireAsha, because both the family and the
  // covering worker may close this off. Which of them the caller is does
  // not need testing here: the sos_update policy admits the owner, the
  // covering worker and an admin, and nobody else, so the update either
  // matches a row or it does not.
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "SOS id");

    // Required. A resolution with no recorded outcome is not a record of
    // anything — six months later nobody can tell a person who reached
    // hospital from a false alarm from somebody who gave up waiting.
    const outcome = requiredField(
      req.body?.outcome,
      "outcome",
      "Say what happened: an SOS closed with no outcome records nothing.",
    );

    const client = asUser(caller.token);
    const { data, error } = await client
      .from("sos_broadcasts")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        outcome,
      })
      .eq("id", id)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .select("*")
      .maybeSingle();

    if (error) throw new HttpError(500, `Could not resolve that SOS: ${error.message}`);

    if (!data) {
      const { data: existing } = await client
        .from("sos_broadcasts")
        .select("status, outcome")
        .eq("id", id)
        .maybeSingle();

      if (!existing) {
        throw new HttpError(404, "No SOS with that id is visible to you.");
      }
      throw new HttpError(
        409,
        `That SOS is already ${(existing as Row).status} and its outcome has been ` +
          "recorded. It cannot be resolved twice.",
      );
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "sos.resolve",
      entity: "sos_broadcasts",
      entityId: id,
      subjectId: (data as Row).user_id ?? null,
      detail: { outcome, resolved_by_owner: (data as Row).user_id === caller.id },
      ip: req.ip ?? null,
    });

    res.json({ ok: true, sos: shapeSos(data as Row) });
  }),
);

// =====================================================================
// GET /asha/sos — the worker's queue
// =====================================================================

const QUEUE_FILTERS = ["active", "all", ...SOS_STATUSES] as const;

sosRouter.get(
  "/asha/sos",
  runGuards(requireAsha),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const status = String(req.query.status ?? "active");
    if (!QUEUE_FILTERS.includes(status as (typeof QUEUE_FILTERS)[number])) {
      throw new HttpError(400, `status must be one of ${QUEUE_FILTERS.join(", ")}.`);
    }

    const limit = intInRange(req.query.limit, 25, 1, 100);
    const offset = intInRange(req.query.offset, 0, 0, 100000);
    const client = asUser(caller.token);

    // asha_villages is the assignment the RLS policies read, so it is
    // also the honest answer to "whose emergencies are mine". The display
    // text in asha_profiles.villages can drift; this cannot.
    const { data: links, error: linkError } = await client
      .from("asha_villages")
      .select("village_id")
      .eq("asha_user_id", caller.id);

    if (linkError) {
      throw new HttpError(500, `Could not read your villages: ${linkError.message}`);
    }

    const villageIds = ((links ?? []) as Row[]).map((row) => row.village_id);

    if (villageIds.length === 0) {
      // An empty queue with a reason attached. An admin reaches this
      // endpoint through the role bypass without being mapped to any
      // village, and so does a worker whose assignment was never
      // recorded; either way an unexplained empty list would read as
      // "no emergencies today".
      res.json({
        sos: [],
        count: 0,
        status,
        limit,
        offset,
        hasMore: false,
        note:
          "No village is assigned to this account, so this queue is empty by " +
          "construction rather than because nothing has been raised. Ask an admin to " +
          "map your villages.",
      });
      return;
    }

    let query = client
      .from("sos_broadcasts")
      .select("*, sos_deliveries ( * )", { count: "exact" })
      .in("village_id", villageIds);

    if (status === "active") {
      query = query.in("status", ACTIVE_STATUSES as unknown as string[]);
    } else if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query
      // Newest first. This is a queue somebody works down under pressure,
      // and the most recent emergency is the one that matters.
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, `Could not read the SOS queue: ${error.message}`);

    const rows = (data ?? []) as Row[];

    res.json({
      sos: rows.map((row) => ({
        ...shapeSos(row),
        nearestHospitals: row.nearest_hospitals ?? [],
        deliveries: ((row.sos_deliveries ?? []) as Row[]).map(shapeDelivery),
      })),
      count: count ?? rows.length,
      status,
      limit,
      offset,
      hasMore: (count ?? 0) > offset + rows.length,
      villageCount: villageIds.length,
    });
  }),
);

// =====================================================================
// Emergency contacts
//
// Every route below runs as the caller. emergency_contacts_own is a
// single for-all policy pinned to user_id = auth.uid(), so the database
// is what confines each of these to the caller's own list; the explicit
// user_id filters are belt and braces so a policy change cannot silently
// widen them.
// =====================================================================

const CONTACT_NUMBER_REFUSED =
  "That does not look like a mobile number this app can send to. Give a 10-digit " +
  "Indian mobile number, or the full number including its country code. Refusing it " +
  "now is better than discovering during an emergency that the message had nowhere " +
  "to go.";

sosRouter.get(
  "/emergency-contacts",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);

    const { data, error } = await asUser(caller.token)
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", caller.id)
      // Priority is the order they will be contacted in, so it is the
      // order they are listed in.
      .order("priority", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw new HttpError(500, `Could not read your emergency contacts: ${error.message}`);
    }

    const contacts = ((data ?? []) as Row[]).map(shapeContact);
    const availability = smsAvailability();

    res.json({
      contacts,
      count: contacts.length,
      smsAvailable: availability.ready,
      note: availability.ready
        ? "Contacts with SMS turned on are texted in priority order when you raise an SOS."
        : `${availability.reason}. These contacts are recorded and will appear on an SOS ` +
          "marked skipped, but no text message can be sent until that is fixed.",
    });
  }),
);

sosRouter.post(
  "/emergency-contacts",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const body = req.body ?? {};

    const name = requiredField(body.name, "name", "Say who this contact is.");
    const rawPhone = requiredField(body.phone, "phone", "Give their mobile number.");

    // Validated with the same normaliser the SMS adapter uses, so a
    // number that could never be messaged is rejected here at a moment
    // when somebody can fix it, rather than at three in the morning when
    // nobody can. The E.164 form is what gets stored, which also makes
    // the unique(user_id, phone) constraint mean something: 98261-55443
    // and +919826155443 are then correctly the same contact.
    const phone = normaliseMobile(rawPhone);
    if (!phone) throw new HttpError(400, CONTACT_NUMBER_REFUSED);

    const priority = intInRange(body.priority, 1, 1, 10);
    const notifySms = body.notifySms === undefined ? true : Boolean(body.notifySms);
    const notifyVoice = Boolean(body.notifyVoice);

    const { data, error } = await asUser(caller.token)
      .from("emergency_contacts")
      .insert({
        user_id: caller.id,
        name,
        phone,
        relationship: str(body.relationship),
        priority,
        notify_sms: notifySms,
        notify_voice: notifyVoice,
      })
      .select("*")
      .single();

    if (error) {
      // unique (user_id, phone). The same number twice is almost always a
      // double submit rather than two people.
      if (error.code === "23505") {
        throw new HttpError(
          409,
          "That number is already on your emergency contact list.",
        );
      }
      if (error.code === "23514") {
        throw new HttpError(400, CONTACT_NUMBER_REFUSED);
      }
      if (error.code === "42501") {
        throw new HttpError(403, "You can only add contacts to your own list.");
      }
      throw new HttpError(500, `Could not save that contact: ${error.message}`);
    }

    res.status(201).json({
      contact: shapeContact(data as Row),
      note: notifyVoice
        ? "Saved. Voice calling is not implemented in this app, so notifyVoice records " +
          "your preference and nothing more; only SMS and the in-app alert are actually " +
          "sent."
        : "Saved.",
    });
  }),
);

sosRouter.patch(
  "/emergency-contacts/:id",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "Contact id");
    const body = req.body ?? {};

    // Only the keys that were actually sent are touched, so a partial
    // form cannot blank a field it never displayed.
    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      patch.name = requiredField(body.name, "name", "A contact needs a name.");
    }
    if (body.phone !== undefined) {
      const phone = normaliseMobile(requiredField(body.phone, "phone", "Give a number."));
      if (!phone) throw new HttpError(400, CONTACT_NUMBER_REFUSED);
      patch.phone = phone;
    }
    // relationship is nullable, so an explicit blank clears it.
    if (body.relationship !== undefined) patch.relationship = str(body.relationship);
    if (body.priority !== undefined) patch.priority = intInRange(body.priority, 1, 1, 10);
    if (body.notifySms !== undefined) patch.notify_sms = Boolean(body.notifySms);
    if (body.notifyVoice !== undefined) patch.notify_voice = Boolean(body.notifyVoice);

    if (Object.keys(patch).length === 0) {
      throw new HttpError(
        400,
        "Nothing to change. Send at least one of name, phone, relationship, priority, " +
          "notifySms or notifyVoice.",
      );
    }

    const { data, error } = await asUser(caller.token)
      .from("emergency_contacts")
      .update(patch)
      .eq("id", id)
      .eq("user_id", caller.id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        throw new HttpError(
          409,
          "That number is already on your emergency contact list.",
        );
      }
      if (error.code === "23514") {
        throw new HttpError(400, CONTACT_NUMBER_REFUSED);
      }
      throw new HttpError(500, `Could not update that contact: ${error.message}`);
    }
    if (!data) throw new HttpError(404, "That contact is not on your list.");

    res.json({ contact: shapeContact(data as Row) });
  }),
);

sosRouter.delete(
  "/emergency-contacts/:id",
  runGuards(requireAuth),
  handler(async (req: Request, res: Response) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "Contact id");

    const { data, error } = await asUser(caller.token)
      .from("emergency_contacts")
      .delete()
      .eq("id", id)
      .eq("user_id", caller.id)
      .select("id, name")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not remove that contact: ${error.message}`);
    }
    // A 404 rather than a cheerful no-op, so the screen does not show a
    // contact as removed when the delete matched nothing.
    if (!data) throw new HttpError(404, "That contact is not on your list.");

    res.json({
      ok: true,
      removed: { id: (data as Row).id, name: (data as Row).name ?? null },
      note:
        "Removed from your list. Any delivery records naming this number stay on past " +
        "SOS broadcasts, because they are the record of who was told at the time.",
    });
  }),
);
