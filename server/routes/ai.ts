import { Router } from "express";
import type { Request } from "express";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { env } from "../lib/env";
import { HttpError, handler, requireAuth, type Caller } from "../lib/auth";
import { asUser, audit } from "../lib/supabaseAdmin";

/* =====================================================================
   The two model-facing features: Live voice, and reading a prescription.

   Why two API keys. env.geminiApiKey drives the text assistant and the
   Live voice session; env.geminiPrescriptionKey drives prescription
   reading and nothing else, falling back to the primary key when it is
   absent. The user asked for the load split this way so that a burst of
   voice sessions during a demo cannot exhaust the quota that prescription
   reading depends on, and the reverse. The split is only real if it is
   honoured at every call site, so each route below names the key it uses
   rather than reaching for a shared default.

   Why an ephemeral token exists at all. A Live session is a WebSocket the
   browser opens directly to Google, which means whatever credential it
   carries is visible in that browser. Handing over env.geminiApiKey would
   publish a long-lived key with the project's whole quota attached to it.
   authTokens.create mints a single-use credential that expires in half an
   hour instead, so the worst case of a leaked token is one wasted voice
   session. This is also why the failure path here returns 503 rather than
   the key: see the comment on the mint itself.

   Why this file is the strictest in the codebase about honesty. A model
   reading somebody's handwritten prescription is guessing at letters, and
   the cost of a wrong guess is a person taking the wrong medicine. So
   nothing here ever claims to be verified, nothing here states a
   diagnosis, nothing here suggests starting, stopping or changing a
   medicine, and nothing here invents a name, a dose, a doctor, a hospital
   or an eligibility decision. When the image cannot be read the answer is
   that it cannot be read, which is useful, rather than a plausible
   transcription, which is dangerous. Every response carries a disclaimer
   naming the specific risk and pointing back at the prescribing doctor or
   a pharmacist.

   Nothing in this file logs a key, a token, or image bytes.
   ===================================================================== */

export const aiRouter = Router();

// ---------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------

/**
 * The Live model. Named as a constant because /ai/status reports it to
 * the UI, and the microphone button is only drawn when the two agree.
 */
const LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";

/**
 * Vision cascade for prescription reading, tried in order. 2.5-flash
 * reads handwriting appreciably better, so 2.0-flash is a fallback for
 * when the first is rate limited rather than an equal choice.
 */
const PRESCRIPTION_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

/** Per image, on the decoded bytes rather than the base64 string. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_MB = 8;
const MAX_PAGES = 5;

/**
 * Repeated verbatim in the analyze response and stored nowhere else, so
 * that a client which caches a scan still has the sentence to render
 * next to it. It names the specific failure mode rather than hedging in
 * general, because "may contain errors" does not tell anybody what to do.
 */
const PRESCRIPTION_DISCLAIMER =
  "This reading was produced by a computer from a photograph, and handwriting " +
  "on a prescription is very easily misread — a strength, a dose or a medicine " +
  "name can come out wrong. It is an aid for reading your own prescription, not " +
  "a medical opinion and not a substitute for the doctor who wrote it or for a " +
  "pharmacist. Do not start, stop or change any medicine on the basis of this " +
  "reading. Check anything that matters against the paper itself and ask your " +
  "doctor or pharmacist if the two do not agree.";

// ---------------------------------------------------------------------
// Small shared helpers
//
// Reimplemented here rather than imported: server.ts defines its own
// getGeminiClient and callGeminiSafe but exports neither, and this file
// needs a per-key client anyway because server.ts hard-codes the primary
// key from process.env.
// ---------------------------------------------------------------------

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

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(value: unknown, label: string): string {
  const out = str(value);
  if (!out || !UUID_RE.test(out)) {
    throw new HttpError(400, `${label} is not a valid id.`);
  }
  return out;
}

/**
 * The same client shape server.ts uses. The aistudio-build User-Agent is
 * carried over deliberately: it is what the key was issued against, and
 * changing it has produced quota refusals before.
 */
function geminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

/**
 * Mirrors the transient-error detection in callGeminiSafe in server.ts. A
 * 503 or a 429 is worth one immediate retry because it usually means the
 * model is momentarily busy rather than that the request was wrong;
 * anything else means retrying would fail the same way.
 */
function isTransient(err: unknown): boolean {
  const message = ((err as any)?.message ?? String(err)).toLowerCase();
  return (
    message.includes("503") ||
    message.includes("429") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("timeout") ||
    message.includes("fetch failed")
  );
}

// ---------------------------------------------------------------------
// ROUTE 1 — POST /voice/live-token
// ---------------------------------------------------------------------

/**
 * Built per request because it embeds the caller's language. The rules in
 * here are the voice equivalent of the disclaimer on a scan: the model
 * cannot be trusted to be cautious on its own, so caution is stated as
 * instruction, and the instruction is locked into the token below so the
 * browser cannot drop it on the way to opening the session.
 */
function voiceSystemInstruction(language: string): string {
  return [
    `You are Sehat Sathi, a health-scheme guide for people in rural India. You are speaking out loud, so keep answers short and plain, the way a helpful neighbour would explain something. Speak in ${language}. If the person switches language, follow them.`,
    "",
    "What you help with: explaining Indian government health schemes such as Ayushman Bharat PM-JAY, Janani Suraksha Yojana, Pradhan Mantri Matru Vandana Yojana, Jan Aushadhi and similar programmes; what a scheme covers; which documents somebody needs; how and where to apply; and helping somebody find a hospital empanelled under PM-JAY near them.",
    "",
    "You are not a doctor and you must never behave like one. Never name or suggest a diagnosis, never interpret symptoms as a condition, never recommend a medicine, a dose or a treatment, and never tell anybody to start, stop or change something a doctor prescribed. When somebody describes symptoms, say plainly that this needs a doctor, say which kind of facility to go to, and if what they describe sounds like an emergency tell them to go to the nearest hospital or call 108 immediately.",
    "",
    "On eligibility, you are never the one who decides. Always phrase it as 'you may be eligible based on the information available' and explain which office, hospital help desk or Ayushman Arogya Mandir actually confirms it. Never say somebody is eligible or is not eligible.",
    "",
    "Never invent anything. Do not make up a scheme, a hospital, a doctor, a phone number, an amount, a date or a document requirement. If you do not know, say you do not know and say where the person can find out. If you are not certain of a helpline number or a coverage amount, say so rather than producing a number that sounds right.",
  ].join("\n");
}

/**
 * Mints a short-lived, single-use credential so the browser can open a
 * Gemini Live WebSocket without ever holding the project's API key.
 */
aiRouter.post(
  "/voice/live-token",
  requireAuth,
  handler(async (req, res) => {
    const caller = callerOf(req);

    // Voice is the assistant, so it draws on the assistant key. The
    // prescription key is not touched here even as a fallback, because
    // borrowing it would defeat the point of splitting the quota.
    const apiKey = env.geminiApiKey;
    if (!apiKey) {
      throw new HttpError(
        503,
        "Voice is temporarily unavailable because the assistant is not " +
          "configured on this server. The text assistant still works.",
      );
    }

    const systemInstruction = voiceSystemInstruction(caller.language);

    // Half an hour of session life and two minutes to get the session
    // open. The second window is short on purpose: the token is handed
    // straight to a page that is about to connect, so a long one would
    // only widen the period in which a copied token is usable.
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const sessionConfig = {
      responseModalities: ["AUDIO"] as any,
      systemInstruction,
      realtimeInputConfig: {
        automaticActivityDetection: {}
      }
    };

    let tokenName: string | null = null;
    try {
      // Verified against the installed @google/genai type declarations
      // rather than assumed: the property on the client is `authTokens`
      // (there is no `.tokens`, despite the SDK's own docstring examples
      // saying `ai.tokens.create(config)`), create takes a
      // CreateAuthTokenParameters wrapper so the config is nested under
      // `config`, the ephemeral-token endpoint lives in v1alpha only, and
      // the token string comes back on `name` rather than on a `token`
      // field.
      const created = await geminiClient(apiKey).authTokens.create({
        config: {
          uses: 1,
          expireTime: expiresAt,
          newSessionExpireTime,
          // Pinning the model and the system instruction into the token
          // itself. With lockAdditionalFields set to an empty array the
          // API ignores any attempt by the client to send a different
          // instruction, which is what keeps the never-diagnose rules
          // above from being something the browser can simply omit.
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: sessionConfig,
          },
          lockAdditionalFields: [],
          httpOptions: { apiVersion: "v1alpha" },
        },
      });
      tokenName = str(created?.name);
    } catch (err: any) {
      // Only the message, never the key and never the token.
      console.warn("[ai] live token mint failed: %s", err?.message ?? err);
    }

    if (!tokenName) {
      // The fallback for a failed token mint is degraded functionality,
      // never a leaked key. Ephemeral tokens are a v1alpha feature and
      // are not enabled on every key, so this path is reachable in normal
      // operation; returning env.geminiApiKey instead would put a
      // long-lived credential into a web page to avoid an inconvenience.
      throw new HttpError(
        503,
        "Voice is temporarily unavailable. The text assistant still works, " +
          "and you can type your question instead.",
      );
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "ai.live_token_minted",
      entity: "ai_voice",
      // The model and the expiry are worth having in the trail. The token
      // is not recorded anywhere.
      detail: { model: LIVE_MODEL, expires_at: expiresAt, language: caller.language },
      ip: req.ip ?? null,
    });

    res.json({
      token: tokenName,
      expiresAt,
      model: LIVE_MODEL,
      config: {
        model: LIVE_MODEL,
        responseModalities: ["AUDIO"],
        systemInstruction,
        language: caller.language,
      },
    });
  }),
);

// ---------------------------------------------------------------------
// ROUTE 2 — POST /prescription/analyze
// ---------------------------------------------------------------------

interface InlineImage {
  base64: string;
  mimeType: string;
}

/**
 * A data URL is what a browser's FileReader produces, so accepting one
 * saves every caller from writing the same strip. The declared mimeType
 * still wins, because it is the one that was validated.
 */
function stripDataUrl(value: string): string {
  const match = /^data:[^;,]*;base64,(.*)$/is.exec(value.trim());
  return (match ? match[1] : value).replace(/\s+/g, "");
}

/**
 * Decoded length from the base64 length, without allocating the buffer.
 * The bytes are forwarded to Gemini as base64 anyway, so decoding them
 * here purely to measure them would double the memory a large scan costs.
 */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function readImages(body: any): InlineImage[] {
  const raw: Array<{ base64: unknown; mimeType: unknown }> = [];

  if (Array.isArray(body?.images) && body.images.length > 0) {
    for (const entry of body.images) {
      raw.push({ base64: entry?.base64 ?? entry?.imageBase64, mimeType: entry?.mimeType });
    }
  } else if (body?.imageBase64) {
    raw.push({ base64: body.imageBase64, mimeType: body.mimeType });
  }

  if (raw.length === 0) {
    throw new HttpError(
      400,
      "Attach a photo of the prescription as imageBase64 with its mimeType, " +
        "or several pages as images: [{ base64, mimeType }].",
    );
  }
  if (raw.length > MAX_PAGES) {
    throw new HttpError(
      400,
      `Please send at most ${MAX_PAGES} pages in one scan.`,
    );
  }

  return raw.map((entry, index) => {
    const label = raw.length === 1 ? "The image" : `Page ${index + 1}`;

    const mimeType = str(entry.mimeType)?.toLowerCase() ?? null;
    if (!mimeType) {
      throw new HttpError(
        400,
        `${label} is missing its mimeType. Send one of ${ACCEPTED_MIME_TYPES.join(", ")}.`,
      );
    }
    if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
      throw new HttpError(
        400,
        `${label} is a ${mimeType}, which cannot be read. Send one of ` +
          `${ACCEPTED_MIME_TYPES.join(", ")}.`,
      );
    }

    const provided = str(entry.base64);
    if (!provided) throw new HttpError(400, `${label} has no image data.`);

    const base64 = stripDataUrl(provided);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new HttpError(
        400,
        `${label} is not valid base64. Send the file contents base64-encoded.`,
      );
    }

    const bytes = decodedBytes(base64);
    if (bytes <= 0) throw new HttpError(400, `${label} is empty.`);
    if (bytes > MAX_IMAGE_BYTES) {
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      throw new HttpError(
        400,
        `${label} is ${mb} MB, and the limit is ${MAX_IMAGE_MB} MB per page. ` +
          "Please retake the photo at a smaller size and send it again.",
      );
    }

    return { base64, mimeType };
  });
}

/**
 * The shape the model must return. Written out as a schema rather than
 * asked for in prose because a schema is what makes the nullable fields
 * genuinely nullable: the model can answer null for a line it cannot
 * read instead of being pushed by the format into producing a string.
 */
const PRESCRIPTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    readable: {
      type: Type.BOOLEAN,
      description:
        "False when the image is too blurred, dark, cropped or otherwise " +
        "illegible to read anything from with confidence. Prefer false over " +
        "a guess.",
    },
    documentType: {
      type: Type.STRING,
      enum: ["prescription", "lab_report", "discharge_summary", "other", "unclear"],
    },
    prescriberName: {
      type: Type.STRING,
      nullable: true,
      description: "Exactly as printed or written. Null if not legible or absent.",
    },
    facilityName: {
      type: Type.STRING,
      nullable: true,
      description: "Clinic or hospital name as printed. Null if not legible or absent.",
    },
    dateOnDocument: {
      type: Type.STRING,
      nullable: true,
      description: "The date written on the document, as written. Null if not legible or absent.",
    },
    medicines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "As written on the page. Never corrected to a similar-looking medicine." },
          strength: { type: Type.STRING, nullable: true },
          dosage: { type: Type.STRING, nullable: true },
          frequency: { type: Type.STRING, nullable: true },
          duration: { type: Type.STRING, nullable: true },
          purpose: {
            type: Type.STRING,
            nullable: true,
            description:
              "Only the purpose written on the page. Null when the page does " +
              "not say. Never inferred from the medicine name.",
          },
          confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
        },
        required: ["name", "confidence"],
      },
    },
    tests: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          note: { type: Type.STRING, nullable: true },
        },
        required: ["name"],
      },
    },
    advice: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Advice written on the document, quoted or closely paraphrased. Never your own advice.",
    },
    followUp: { type: Type.STRING, nullable: true },
    unreadableParts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Every part you could not read, and every reading you are unsure of.",
    },
    summary: { type: Type.STRING },
    summaryHi: { type: Type.STRING, description: "The same summary in Hindi." },
    questionsForDoctor: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Questions the person could ask their doctor or pharmacist.",
    },
  },
  required: [
    "readable",
    "documentType",
    "prescriberName",
    "facilityName",
    "dateOnDocument",
    "medicines",
    "tests",
    "advice",
    "followUp",
    "unreadableParts",
    "summary",
    "summaryHi",
    "questionsForDoctor",
  ],
} as const;

function prescriptionSystemInstruction(language: string): string {
  return [
    "You transcribe what is written on a medical document so that the person holding it can read their own prescription. You are a transcriber and an explainer. You are not a doctor and this is not a consultation.",
    "",
    `Write summary in simple ${language} that somebody with little formal schooling can follow, and write summaryHi as the same summary in simple Hindi. Where you name a medicine, give the name exactly as it appears on the page.`,
    "",
    "Null is a correct and useful answer. For prescriberName, facilityName, dateOnDocument, followUp and for strength, dosage, frequency, duration and purpose on any medicine, return null whenever the page does not legibly say. Do not fill a field from the surrounding context, from what is usual for that medicine, or from what a prescription normally contains. An honest null is worth more here than a plausible value, because somebody may act on the value.",
    "",
    "Mark your uncertainty. A medicine name you are not confident of must carry confidence 'low', and the same uncertainty must be repeated as an entry in unreadableParts naming what you were unsure of and what it might say. Use 'medium' when the reading is probable but the handwriting is unclear. Reserve 'high' for text that is printed or unambiguously written.",
    "",
    "If the image is too blurred, too dark, cropped or otherwise illegible to read with confidence, set readable to false, describe what is wrong in unreadableParts, say so in summary, and leave medicines empty. Do not guess at letters. A wrong medicine name is worse than no medicine name.",
    "",
    "Never state or imply a diagnosis, and never name a condition the document does not name. Never suggest starting, stopping, changing or substituting a medicine, and never give a dose you did not read off the page. Do not comment on whether the prescription is appropriate. Do not invent a medicine, a doctor, a facility, a date or a test.",
    "",
    "In questionsForDoctor, ask about what is unclear on this document — an unreadable line, a missing duration, how to take something, what to do about a side effect. Do not phrase a question as advice.",
  ].join("\n");
}

/**
 * Runs the cascade. Returns the parsed object and the model that produced
 * it, or null when every model and attempt was exhausted, so the caller
 * can record 'failed' rather than silently returning an empty reading.
 */
async function analyseWithCascade(
  apiKey: string,
  images: InlineImage[],
  note: string | null,
  language: string,
): Promise<{ result: any; model: string } | null> {
  const client = geminiClient(apiKey);

  const parts: Array<Record<string, unknown>> = images.map((image) => ({
    inlineData: { data: image.base64, mimeType: image.mimeType },
  }));

  parts.push({
    text: [
      images.length > 1
        ? `These ${images.length} images are pages of one medical document.`
        : "This image is a photograph of a medical document.",
      "Transcribe what is legibly written on it and follow every rule in your instructions, especially returning null for anything you cannot read.",
      note ? `The person adds this context, which you must not treat as part of the document: ${note}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  });

  let lastError: string | null = null;

  for (const model of PRESCRIPTION_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: parts as any }],
          config: {
            systemInstruction: prescriptionSystemInstruction(language),
            responseMimeType: "application/json",
            responseSchema: PRESCRIPTION_SCHEMA as any,
            // Low but not zero. Transcription wants the most likely
            // reading of a character, not a creative one.
            temperature: 0.1,
          },
        });

        const text = response?.text;
        if (!text) {
          lastError = `${model} returned no text`;
          continue;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Some models still wrap JSON in a fenced block even when a
          // response schema was supplied.
          parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
        }

        if (!parsed || typeof parsed !== "object") {
          lastError = `${model} returned something that was not an object`;
          continue;
        }
        return { result: parsed, model };
      } catch (err: any) {
        // The message only. The prompt carries image bytes and must never
        // reach the log.
        lastError = err?.message ?? String(err);
        console.warn("[ai] prescription read failed on %s: %s", model, lastError);
        if (isTransient(err) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        break;
      }
    }
  }

  if (lastError) console.warn("[ai] prescription cascade exhausted: %s", lastError);
  return null;
}

/**
 * Normalises the model's answer so the stored object has every key with a
 * predictable type. Anything missing becomes null or an empty array
 * rather than being dropped, because a UI that has to test for the
 * presence of a key ends up rendering "undefined".
 */
function normaliseResult(raw: any) {
  const strOrNull = (value: unknown): string | null => str(value);
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const confidenceOf = (value: unknown): "high" | "medium" | "low" =>
    value === "high" || value === "medium" ? value : "low";

  const documentTypes = ["prescription", "lab_report", "discharge_summary", "other", "unclear"];

  const medicines = list(raw?.medicines)
    .map((entry: any) => ({
      name: strOrNull(entry?.name),
      strength: strOrNull(entry?.strength),
      dosage: strOrNull(entry?.dosage),
      frequency: strOrNull(entry?.frequency),
      duration: strOrNull(entry?.duration),
      purpose: strOrNull(entry?.purpose),
      // An unmarked confidence is treated as low, never as high. If the
      // model did not say how sure it was, this reading has not earned
      // the benefit of the doubt.
      confidence: confidenceOf(entry?.confidence),
    }))
    // A medicine with no name is not a medicine, and keeping the row
    // would put an empty line in front of somebody counting tablets.
    .filter((medicine) => medicine.name !== null);

  const unreadableParts = list(raw?.unreadableParts)
    .map(strOrNull)
    .filter((part): part is string => part !== null);

  // If the model marked a medicine low-confidence but did not repeat the
  // doubt in unreadableParts, it is added here. The uncertainty has to be
  // visible in the place the UI shows caveats, not only in a field next
  // to the name.
  for (const medicine of medicines) {
    if (medicine.confidence !== "low") continue;
    const alreadyMentioned = unreadableParts.some((part) =>
      part.toLowerCase().includes(medicine.name!.toLowerCase()),
    );
    if (!alreadyMentioned) {
      unreadableParts.push(
        `The medicine read as "${medicine.name}" is uncertain — check it against the paper.`,
      );
    }
  }

  return {
    // Strictly true, so a missing or malformed flag reads as not
    // readable. This one fails closed on purpose: treating an absent
    // answer as a successful read is how a blank scan gets presented as
    // a transcription.
    readable: raw?.readable === true,
    documentType: documentTypes.includes(raw?.documentType) ? raw.documentType : "unclear",
    prescriberName: strOrNull(raw?.prescriberName),
    facilityName: strOrNull(raw?.facilityName),
    dateOnDocument: strOrNull(raw?.dateOnDocument),
    medicines,
    tests: list(raw?.tests)
      .map((entry: any) => ({ name: strOrNull(entry?.name), note: strOrNull(entry?.note) }))
      .filter((test) => test.name !== null),
    advice: list(raw?.advice)
      .map(strOrNull)
      .filter((line): line is string => line !== null),
    followUp: strOrNull(raw?.followUp),
    unreadableParts,
    summary: strOrNull(raw?.summary) ?? "",
    summaryHi: strOrNull(raw?.summaryHi) ?? "",
    questionsForDoctor: list(raw?.questionsForDoctor)
      .map(strOrNull)
      .filter((question): question is string => question !== null),
  };
}

const SCAN_COLUMNS =
  "id, user_id, image_path, language, model, status, extracted, summary, verification, error, created_at, updated_at";

/**
 * The scan_status enum in supabase/05_platform.sql is ('pending',
 * 'processing', 'complete', 'failed') and has no 'unreadable' member, so
 * an illegible photo cannot be stored under the status that describes it
 * without a migration this task is not allowed to write. Rather than
 * silently recording it as 'complete', which would claim a reading that
 * does not exist, the update is attempted with 'unreadable' and falls
 * back to 'failed' with the reason in the error column when Postgres
 * rejects the value. The outcome stays legible either way because
 * extracted.readable is false and error says why in words. The memo means
 * the wasted round trip happens once per process, and the day the enum
 * gains the member this starts writing it with no further change here.
 */
let unreadableStatusSupported = true;

function isEnumRejection(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "22P02" ||
    /invalid input value for enum/i.test(error.message ?? "")
  );
}

aiRouter.post(
  "/prescription/analyze",
  requireAuth,
  handler(async (req, res) => {
    const caller = callerOf(req);

    // Prescription reading has its own key so that it keeps working when
    // the assistant has burned through its quota, and vice versa.
    const apiKey = env.geminiPrescriptionKey;
    if (!apiKey) {
      throw new HttpError(
        503,
        "Prescription reading is not configured on this server yet.",
      );
    }

    const images = readImages(req.body);
    const note = str(req.body?.note);
    const db = asUser(caller.token);

    // The row is created before the model is called so that a scan which
    // crashes, times out or is killed mid-flight leaves a trace the owner
    // can see rather than vanishing. A user who watched a spinner and
    // then found nothing in their history would reasonably conclude the
    // app lost their prescription.
    //
    // Inserted as the caller rather than through admin(): the scans_own
    // policy is what ties the row to auth.uid(), and using the service
    // role here would leave that policy untested.
    const { data: created, error: insertError } = await db
      .from("prescription_scans")
      .insert({
        user_id: caller.id,
        language: caller.language,
        status: "processing",
        // Stamped at creation and never changed. A model reading of
        // handwriting is inferred by definition, and the table's
        // prescription_scans_never_verified constraint enforces that no
        // code path can promote it to 'verified'.
        verification: "inferred",
        extracted: {},
        // image_path is deliberately left null. The base64 the caller
        // sent is passed to Gemini and then dropped: it is never written
        // to a column, never uploaded to storage and never logged. A
        // photograph of somebody's prescription is health data, and
        // holding on to it would create a breach liability and a
        // retention obligation that reading it aloud does not require.
        // The structured reading is enough to render the screen again.
        image_path: null,
      })
      .select(SCAN_COLUMNS)
      .single();

    if (insertError || !created) {
      throw new HttpError(
        500,
        `Could not start the scan: ${insertError?.message ?? "no row was created"}`,
      );
    }

    const scanId = created.id as string;
    const outcome = await analyseWithCascade(apiKey, images, note, caller.language);

    // Every model and attempt failed. Recorded as 'failed' with the
    // reason attached, because a row stuck on 'processing' forever tells
    // the owner nothing.
    if (!outcome) {
      const message =
        "The reading service could not be reached. Nothing was read from the " +
        "image. Please try again in a few minutes.";

      const { data: failed } = await db
        .from("prescription_scans")
        .update({ status: "failed", error: message })
        .eq("id", scanId)
        .select(SCAN_COLUMNS)
        .single();

      await audit({
        actorId: caller.id,
        actorRole: caller.role,
        action: "ai.prescription_failed",
        entity: "prescription_scans",
        entityId: scanId,
        subjectId: caller.id,
        detail: { pages: images.length, reason: "cascade_exhausted" },
        ip: req.ip ?? null,
      });

      throw new HttpError(503, message, { scan: failed ?? created });
    }

    const result = normaliseResult(outcome.result);

    const unreadableMessage = result.unreadableParts.length
      ? `The image could not be read reliably: ${result.unreadableParts.join("; ")}`
      : "The image could not be read reliably. Please retake the photo in good " +
        "light, with the whole page flat and in frame.";

    const patch: Record<string, unknown> = {
      model: outcome.model,
      extracted: result,
      summary: result.summary || null,
      verification: "inferred",
      status: result.readable ? "complete" : "unreadable",
      error: result.readable ? null : unreadableMessage,
    };

    if (!result.readable && !unreadableStatusSupported) patch.status = "failed";

    let updated = await db
      .from("prescription_scans")
      .update(patch)
      .eq("id", scanId)
      .select(SCAN_COLUMNS)
      .single();

    if (updated.error && patch.status === "unreadable" && isEnumRejection(updated.error)) {
      unreadableStatusSupported = false;
      updated = await db
        .from("prescription_scans")
        .update({ ...patch, status: "failed" })
        .eq("id", scanId)
        .select(SCAN_COLUMNS)
        .single();
    }

    if (updated.error) {
      throw new HttpError(
        500,
        `The prescription was read but the result could not be saved: ${updated.error.message}`,
      );
    }

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "ai.prescription_read",
      entity: "prescription_scans",
      entityId: scanId,
      subjectId: caller.id,
      // Counts and flags only. Nothing from the document itself is
      // written to the audit trail, which is far less protected than the
      // scan row and is readable by an admin.
      detail: {
        model: outcome.model,
        pages: images.length,
        readable: result.readable,
        document_type: result.documentType,
        medicine_count: result.medicines.length,
        low_confidence_count: result.medicines.filter((m) => m.confidence === "low").length,
      },
      ip: req.ip ?? null,
    });

    res.json({
      scan: updated.data,
      result,
      disclaimer: PRESCRIPTION_DISCLAIMER,
      // Hard-coded rather than read back from the row. This response can
      // never be labelled anything else.
      verification: "inferred" as const,
      model: outcome.model,
    });
  }),
);

// ---------------------------------------------------------------------
// ROUTE 3 — GET /prescription/scans
// ---------------------------------------------------------------------

/**
 * The caller's own scans and nobody else's. Read through asUser so the
 * scans_own policy does the filtering, which means an ASHA worker cannot
 * see these either. That is intentional and not an oversight: a
 * prescription is the most sensitive thing this app holds, and no part of
 * the product requires a health worker to read one. The eq('user_id')
 * below is belt and braces, so a future change to the client helper
 * cannot widen this quietly.
 */
aiRouter.get(
  "/prescription/scans",
  requireAuth,
  handler(async (req, res) => {
    const caller = callerOf(req);

    const size = boundedInt(req.query.size ?? req.query.limit, 20, 1, 50);
    const page = boundedInt(req.query.page, 1, 1, 10000);
    const from = (page - 1) * size;

    const { data, error, count } = await asUser(caller.token)
      .from("prescription_scans")
      .select(SCAN_COLUMNS, { count: "exact" })
      .eq("user_id", caller.id)
      .order("created_at", { ascending: false })
      .range(from, from + size - 1);

    if (error) {
      throw new HttpError(500, `Could not load your scans: ${error.message}`);
    }

    const total = count ?? 0;

    res.json({
      scans: data ?? [],
      count: total,
      page,
      size,
      pageCount: Math.max(Math.ceil(total / size), 1),
      disclaimer: PRESCRIPTION_DISCLAIMER,
      verification: "inferred" as const,
    });
  }),
);

// ---------------------------------------------------------------------
// ROUTE 4 — GET and DELETE /prescription/scans/:id
// ---------------------------------------------------------------------

aiRouter.get(
  "/prescription/scans/:id",
  requireAuth,
  handler(async (req, res) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "That scan");

    const { data, error } = await asUser(caller.token)
      .from("prescription_scans")
      .select(SCAN_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not load that scan: ${error.message}`);
    }
    // RLS makes somebody else's scan indistinguishable from one that does
    // not exist, which is the right answer to give in both cases.
    if (!data) throw new HttpError(404, "That scan could not be found.");

    res.json({
      scan: data,
      result: data.extracted ?? {},
      disclaimer: PRESCRIPTION_DISCLAIMER,
      verification: "inferred" as const,
      model: data.model ?? null,
    });
  }),
);

/**
 * A real delete, not a flag. Somebody asking to remove their own
 * prescription reading is entitled to have it gone, and a soft delete
 * would leave the transcription sitting in the table while telling them
 * it had been removed. There is no image to clean up because none was
 * ever stored.
 */
aiRouter.delete(
  "/prescription/scans/:id",
  requireAuth,
  handler(async (req, res) => {
    const caller = callerOf(req);
    const id = uuidParam(req.params.id, "That scan");

    const { data, error } = await asUser(caller.token)
      .from("prescription_scans")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Could not delete that scan: ${error.message}`);
    }
    if (!data) throw new HttpError(404, "That scan could not be found.");

    await audit({
      actorId: caller.id,
      actorRole: caller.role,
      action: "ai.prescription_deleted",
      entity: "prescription_scans",
      entityId: id,
      subjectId: caller.id,
      ip: req.ip ?? null,
    });

    res.json({ deleted: true, id });
  }),
);

// ---------------------------------------------------------------------
// ROUTE 5 — GET /ai/status
// ---------------------------------------------------------------------

/**
 * Whether each feature is wired, without disclosing anything about the
 * keys beyond their presence. The UI asks this so it can leave the
 * microphone off the screen entirely rather than offering a button that
 * fails when pressed, which is the difference between a feature this
 * build does not have and a feature that looks broken.
 */
aiRouter.get(
  "/ai/status",
  requireAuth,
  handler(async (_req, res) => {
    const voiceAvailable = Boolean(env.geminiApiKey);
    const prescriptionAvailable = Boolean(env.geminiPrescriptionKey);

    res.json({
      voice: {
        available: voiceAvailable,
        model: voiceAvailable ? LIVE_MODEL : null,
      },
      prescription: {
        available: prescriptionAvailable,
        model: prescriptionAvailable ? PRESCRIPTION_MODELS[0] : null,
        // Whether the two features are actually on different quotas, or
        // whether the prescription key fell back to the primary. Boolean
        // both times: neither key nor any part of one is returned.
        separateKey:
          prescriptionAvailable && env.geminiPrescriptionKey !== env.geminiApiKey,
      },
      note:
        "Voice availability here means a key is configured. The Live session " +
        "itself needs a short-lived token from /api/voice/live-token, which can " +
        "still be refused if ephemeral tokens are not enabled on that key; the " +
        "text assistant is the fallback in that case. Anything either feature " +
        "produces is a model reading labelled 'inferred', never a diagnosis and " +
        "never a confirmation of scheme eligibility.",
    });
  }),
);
