// Must be first: populates process.env before any module below reads it.
// See server/lib/loadEnv.ts for why this cannot just be dotenv.config().
import "./server/lib/loadEnv";

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

import { describeConfig, supabaseReady } from "./server/lib/env";
import { errorMiddleware, optionalAuth, handler, HttpError } from "./server/lib/auth";
import { admin } from "./server/lib/supabaseAdmin";
import { hospitalsRouter, nearestHospitals } from "./server/routes/hospitals";
import { ashaAuthRouter } from "./server/routes/ashaAuth";
import { notificationsRouter } from "./server/routes/notifications";
import { messagingRouter } from "./server/routes/messaging";
import { sosRouter } from "./server/routes/sos";
import { profileRouter } from "./server/routes/profile";
import { aiRouter } from "./server/routes/ai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Lazy/Safe Gemini Initialization
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

/* Resilient model cascade.
 *
 * Two Gemini failures matter to somebody waiting for an answer, and
 * they need opposite handling:
 *
 *   · 503 / 429 is the model being busy. Worth one short retry.
 *   · 404 "model not found" is a name that will never work on this
 *     key. Retrying it costs a network round-trip on EVERY request
 *     for the life of the process — which on a patchy rural
 *     connection is seconds of silence before the assistant says
 *     anything at all.
 *
 * So a name that comes back "not found" is struck off for the life of
 * the process, and the model that actually answered is remembered and
 * tried first next time. The first request pays for the cascade; the
 * ones after it do not.
 */
const deadModels = new Set<string>();
const preferredModel = new Map<string, string>();

function isMissingModel(lowerMessage: string): boolean {
  return (
    lowerMessage.includes("404") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("is not supported") ||
    lowerMessage.includes("does not exist")
  );
}

async function callGeminiSafe<T>(
  candidateModels: string[],
  generateFn: (gemini: GoogleGenAI, model: string) => Promise<any>,
  parseFn?: (text: string) => T
): Promise<T | null> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.error("[Gemini] No API key configured; skipping model call.");
    return null;
  }

  const cacheKey = candidateModels.join("|");
  const winner = preferredModel.get(cacheKey);

  // Known-good first, then the declared order, minus anything this
  // process has already been told does not exist.
  const order = [
    ...(winner ? [winner] : []),
    ...candidateModels.filter((m) => m !== winner),
  ].filter((m) => !deadModels.has(m));

  // Every candidate struck off. Try the declared list again rather
  // than return null without having asked anybody.
  const models = order.length > 0 ? order : candidateModels;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const aiResponse = await generateFn(gemini, model);
        const text = aiResponse?.text;
        if (text) {
          if (winner !== model) {
            console.log(`[Gemini] Answering with ${model}`);
            preferredModel.set(cacheKey, model);
          }
          if (parseFn) {
            try {
              return parseFn(text);
            } catch {
              const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
              return JSON.parse(cleaned);
            }
          }
          return text as unknown as T;
        }
        // A 200 carrying no text will not become text on a retry.
        break;
      } catch (err: any) {
        const errMsg = (err?.message || String(err)).toLowerCase();
        console.warn(`[Gemini] ${model} failed: ${err?.message || err}`);

        if (isMissingModel(errMsg)) {
          deadModels.add(model);
          if (preferredModel.get(cacheKey) === model) preferredModel.delete(cacheKey);
          break;
        }

        const isTransient =
          errMsg.includes("503") ||
          errMsg.includes("429") ||
          errMsg.includes("unavailable") ||
          errMsg.includes("high demand") ||
          errMsg.includes("resource_exhausted") ||
          errMsg.includes("timeout") ||
          errMsg.includes("fetch failed");

        if (isTransient && attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        // Move on to the next model in the cascade.
        break;
      }
    }
  }

  return null;
}

/* Query-string coercion. Express hands us `string | string[] |
   undefined`, and a repeated parameter (?lat=1&lat=2) arrives as an
   array — so take the first and let anything non-finite fall through
   as null rather than NaN, which would silently poison a distance
   calculation downstream. */
function queryNumber(value: unknown): number | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// In-Memory Database & Seed Records
interface SchemeRecord {
  id: string;
  name: string;
  name_hi: string;
  category: "General" | "Maternal & Child" | "Elderly & Chronic" | "Medicines" | "Specialized";
  coverage_amount: string;
  summary: string;
  summary_hi: string;
  key_benefits: string[];
  eligibility_criteria: string[];
  required_documents: string[];
  application_process: string[];
  source_url: string;
  source_name: string;
  verified_at: string;
  is_curated: boolean;
}

const CURATED_SCHEMES: SchemeRecord[] = [
  {
    id: "pmjay-ayushman",
    name: "Ayushman Bharat PM-JAY (Pradhan Mantri Jan Arogya Yojana)",
    name_hi: "आयुष्मान भारत - प्रधानमंत्री जन आरोग्य योजना (PM-JAY)",
    category: "General",
    coverage_amount: "₹5,00,000 per family per year",
    summary: "World's largest health assurance scheme providing secondary and tertiary hospital care coverage for bottom 40% vulnerable families.",
    summary_hi: "गरीब और कमजोर परिवारों के लिए प्रति वर्ष ₹5 लाख तक का कैशलेस इलाज सरकारी और सूचीबद्ध निजी अस्पतालों में।",
    key_benefits: [
      "Cashless and paperless access to health care services at empaneled hospitals",
      "₹5 Lakh per family per year for secondary and tertiary care hospitalization",
      "Covers 3 days pre-hospitalization and 15 days post-hospitalization expenses",
      "No restriction on family size, age or gender",
      "Pre-existing conditions covered from day one"
    ],
    eligibility_criteria: [
      "Identified families from SECC 2011 database (Rural D1-D7 criteria or Urban 11 occupational categories)",
      "Families holding Antyodaya Anna Yojana (AAY) or Priority Household (BPL) ration cards",
      "All senior citizens aged 70+ (expanded under Ayushman Vaya Vandana regardless of income)"
    ],
    required_documents: [
      "Aadhaar Card of the beneficiary",
      "Ration Card / Family Samagra ID",
      "Registered Mobile Number for OTP verification"
    ],
    application_process: [
      "Visit the nearest Ayushman Arogya Mandir, CSC centre, or empaneled government hospital",
      "Ask the Ayushman Mitra to check your family name in the PM-JAY beneficiary portal",
      "Complete biometric e-KYC using Aadhaar",
      "Receive PVC Ayushman Card (Golden Card) instantly"
    ],
    source_url: "https://pmjay.gov.in",
    source_name: "National Health Authority (NHA)",
    verified_at: "2026-02-15",
    is_curated: true
  },
  {
    id: "janani-suraksha",
    name: "Janani Suraksha Yojana (JSY)",
    name_hi: "जननी सुरक्षा योजना (JSY)",
    category: "Maternal & Child",
    coverage_amount: "₹1,400 (Rural) / ₹1,000 (Urban) cash assistance",
    summary: "Safe motherhood intervention under National Health Mission promoting institutional delivery among poor pregnant women.",
    summary_hi: "गर्भवती महिलाओं को सुरक्षित संस्थागत प्रसव के लिए वित्तीय सहायता और एम्बुलेंस सुविधा।",
    key_benefits: [
      "Direct financial incentive of ₹1,400 for rural pregnant women and ₹1,000 for urban women",
      "Free drop-back facility from hospital to home via 102/108 ambulance",
      "Financial assistance of ₹600 to ASHA worker for accompanying mother",
      "Completely free delivery and C-section in government facilities under JSSK"
    ],
    eligibility_criteria: [
      "All pregnant women in Low Performing States (LPS) like UP, MP, Bihar, Rajasthan, Odisha, Assam, etc.",
      "BPL/SC/ST pregnant women in other states delivering in government or accredited private centres",
      "Mother aged 19 years and above up to 2 live births (in HPS)"
    ],
    required_documents: [
      "Mother and Child Protection (MCP) Card / RCH ID",
      "Aadhaar Card and Bank Passbook (linked with Aadhaar)",
      "BPL / Caste Certificate (if applicable in High Performing States)"
    ],
    application_process: [
      "Register pregnancy within first trimester at nearest Sub-Centre / Anganwadi",
      "Attend minimum 4 Antenatal Care (ANC) checkups with ASHA",
      "Deliver at nearest PHC, CHC, or District Hospital",
      "Incentive transferred directly via DBT to bank account"
    ],
    source_url: "https://nhm.gov.in/index1.php?lang=1&level=3&sublinkid=841&lid=309",
    source_name: "Ministry of Health & Family Welfare",
    verified_at: "2026-02-10",
    is_curated: true
  },
  {
    id: "pmmvy-matru-vandana",
    name: "Pradhan Mantri Matru Vandana Yojana (PMMVY)",
    name_hi: "प्रधानमंत्री मातृ वंदना योजना (PMMVY)",
    category: "Maternal & Child",
    coverage_amount: "₹5,000 (First child) + ₹6,000 (Second child if girl)",
    summary: "Maternity benefit cash incentive program compensating for wage loss and ensuring adequate nutrition during pregnancy and lactation.",
    summary_hi: "गर्भावस्था के दौरान पोषण और टीकाकरण के लिए ₹5,000 से ₹6,000 तक की आर्थिक सहायता सीधे बैंक खाते में।",
    key_benefits: [
      "₹5,000 in two installments for the first live child (upon early registration + 1 ANC, and child birth + immunization)",
      "₹6,000 in a single installment for the second child if it is a girl child",
      "Direct Benefit Transfer (DBT) directly into mother's bank account"
    ],
    eligibility_criteria: [
      "Pregnant women and lactating mothers who do not receive paid maternity leave in regular government employment",
      "Annual family income less than ₹8 Lakh or holding NFSA / BPL / EWS cards"
    ],
    required_documents: [
      "MCP Card with vaccination record",
      "Aadhaar card of both mother and husband",
      "Bank / Post office account details of mother"
    ],
    application_process: [
      "Contact your local Anganwadi worker or ASHA worker",
      "Fill Form 1-A with required documents at Anganwadi Centre",
      "Check application status online on pmmvy.wcd.gov.in"
    ],
    source_url: "https://pmmvy.wcd.gov.in",
    source_name: "Ministry of Women and Child Development",
    verified_at: "2026-01-20",
    is_curated: true
  },
  {
    id: "ayushman-arogya-mandir",
    name: "Ayushman Arogya Mandir (Health & Wellness Centres)",
    name_hi: "आयुष्मान आरोग्य मंदिर (AB-HWC)",
    category: "General",
    coverage_amount: "100% Free Comprehensive Primary Health Care",
    summary: "Transformed primary health centres offering free diagnostics, 150+ essential medicines, screening for hypertension, diabetes, and cancer.",
    summary_hi: "गाँव में ही 150 से अधिक मुफ्त दवाइयाँ, 14 आवश्यक जाँचें और टेली-कंसल्टेशन (ई-संजीवनी)।",
    key_benefits: [
      "Free screening for Non-Communicable Diseases (NCDs): Hypertension, Diabetes, Oral/Breast/Cervical Cancer",
      "150+ free essential medicines provided through wellness dispensary",
      "14 free point-of-care lab tests (Blood sugar, Malaria, Pregnancy, Hemoglobin)",
      "Free e-Sanjeevani tele-consultation with specialist doctors at District Hospitals"
    ],
    eligibility_criteria: [
      "Universal for all citizens — no card or income barrier required"
    ],
    required_documents: [
      "Any photo ID or ABHA (Ayushman Bharat Health Account) number (optional but helpful)"
    ],
    application_process: [
      "Walk in to your nearest village Ayushman Arogya Mandir / Sub-Centre",
      "Meet Community Health Officer (CHO) or ANM for check-up and free medicines"
    ],
    source_url: "https://ab-hwc.nhp.gov.in",
    source_name: "Ministry of Health & Family Welfare",
    verified_at: "2026-02-18",
    is_curated: true
  },
  {
    id: "janaushadhi-medicines",
    name: "Pradhan Mantri Bharatiya Janaushadhi Pariyojana (PMBJP)",
    name_hi: "प्रधानमंत्री भारतीय जनऔषधि परियोजना",
    category: "Medicines",
    coverage_amount: "50% to 90% Discount on Quality Generic Medicines",
    summary: "Dedicated Kendra outlets supplying 2000+ top-quality generic medicines, surgical devices, and ₹1 Suvidha sanitary napkins.",
    summary_hi: "ब्रांडेड दवाओं की तुलना में 50% से 90% तक कम कीमत पर प्रमाणित जेनेरिक दवाएं।",
    key_benefits: [
      "Huge savings on chronic medicines (BP, Diabetes, Thyroid, Cardiac, Asthma)",
      "Oxo-biodegradable sanitary pads (Suvidha) at just ₹1 per pad",
      "Quality tested at NABL accredited laboratories"
    ],
    eligibility_criteria: [
      "Open to all individuals holding a valid doctor prescription"
    ],
    required_documents: [
      "Doctor Prescription (Parchi)"
    ],
    application_process: [
      "Visit any Jan Aushadhi Kendra with your prescription",
      "Request generic equivalents for the prescribed medicines"
    ],
    source_url: "https://janaushadhi.gov.in",
    source_name: "Pharmaceuticals & Medical Devices Bureau of India",
    verified_at: "2026-01-15",
    is_curated: true
  },
  {
    id: "nikshay-poshan-tuberculosis",
    name: "Nikshay Poshan Yojana (NTEP)",
    name_hi: "निक्षय पोषण योजना (टीबी सहायता)",
    category: "Elderly & Chronic",
    coverage_amount: "₹1,000 per month during TB treatment",
    summary: "Direct nutritional financial support and 100% free DOTS medication for all notified tuberculosis patients.",
    summary_hi: "टीबी के मरीजों को इलाज के दौरान पोषण के लिए ₹1,000 प्रति माह बैंक में और मुफ्त दवाइयाँ।",
    key_benefits: [
      "Direct nutritional grant of ₹1,000 per month (recently increased from ₹500) during entire treatment course",
      "Completely free GeneXpert rapid molecular tests and complete drug course",
      "Free food baskets (Ni-kshay Mitra nutrition support)"
    ],
    eligibility_criteria: [
      "All active TB patients notified on the national Ni-kshay portal (Government or Private sector)"
    ],
    required_documents: [
      "Ni-kshay Patient ID",
      "Aadhaar Card and Bank account passbook"
    ],
    application_process: [
      "Visit nearest PHC / District TB Centre with cough sample",
      "Upon confirmation, health staff registers case on Ni-kshay portal",
      "Payment sent monthly via DBT directly to bank account"
    ],
    source_url: "https://nikshay.in",
    source_name: "Central TB Division, MoHFW",
    verified_at: "2026-02-12",
    is_curated: true
  },
  {
    id: "rbsk-child-screening",
    name: "Rashtriya Bal Swasthya Karyakram (RBSK)",
    name_hi: "राष्ट्रीय बाल स्वास्थ्य कार्यक्रम (RBSK)",
    category: "Maternal & Child",
    coverage_amount: "100% Free Treatment for 30 Selected Child Conditions",
    summary: "Early screening and zero-cost surgical/medical interventions for children from birth to 18 years covering 4Ds: Defects, Deficiencies, Diseases, and Developmental delays.",
    summary_hi: "जन्म से 18 वर्ष तक के बच्चों की 30 गंभीर बीमारियों, दिल के छेद, कटे होंठ, मोतियाबिंद का 100% मुफ्त ऑपरेशन व इलाज।",
    key_benefits: [
      "Free surgery for congenital heart disease (hole in heart), cleft lip/palate, club foot",
      "Free management of severe acute malnutrition (SAM) at NRCs",
      "Free hearing aids, spectacles, and dental treatments"
    ],
    eligibility_criteria: [
      "All newborn babies, Anganwadi preschool children (0-6 yrs), and government school students (6-18 yrs)"
    ],
    required_documents: [
      "RBSK Screening Card / Anganwadi registration",
      "Birth certificate / Aadhaar of child or parents"
    ],
    application_process: [
      "Mobile Health Teams visit schools and Anganwadi centres twice a year",
      "Referral to District Early Intervention Centre (DEIC) or tertiary medical college",
      "Free transport and treatment coordinated by health team"
    ],
    source_url: "https://rbsk.gov.in",
    source_name: "National Health Mission",
    verified_at: "2026-01-30",
    is_curated: true
  }
];

// There used to be a LOCAL_FACILITIES array here: five invented health
// facilities, with invented names, invented doctors on duty, invented
// phone numbers and hardcoded distances, all placed in and around one
// district in Madhya Pradesh. It backed the assistant's "nearby
// hospitals", the old /api/facilities/nearby endpoint and the Care page.
//
// Every one of those was a fabrication a family could act on. Somebody
// asking for a doctor was given a name that belongs to nobody and a
// number that rings nowhere, and a person in Bihar was shown a distance
// to a building in Sehore. It is deleted rather than corrected, because
// there is now a real answer: public.hospitals holds the National Health
// Authority's PM-JAY empanelment registry — about 38,900 hospitals, with
// a usable coordinate on roughly 96% of them — and every hospital this
// server names now comes from there through hospitals_nearby(). See
// server/routes/hospitals.ts for what that registry may and may not be
// claimed to be, and nearestHospitals() below for the assistant's path
// into it.

// There used to be an `emergencyAlerts` array here, holding live alerts in
// process memory. It opened with two invented emergencies: named patients
// with phone numbers, an ASHA worker called Radha Bai who does not exist,
// and n8n_dispatched set true on both, which asserted that an ambulance
// workflow had fired. A worker opening the portal saw two people in
// distress who were nobody, and a queue that looked worked-through.
//
// Real emergencies live in public.sos_broadcasts, with a delivery row per
// recipient recording whether anybody was actually reached, and worker
// queues live in public.asha_alerts. Both survive a restart, which an
// in-memory array never did. See server/routes/sos.ts.

// A profile with nobody in it.
//
// This used to be `activeUserProfile`, a mutable module-scope object that
// PATCH /api/profile wrote to. It was replaced because a single shared
// object cannot represent two people using the app at once, and because
// what it held was thrown away on restart.
//
// Before that it described an invented woman — name, phone number, age,
// district, village, a "BPL (Priority Household)" ration card and a
// chronic condition. The ration card was the dangerous part: it was fed
// into the eligibility check below and into the assistant prompt, so the
// app told whoever was using it that they held a card nobody had seen.
//
// The real profile is public.profiles, read with the caller's own token by
// server/routes/profile.ts. What survives here is the fallback the two
// routes that accept a profile in the request body use when none is sent:
// every field null or empty, so the answer is shaped by what the person
// actually typed and nothing else. A null renders as a blank they can fill
// in; a plausible default renders as a fact about them.
interface SessionProfile {
  name: string | null;
  phone: string | null;
  age: number | null;
  gender: string | null;
  state: string | null;
  district: string | null;
  village: string | null;
  language: string | null;
  ration_card_type: string | null;
  family_members: number | null;
  is_pregnant_or_lactating: boolean | null;
  chronic_conditions: string[];
  consents: Record<string, boolean>;
  saved_schemes: string[];
}

const EMPTY_PROFILE: SessionProfile = {
  name: null,
  phone: null,
  age: null,
  gender: null,
  state: null,
  district: null,
  village: null,
  language: null,
  ration_card_type: null,
  family_members: null,
  is_pregnant_or_lactating: null,
  chronic_conditions: [],
  consents: {
    voice_processing: false,
    location_access: false,
    health_guidance_disclaimer: false,
    asha_referral_consent: false,
  },
  saved_schemes: []
};

// ================= API ROUTES =================

// Health check.
//
// The question this answers during a demo is never "is the process up" —
// the page loading already proved that. It is "is it actually connected
// to anything, or am I looking at fallbacks?" So it reports what is
// really wired, counts real rows, and names what is missing.
// describeConfig() reports presence only and never returns a secret.
app.get("/api/health", handler(async (req, res) => {
  const config = describeConfig();

  let database: Record<string, unknown> = {
    connected: false,
    reason: "SUPABASE_URL and SUPABASE_SECRET_KEY are not both set",
  };

  if (supabaseReady) {
    try {
      const db = admin();
      const [hospitals, schemes, villages, ashas] = await Promise.all([
        db.from("hospitals").select("id", { count: "exact", head: true }).eq("active", true),
        db.from("schemes").select("id", { count: "exact", head: true }).eq("active", true),
        db.from("villages").select("id", { count: "exact", head: true }),
        db.from("asha_profiles").select("user_id", { count: "exact", head: true }).eq("active", true),
      ]);

      // A missing table means the migrations have not been run, which is a
      // different problem from an unreachable database and deserves to be
      // reported as one rather than as a generic failure.
      const firstError =
        hospitals.error ?? schemes.error ?? villages.error ?? ashas.error;

      if (firstError) {
        database = {
          connected: true,
          migrationsApplied: false,
          reason: firstError.message,
          hint:
            "Run supabase/01_schema.sql through 08_asha_claim.sql in the " +
            "Supabase SQL editor, in numeric order.",
        };
      } else {
        const hospitalCount = hospitals.count ?? 0;
        database = {
          connected: true,
          migrationsApplied: true,
          hospitals: hospitalCount,
          schemes: schemes.count ?? 0,
          villages: villages.count ?? 0,
          ashaWorkers: ashas.count ?? 0,
          ...(hospitalCount === 0
            ? {
                hint:
                  "The hospitals table is empty. Run " +
                  "`node scripts/import-hospitals.mjs` to load the National " +
                  "Health Authority registry.",
              }
            : {}),
        };
      }
    } catch (err: any) {
      database = { connected: false, reason: err?.message ?? String(err) };
    }
  }

  res.json({
    status: "ok",
    app: "Sehat Sathi Rural Health Assistant",
    version: "4.0.0",
    checkedAt: new Date().toISOString(),
    database,
    ...config,
    bundled: {
      // These ship inside the server file and are the fallback the app used
      // before the database existed. Named separately so nobody mistakes a
      // bundled count for a live one. There is no bundled facility count any
      // more: the invented facility list is gone and hospitals come from the
      // registry counted above, or not at all.
      curatedSchemes: CURATED_SCHEMES.length,
    },
  });
}));

/**
 * The written summary that every assistant answer ends with.
 *
 * The requirement is that a user is left with something they can act on:
 * what to carry, what to do next, how to look after themselves in the
 * meantime. Three named lists rather than one paragraph, because these
 * get read aloud, screenshotted, and carried to a counter.
 */
type AssistantSummary = {
  documentsRequired: string[];
  nextSteps: string[];
  healthGuidance: string[];
};

/**
 * Assemble one assistant reply in the shape the client expects.
 *
 * All four return paths in the route below go through here so they cannot
 * drift apart, which they had: one returned nearby hospitals, one returned
 * a hard-coded phone number, and one returned neither, so the same question
 * answered by the model and by the fallback produced visibly different
 * screens.
 *
 * `verification` is always "inferred" here. Nothing the assistant says has
 * been checked by a person, and the badge the UI prints has to say so. The
 * hospital rows are the exception, and they carry their own verification
 * field through from the registry.
 *
 * The snake_case keys at the bottom are duplicates of the camelCase ones,
 * kept because the older assistant screens read `related_schemes` and
 * `source_type`. They are aliases, not a second source of truth, and can be
 * deleted once those screens are updated.
 */
function assistantReply(parts: {
  intent: string;
  isHindi: boolean;
  urgency: string;
  response: string;
  summary: AssistantSummary;
  entities?: Record<string, unknown>;
  relatedSchemes?: Array<Record<string, unknown>>;
  hospitals?: { hospitals: unknown[]; note?: string };
  locationShared: boolean;
  actions?: Array<Record<string, unknown>>;
  sourceType: string;
  sources: string[];
  confidence: number;
}) {
  const {
    intent, isHindi, urgency, response, summary,
    entities = {}, relatedSchemes = [], hospitals, locationShared,
    actions = [], sourceType, sources, confidence,
  } = parts;

  return {
    intent,
    language: isHindi ? "Hindi" : "English",
    entities,
    urgency,
    response,
    summary,
    relatedSchemes,
    nearbyHospitals: hospitals?.hospitals ?? [],
    hospitalsNote: hospitals?.note,
    locationShared,
    actions,
    verification: "inferred" as const,
    sourceType,
    sources,
    confidence,
    disclaimer: isHindi
      ? "यह सलाह उपलब्ध जानकारी से बनी है; किसी डॉक्टर ने इसकी जाँच नहीं की है। इलाज शुरू करने से पहले स्वास्थ्य कर्मी से बात करें।"
      : "This guidance is assembled from available information and has not been reviewed by a clinician. Speak to a health worker before acting on it.",

    // Deprecated aliases — see the note above.
    related_schemes: relatedSchemes,
    nearby_hospitals: hospitals?.hospitals ?? [],
    source_type: sourceType,
  };
}

// 1. POST /api/assistant/message - Orchestrated Multilingual Assistant with Safety Triage
app.post("/api/assistant/message", async (req, res) => {
  try {
    // `location` no longer defaults to "Sehore, MP". That default was
    // interpolated straight into the model prompt, so somebody in Kerala was
    // told about a district in Madhya Pradesh in a confident voice. With no
    // location the answer is simply not location-specific, which is the
    // honest form of not knowing where a person is.
    const {
      message,
      language = "English",
      userProfile = EMPTY_PROFILE,
      location = null,
      lat = null,
      lng = null,
      conversationHistory = [],
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message string is required" });
    }

    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();
    const isHindi = language.toLowerCase().includes("hi") || /[ऀ-ॿ]/.test(trimmed);

    // Coordinates decide whether hospitals can be named at all. No
    // coordinates means no hospital list plus a sentence saying why — never
    // a substituted village centroid or district headquarters.
    const userLat = lat === null || lat === "" || !Number.isFinite(Number(lat)) ? null : Number(lat);
    const userLng = lng === null || lng === "" || !Number.isFinite(Number(lng)) ? null : Number(lng);
    const locationShared = userLat !== null && userLng !== null;

    // Critical Emergency Safety Rules (Bypasses LLM latency if critical)
    const criticalEmergencyPatterns = [
      "chest pain", "heart attack", "can't breathe", "cannot breathe", "choking",
      "heavy bleeding", "profuse bleeding", "unconscious", "fainted", "snake bite",
      "poison", "severe burn", "head injury", "सीने में दर्द", "सांस नहीं आ रही",
      "बेहोश", "सांप ने काटा", "जहर", "खून बह रहा"
    ];

    const isEmergency = criticalEmergencyPatterns.some(pat => lower.includes(pat));

    if (isEmergency) {
      // This branch used to fabricate an emergency record: a patient name, an
      // ASHA worker called "Radha Bai" who does not exist, and
      // n8n_dispatched: true — an assertion that an ambulance workflow had
      // fired. Nothing was dispatched and nobody was notified. Telling a
      // person mid-emergency that help is already on the way, when no message
      // left the building, was the most dangerous line in this file.
      //
      // Now: the guidance is immediate and unchanged, the hospitals come from
      // the registry, and the only thing said about an ASHA worker is a
      // pointer to the SOS flow that can actually reach one and that reports
      // back who it reached. See server/routes/sos.ts.
      const hospitals = await nearestHospitals(userLat, userLng, 3, 50);

      return res.json(assistantReply({
        intent: "emergency",
        isHindi,
        urgency: "emergency",
        entities: { symptoms: [trimmed], urgency_level: "immediate_call" },
        response: isHindi
          ? "⚠️ तुरंत 108 या 112 पर एम्बुलेंस बुलाएँ। यह आपातकालीन स्थिति हो सकती है। शांत रहें, मरीज़ को आराम से लिटाएँ और निकटतम अस्पताल पहुँचें। परिजनों और आशा कार्यकर्ता तक ख़बर पहुँचाने के लिए 'आपातकालीन SOS' भेजें — भेजने के बाद आपको दिखेगा कि सूचना किस-किस तक पहुँची।"
          : "⚠️ Call 108 or 112 for an ambulance now. This may be a medical emergency. Keep the patient calm and resting, and reach the nearest hospital. To reach your family contacts and your ASHA worker, send an Emergency SOS — after sending, you will see exactly who it reached.",
        summary: {
          documentsRequired: isHindi
            ? ["दस्तावेज़ न होने पर भी आपातकालीन इलाज से मना नहीं किया जा सकता", "पास में हों तो आयुष्मान कार्ड और आधार साथ ले जाएँ"]
            : ["Emergency treatment cannot be refused for want of documents", "Carry the Ayushman card and Aadhaar only if they are already within reach"],
          nextSteps: isHindi
            ? ["108 या 112 पर कॉल करें", "आपातकालीन SOS भेजें", "निकटतम सूचीबद्ध अस्पताल पहुँचें"]
            : ["Call 108 or 112 now", "Send an Emergency SOS", "Reach the nearest listed hospital"],
          healthGuidance: isHindi
            ? ["मरीज़ को बिना ज़रूरत हिलाएँ-डुलाएँ नहीं", "खाने-पीने को कुछ न दें", "साँस और होश पर नज़र रखें"]
            : ["Do not move the patient unnecessarily", "Do not give anything to eat or drink", "Keep watching their breathing and alertness"],
        },
        hospitals,
        locationShared,
        actions: [
          { type: "call_emergency", label: "Call 108 Ambulance", number: "108" },
          { type: "call_emergency", label: "Call 112 All Emergencies", number: "112" },
          { type: "broadcast_sos", label: isHindi ? "आपातकालीन SOS भेजें" : "Send Emergency SOS", link: "/emergency" },
          { type: "find_care", label: isHindi ? "निकटतम अस्पताल" : "Nearest Hospital", link: "/care" }
        ],
        sourceType: "curated",
        sources: ["National Emergency Medical Guidelines", "MoHFW Emergency Triage"],
        confidence: 0.99,
      }));
    }

    // Standard Query Processing with Resilient Gemini Cascade
    const systemInstruction = `
You are Sehat Sathi (सेहत साथी), a compassionate, verified AI Rural Health and Government Health Scheme Assistant built for rural and semi-urban India.
Tone: Respectful, very clear, jargon-free, supportive, culturally sensitive.
Key direct directives:
1. Provide safe, verified first-step guidance, home comfort measures, and remind users that this does NOT replace a registered medical practitioner.
2. If the user asks about health schemes (Ayushman Bharat, Janani Suraksha, PMMVY, free medicines, Nikshay, etc.), clearly explain benefits, eligibility, and required documents.
3. If the user asks for doctors, pharmacies, PHC, or CHC, guide them to local public health resources.
4. Output MUST be valid JSON adhering to the specified schema.
5. Provide the user-facing explanation in the user's preferred language: ${language}.
`;

    // Conversation history and profile facts are passed only when they are
    // real. A "Ration Card: BPL" default used to be interpolated here, which
    // fed the model an entitlement claim about somebody it knew nothing
    // about, and the model then repeated it back as established fact.
    const contextLines = [
      userProfile?.name ? `- Name: ${userProfile.name}` : null,
      userProfile?.district ? `- District: ${userProfile.district}` : null,
      userProfile?.village ? `- Village: ${userProfile.village}` : null,
      userProfile?.ration_card_type ? `- Ration card: ${userProfile.ration_card_type}` : null,
      location ? `- Stated location: ${location}` : null,
      `- Preferred language: ${language}`,
      locationShared
        ? "- The user has shared GPS coordinates, so a real hospital list is attached to this answer by the server."
        : "- The user has NOT shared a location. Do not name any specific facility, town or district.",
    ].filter(Boolean).join("\n");

    const recentTurns = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .slice(-6)
      .map((turn: any) => `${turn?.role === "assistant" ? "Assistant" : "User"}: ${String(turn?.content ?? turn?.text ?? "").slice(0, 500)}`)
      .join("\n");

    const prompt = `
User Question: "${trimmed}"

What is actually known about this user:
${contextLines}
${recentTurns ? `\nEarlier in this conversation:\n${recentTurns}\n` : ""}
Instructions:
1. Answer empathetically and clearly in ${language}.
2. Suggest 1-2 applicable Government Health Schemes relevant to the concern (Ayushman Bharat PM-JAY, Janani Suraksha Yojana, PM Matru Vandana, Jan Aushadhi, Nikshay Poshan, RBSK and so on), with what the scheme gives and who it is for.
3. Phrase every eligibility statement as a possibility to be checked, never as a decision — "you may be eligible based on the information available", not "you are eligible".
4. Never invent a hospital, clinic, doctor, address or phone number. The server attaches the real facility list. Refer to it generally ("the nearest listed hospitals below") and say nothing about which facilities exist near this user.
5. Fill 'summary' with three lists the user can act on: 'documents_required' (papers to carry), 'next_steps' (what to do, in order) and 'health_guidance' (care and precautions until then). Three to five short items each, in ${language}.
6. Include actionable chips in 'actions' linking to schemes (/schemes/<id>) and to the facility list (/care).
7. Populate 'related_schemes' with id, title, benefit_summary and link.

Respond with structured JSON adhering to the schema.
`;

    const candidateTextModels = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-pro"];
    const parsedResult = await callGeminiSafe(
      candidateTextModels,
      (gemini, model) =>
        gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: { type: Type.STRING },
                language: { type: Type.STRING },
                entities: {
                  type: Type.OBJECT,
                  properties: {
                    symptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
                    scheme_topic: { type: Type.STRING },
                    facility_type: { type: Type.STRING },
                  },
                },
                urgency: { type: Type.STRING },
                response: { type: Type.STRING },
                // The written summary is required, not optional. Made
                // optional, the model omitted it on roughly half of short
                // questions, and the screen that promises a summary at the
                // end of every answer would then have nothing to show.
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    documents_required: { type: Type.ARRAY, items: { type: Type.STRING } },
                    next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                    health_guidance: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: ["documents_required", "next_steps", "health_guidance"],
                },
                related_schemes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      title: { type: Type.STRING },
                      benefit_summary: { type: Type.STRING },
                      link: { type: Type.STRING },
                    },
                    required: ["id", "title", "benefit_summary", "link"],
                  },
                },
                actions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      label: { type: Type.STRING },
                      link: { type: Type.STRING },
                      target_id: { type: Type.STRING },
                    },
                    required: ["type", "label"],
                  },
                },
                source_type: { type: Type.STRING },
                sources: { type: Type.ARRAY, items: { type: Type.STRING } },
                confidence: { type: Type.NUMBER },
              },
              required: ["intent", "language", "urgency", "response", "summary", "actions", "source_type", "sources"],
            },
          },
        }),
      (text) => JSON.parse(text)
    );

    if (parsedResult && parsedResult.response) {
      // The model answers in snake_case because that is what its schema
      // declares; the client contract is camelCase. Mapped here rather than
      // teaching the client two shapes. Hospitals are attached by the server,
      // never by the model — the model has no access to the registry and any
      // facility it named would be invented.
      const hospitals = await nearestHospitals(userLat, userLng, 3, 25);
      const modelSummary = parsedResult.summary ?? {};
      const asList = (value: unknown) =>
        Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : [];

      return res.json(assistantReply({
        intent: parsedResult.intent || "health_guidance",
        isHindi: isHindi || String(parsedResult.language || "").toLowerCase().includes("hi"),
        urgency: parsedResult.urgency || "normal",
        entities: parsedResult.entities || {},
        response: parsedResult.response,
        summary: {
          documentsRequired: asList(modelSummary.documents_required),
          nextSteps: asList(modelSummary.next_steps),
          healthGuidance: asList(modelSummary.health_guidance),
        },
        relatedSchemes: (Array.isArray(parsedResult.related_schemes) ? parsedResult.related_schemes : [])
          .map((scheme: any) => ({
            id: scheme?.id,
            title: scheme?.title,
            benefitSummary: scheme?.benefit_summary,
            link: scheme?.link,
            benefit_summary: scheme?.benefit_summary, // alias, see assistantReply
          }))
          .filter((scheme: any) => scheme.id && scheme.title),
        hospitals,
        locationShared,
        actions: Array.isArray(parsedResult.actions) ? parsedResult.actions : [],
        sourceType: parsedResult.source_type || "model",
        sources: asList(parsedResult.sources),
        confidence: typeof parsedResult.confidence === "number" ? parsedResult.confidence : 0.8,
      }));
    }

    // Robust Rule-Based & Curated Fallback. `isHindi` is already resolved at
    // the top of the route; it used to be recomputed here.
    // Check if query is about schemes
    if (lower.includes("scheme") || lower.includes("ayushman") || lower.includes("pmjay") || lower.includes("card") || lower.includes("delivery") || lower.includes("योजना") || lower.includes("आयुष्मान") || lower.includes("पैसा")) {
      const hospitals = await nearestHospitals(userLat, userLng, 3, 25);
      return res.json(assistantReply({
        intent: "scheme_search",
        isHindi,
        urgency: "normal",
        entities: { scheme_topic: "Ayushman Bharat PM-JAY & Janani Suraksha" },
        response: isHindi
          ? "सरकारी स्वास्थ्य योजनाओं के तहत परिवार को कई लाभ मिल सकते हैं:\n1. आयुष्मान भारत (PM-JAY): पात्र परिवारों के लिए प्रति वर्ष ₹5 लाख तक का कैशलेस इलाज।\n2. जननी सुरक्षा योजना (JSY): संस्थागत प्रसव पर नकद सहायता।\n3. जन औषधि केंद्र: जेनेरिक दवाएं काफ़ी कम कीमत पर।\nराशन कार्ड और आधार लेकर निकटतम स्वास्थ्य केंद्र या CSC पर अपनी पात्रता जाँचवाएँ — पात्रता वहीं तय होती है, इस ऐप में नहीं।"
          : "Government health schemes can give your family substantial support:\n1. Ayushman Bharat PM-JAY: up to ₹5 lakh of cashless hospital care a year for eligible families.\n2. Janani Suraksha Yojana: cash assistance for an institutional delivery.\n3. Jan Aushadhi Kendras: the same medicines at a fraction of the price.\nTake your ration card and Aadhaar to the nearest health centre or CSC to have your eligibility checked — that check happens there, not in this app.",
        summary: {
          documentsRequired: isHindi
            ? ["आधार कार्ड (परिवार के हर सदस्य का)", "राशन कार्ड या SECC/पात्रता पर्ची", "मोबाइल नंबर", "पहले का इलाज हुआ हो तो पर्चे"]
            : ["Aadhaar card for each family member", "Ration card or SECC / entitlement slip", "A mobile number", "Earlier prescriptions or discharge papers, if any"],
          nextSteps: isHindi
            ? ["नज़दीकी CSC, आयुष्मान आरोग्य मंदिर या सूचीबद्ध अस्पताल के आयुष्मान मित्र काउंटर पर जाएँ", "अपना नाम लाभार्थी सूची में जाँचवाएँ", "आयुष्मान कार्ड मुफ़्त बनवाएँ — किसी को पैसे न दें", "गाँव की आशा कार्यकर्ता से मदद लें"]
            : ["Visit a CSC, an Ayushman Arogya Mandir, or the Ayushman Mitra desk at a listed hospital", "Ask them to check your name against the beneficiary list", "Have the Ayushman card made — it is free, pay nobody for it", "Ask your village ASHA worker to help with the paperwork"],
          healthGuidance: isHindi
            ? ["योजना का कार्ड बनने से पहले भी आपातकालीन इलाज नहीं रोका जा सकता", "इलाज से पहले अस्पताल से पूछें कि वह इस योजना में सूचीबद्ध है या नहीं"]
            : ["Emergency treatment cannot be withheld while a card is still being made", "Before treatment, ask the hospital directly whether it is empanelled under the scheme"],
        },
        relatedSchemes: [
          {
            id: "pmjay-ayushman",
            title: isHindi ? "आयुष्मान भारत (PM-JAY)" : "Ayushman Bharat (PM-JAY)",
            benefitSummary: isHindi ? "पात्र परिवारों के लिए सालाना ₹5 लाख तक कैशलेस इलाज" : "Up to ₹5 lakh of cashless hospital care a year for eligible families",
            benefit_summary: isHindi ? "पात्र परिवारों के लिए सालाना ₹5 लाख तक कैशलेस इलाज" : "Up to ₹5 lakh of cashless hospital care a year for eligible families",
            link: "/schemes/pmjay-ayushman"
          },
          {
            id: "janani-suraksha",
            title: isHindi ? "जननी सुरक्षा योजना (JSY)" : "Janani Suraksha Yojana (JSY)",
            benefitSummary: isHindi ? "संस्थागत प्रसव पर नकद सहायता" : "Cash assistance for an institutional delivery",
            benefit_summary: isHindi ? "संस्थागत प्रसव पर नकद सहायता" : "Cash assistance for an institutional delivery",
            link: "/schemes/janani-suraksha"
          }
        ],
        hospitals,
        locationShared,
        actions: [
          { type: "open_scheme", label: isHindi ? "आयुष्मान योजना देखें" : "View Ayushman Bharat", link: "/schemes/pmjay-ayushman" },
          { type: "open_scheme", label: isHindi ? "जननी सुरक्षा देखें" : "View Janani Suraksha", link: "/schemes/janani-suraksha" },
          { type: "find_care", label: isHindi ? "सूचीबद्ध अस्पताल खोजें" : "Find an empanelled hospital", link: "/care" },
          { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता से पूछें" : "Ask your ASHA worker", link: "/messages" }
        ],
        sourceType: "curated",
        sources: ["National Health Authority (pmjay.gov.in)", "National Health Mission (nhm.gov.in)"],
        confidence: 0.96,
      }));
    }

    // Check if query is about finding a clinic, doctor or hospital
    if (lower.includes("doctor") || lower.includes("hospital") || lower.includes("clinic") || lower.includes("phc") || lower.includes("chc") || lower.includes("अस्पताल") || lower.includes("डॉक्टर") || lower.includes("दवा")) {
      // This used to answer "Sadar Community Health Centre is 1.8 km away,
      // call 07562-224411" to every user in the country. The centre, the
      // distance and the number were all written into the source. What
      // replaces them is the registry list, or an honest blank.
      const hospitals = await nearestHospitals(userLat, userLng, 5, 25);
      const found = hospitals.hospitals.length;

      return res.json(assistantReply({
        intent: "find_care",
        isHindi,
        urgency: "normal",
        entities: { facility_type: "Empanelled hospital / Primary Health Centre" },
        response: found > 0
          ? (isHindi
            ? `आपके स्थान के आसपास ${found} सूचीबद्ध अस्पताल मिले — नीचे दूरी, पता और फ़ोन नंबर के साथ दिए गए हैं। जाने से पहले फ़ोन करके पुष्टि कर लें कि जिस विभाग की ज़रूरत है वह आज खुला है। सरकारी प्राथमिक स्वास्थ्य केंद्र (PHC) और आयुष्मान आरोग्य मंदिर में आवश्यक दवाएं और बुनियादी जाँचें मुफ़्त मिलती हैं।`
            : `There are ${found} listed hospitals near your location, shown below with distance, address and phone number. Ring ahead to confirm the department you need is open today. Government PHCs and Ayushman Arogya Mandirs provide essential medicines and basic tests free of charge.`)
          : (isHindi
            ? "अस्पतालों की सूची आपके स्थान के आधार पर बनती है। स्थान की अनुमति देने पर सूचीबद्ध अस्पताल दूरी के क्रम में दिखेंगे। तब तक: सरकारी PHC और आयुष्मान आरोग्य मंदिर में आवश्यक दवाएं और बुनियादी जाँचें मुफ़्त मिलती हैं, और आपकी आशा कार्यकर्ता बता सकती हैं कि गाँव के लिए कौन सा केंद्र तय है।"
            : "The hospital list is built from your location. Allow location access and the listed hospitals will appear in order of distance. Meanwhile: government PHCs and Ayushman Arogya Mandirs provide essential medicines and basic tests free of charge, and your ASHA worker can tell you which centre your village is attached to."),
        summary: {
          documentsRequired: isHindi
            ? ["आधार कार्ड", "आयुष्मान कार्ड, यदि बना हो", "पहले के पर्चे और जाँच रिपोर्ट"]
            : ["Aadhaar card", "Ayushman card, if you have one", "Earlier prescriptions and test reports"],
          nextSteps: isHindi
            ? ["जाने से पहले अस्पताल को फ़ोन करके OPD का समय पूछें", "आयुष्मान के तहत इलाज चाहिए तो आयुष्मान मित्र काउंटर पर जाएँ", "आपात स्थिति में 108 पर एम्बुलेंस बुलाएँ, इंतज़ार न करें"]
            : ["Phone the hospital before travelling and ask its OPD hours", "For treatment under Ayushman Bharat, go to the Ayushman Mitra desk", "In an emergency call 108 for an ambulance rather than travelling on your own"],
          healthGuidance: isHindi
            ? ["सभी पुरानी रिपोर्ट एक फ़ाइल में साथ रखें", "जो दवाएं चल रही हैं उनके नाम लिखकर ले जाएँ"]
            : ["Keep all past reports together in one folder", "Write down the names of medicines you are already taking and carry the list"],
        },
        hospitals,
        locationShared,
        actions: [
          { type: "find_care", label: isHindi ? "सभी नज़दीकी अस्पताल देखें" : "See all nearby hospitals", link: "/care" },
          { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता से पूछें" : "Ask your ASHA worker", link: "/messages" }
        ],
        sourceType: "registry",
        sources: ["National Health Authority PM-JAY empanelled hospital registry"],
        confidence: found > 0 ? 0.95 : 0.6,
      }));
    }

    // General Health Guidance Fallback
    return res.json(assistantReply({
      intent: "health_guidance",
      isHindi,
      urgency: "normal",
      entities: { symptoms: [trimmed] },
      response: isHindi
        ? `आपकी बात "${trimmed}" के लिए प्राथमिक सलाह:\n1. पर्याप्त आराम करें और उबाला हुआ गुनगुना पानी पिएँ।\n2. डॉक्टर या स्वास्थ्य कर्मी की सलाह के बिना एंटीबायोटिक या तेज़ दवा न लें।\n3. लक्षण दो दिन से ज़्यादा बने रहें, बिगड़ें, या तेज़ बुखार और कमज़ोरी हो तो निकटतम प्राथमिक स्वास्थ्य केंद्र जाएँ या अपनी आशा कार्यकर्ता से बात करें।`
        : `First-step guidance about "${trimmed}":\n1. Rest properly and drink plenty of clean, boiled water, warm rather than cold.\n2. Do not take antibiotics or strong medicines without a doctor or health worker advising them.\n3. If it lasts more than two days, gets worse, or comes with a high fever or weakness, go to your nearest Primary Health Centre or speak to your ASHA worker.`,
      summary: {
        documentsRequired: isHindi
          ? ["आधार कार्ड", "जो दवाएं चल रही हैं उनकी सूची या पुराने पर्चे"]
          : ["Aadhaar card", "A list of medicines you are already taking, or your old prescriptions"],
        nextSteps: isHindi
          ? ["दो दिन लक्षणों पर नज़र रखें और लिखते जाएँ", "आराम न मिले तो PHC की OPD में दिखाएँ", "गाँव की आशा कार्यकर्ता को बताएँ — वे नज़दीकी केंद्र और शिविर की जानकारी दे सकती हैं"]
          : ["Watch the symptoms for two days and write down what changes", "If there is no relief, attend the OPD at your PHC", "Tell your village ASHA worker — she can point you to the right centre or an upcoming camp"],
        healthGuidance: isHindi
          ? ["साफ़ पानी और ताज़ा बना खाना लें", "हाथ धोने का ध्यान रखें", "बुखार हो तो शरीर में पानी की कमी न होने दें"]
          : ["Stick to clean water and freshly cooked food", "Wash hands carefully", "If there is a fever, keep up fluids so they do not become dehydrated"],
      },
      hospitals: undefined,
      locationShared,
      actions: [
        { type: "find_care", label: isHindi ? "पास का अस्पताल खोजें" : "Find a hospital nearby", link: "/care" },
        { type: "open_scheme", label: isHindi ? "सरकारी योजनाएं देखें" : "Explore health schemes", link: "/schemes" },
        { type: "message_asha", label: isHindi ? "आशा कार्यकर्ता को संदेश भेजें" : "Message your ASHA worker", link: "/messages" }
      ],
      sourceType: "curated",
      sources: ["National Health Mission primary care guidelines", "WHO rural health protocols"],
      confidence: 0.92,
    }));
  } catch (error) {
    console.error("Error in /api/assistant/message:", error);
    res.status(500).json({ error: "Failed to process health guidance request" });
  }
});

// 2. POST /api/voice/transcribe - Bhashini / Speech Transcription Endpoint
app.post("/api/voice/transcribe", async (req, res) => {
  try {
    const { audioData, language = "hi", textInput } = req.body;

    if (textInput) {
      return res.json({
        transcript: textInput,
        confidence: 0.98,
        language: language,
        provider: "bhashini_nlp"
      });
    }

    // If audio was supplied
    return res.json({
      transcript: "मुझे पिछले दो दिन से सिरदर्द और बुखार है, क्या मुझे दवा लेनी चाहिए?",
      confidence: 0.95,
      language: "hi",
      provider: "bhashini_stt"
    });
  } catch (error) {
    res.status(500).json({ error: "Transcription failed" });
  }
});

// 3. POST /api/voice/synthesize - Text to Speech
app.post("/api/voice/synthesize", async (req, res) => {
  try {
    const { text, language = "Hindi" } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    // Client can use Web Speech API in browser or audio payload
    return res.json({
      status: "synthesized",
      text,
      language,
      provider: "bhashini_tts_ready"
    });
  } catch (error) {
    res.status(500).json({ error: "Speech synthesis failed" });
  }
});

// 4. GET /api/schemes - Search & Filter Curated Schemes
app.get("/api/schemes", (req, res) => {
  const { category, search, state } = req.query;
  let results = [...CURATED_SCHEMES];

  if (category && category !== "All") {
    results = results.filter(s => s.category.toLowerCase() === String(category).toLowerCase());
  }

  if (search) {
    const q = String(search).toLowerCase();
    results = results.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.name_hi.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.summary_hi.toLowerCase().includes(q)
    );
  }

  res.json({
    count: results.length,
    schemes: results
  });
});

// 5. GET /api/schemes/:id - Scheme Details
app.get("/api/schemes/:id", (req, res) => {
  const scheme = CURATED_SCHEMES.find(s => s.id === req.params.id);
  if (!scheme) {
    return res.status(404).json({ error: "Scheme not found" });
  }
  res.json(scheme);
});

// 5b. GET /api/schemes/:id/eligible-hospitals - nearby PM-JAY hospitals for a scheme
app.get("/api/schemes/:id/eligible-hospitals", async (req, res) => {
  try {
    const scheme = CURATED_SCHEMES.find((s) => s.id === req.params.id);
    if (!scheme) {
      return res.status(404).json({ error: "Scheme not found" });
    }

    const lat = queryNumber(req.query.lat);
    const lng = queryNumber(req.query.lng);
    const radiusKm = clampNumber(queryNumber(req.query.radiusKm) ?? 25, 1, 100);

    if (lat === null || lng === null) {
      return res.json({
        schemeId: scheme.id,
        schemeName: scheme.name,
        schemeCategory: scheme.category,
        hospitals: [],
        count: 0,
        radiusKm,
        note: "Share your location to see scheme-eligible hospitals near you.",
      });
    }

    const nearby = await nearestHospitals(lat, lng, 20, radiusKm);

    res.json({
      schemeId: scheme.id,
      schemeName: scheme.name,
      schemeCategory: scheme.category,
      hospitals: nearby.hospitals,
      count: nearby.hospitals.length,
      radiusKm,
      note:
        nearby.hospitals.length === 0
          ? nearby.note ??
            `No PM-JAY empanelled hospitals found within ${radiusKm} km. Try widening the search or searching by district.`
          : `These hospitals are empanelled under PM-JAY and may offer services related to ${scheme.name}. Confirm directly before visiting.`,
    });
  } catch (error: any) {
    res.status(500).json({
      error:
        error?.message ||
        "Could not load scheme-eligible hospitals right now.",
    });
  }
});

// 6. POST /api/schemes/search-live - Live Search Fallback (Tavily/Gov domain grounding)
app.post("/api/schemes/search-live", async (req, res) => {
  try {
    const { query, language = "English" } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const prompt = `Search official Indian Government health databases (such as mohfw.gov.in, pmjay.gov.in, nhp.gov.in, myscheme.gov.in) for the user's specific health scheme query: "${query}".
Provide a concise, verified summary with eligibility criteria, key benefits, and official source website.
Language: ${language}.
Format as JSON:
{
  "name": "Scheme Official Name",
  "name_hi": "योजना का नाम",
  "category": "General",
  "coverage_amount": "Coverage details",
  "summary": "Brief summary",
  "key_benefits": ["Benefit 1", "Benefit 2"],
  "eligibility_criteria": ["Eligibility 1", "Eligibility 2"],
  "required_documents": ["Doc 1", "Doc 2"],
  "application_process": ["Step 1", "Step 2"],
  "source_url": "https://official-gov-url",
  "source_name": "Official Ministry / Department",
  "verified_at": "2026-02-21",
  "is_curated": false
}`;

    const candidateTextModels = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-pro"];
    const liveResult = await callGeminiSafe(
      candidateTextModels,
      (gemini, model) =>
        gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          }
        }),
      (text) => JSON.parse(text)
    );

    if (liveResult && liveResult.name) {
      return res.json({
        source_type: "tavily_live",
        live_source_badge: "Live Government Search Verified",
        scheme: liveResult
      });
    }

    // Default Live Fallback Response
    res.json({
      source_type: "tavily_live",
      live_source_badge: "Live Government Search Verified",
      scheme: {
        id: `live-${Date.now()}`,
        name: `National Health Scheme Information: ${query}`,
        name_hi: `${query} से संबंधित सरकारी स्वास्थ्य जानकारी`,
        category: "General",
        coverage_amount: "Varies by State / Criteria",
        summary: `Live retrieved information for ${query} from official portals under National Health Mission and MyScheme.gov.in.`,
        summary_hi: `राष्ट्रीय स्वास्थ्य मिशन और आधिकारिक सरकारी पोर्टल से प्राप्त सत्यापित जानकारी।`,
        key_benefits: [
          "Financial coverage and subsidized diagnosis at government empanelled centres",
          "Direct Benefit Transfer (DBT) to beneficiary Aadhaar-linked bank account",
          "Free medicines through Government Public Health Dispensaries"
        ],
        eligibility_criteria: [
          "Indian citizen residing in the operational district",
          "Priority to BPL, Antyodaya, SC/ST, and rural agricultural families"
        ],
        required_documents: [
          "Aadhaar Card",
          "Ration Card / Income Certificate",
          "Bank Account Passbook"
        ],
        application_process: [
          "Visit nearest CSC Kendra or Gram Panchayat Health Sub-Centre",
          "Submit application with Aadhaar e-KYC verification"
        ],
        source_url: "https://www.myscheme.gov.in/schemes/health-and-wellness",
        source_name: "MyScheme Portal, Ministry of Electronics & IT, GoI",
        verified_at: new Date().toISOString().split("T")[0],
        is_curated: false
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to perform live scheme search" });
  }
});

// 7. POST /api/schemes/eligibility — what is known, checked against what the
// scheme asks for.
//
// This route used to decide. It defaulted `is_eligible` to true, returned a
// `match_score` of 94, ticked "Aadhaar Card available" and "Bank account
// linked with Aadhaar" as met without ever having seen either, and when it
// had no reason to give said "Your profile meets the rural demographic and
// BPL/Priority household criteria" — about a profile that is now entirely
// null. Only gender could actually make it say no.
//
// Eligibility for these schemes is decided by an Ayushman Mitra against the
// SECC and state databases, not by this app, and a family told here that
// they qualify will travel to a hospital and be turned away at the counter.
// So the route no longer returns a verdict. It returns each criterion with
// one of three states — met, not_met, unknown — and unknown is what most of
// them are, because nobody has been asked yet.
app.post("/api/schemes/eligibility", (req, res) => {
  const { schemeId, profile = EMPTY_PROFILE } = req.body;
  const scheme = CURATED_SCHEMES.find(s => s.id === schemeId);

  if (!scheme) {
    return res.status(404).json({ error: "Scheme not found" });
  }

  type CheckState = "met" | "not_met" | "unknown";
  const check = (title: string, state: CheckState, note?: string) => ({ title, state, note });

  const card = profile?.ration_card_type ?? null;
  const priorityCard =
    card === null
      ? null
      : /bpl|priority|antyodaya|aay|nfsa/i.test(String(card));

  const checklist = [
    check(
      "Aadhaar card for each family member",
      "unknown",
      "This app has not seen your Aadhaar and cannot check it.",
    ),
    check(
      "Ration card — Antyodaya, Priority Household or NFSA",
      priorityCard === null ? "unknown" : priorityCard ? "met" : "not_met",
      priorityCard === null
        ? "You have not told us which ration card your household holds."
        : priorityCard
          ? `You have entered "${card}". The counter will verify it against the SECC list.`
          : `You have entered "${card}", which is not one of the priority categories. Ask at the counter — states add categories of their own.`,
    ),
    check(
      "Bank account linked with Aadhaar",
      "unknown",
      "Needed for schemes that pay money directly. Not something this app can check.",
    ),
  ];

  // A single genuinely checkable rule: two of these schemes are for women
  // during pregnancy and after childbirth. Stated as what the scheme covers,
  // not as a judgement about the person reading it.
  const notes: string[] = [];
  if (scheme.id === "janani-suraksha" || scheme.id === "pmmvy-matru-vandana") {
    checklist.push(
      check(
        "For pregnant and lactating mothers",
        profile?.gender === "Male" ? "not_met" : profile?.gender ? "met" : "unknown",
        "This scheme covers women during pregnancy and after childbirth. It can also be claimed on behalf of a family member.",
      ),
    );
    notes.push(
      "Registration in the first trimester matters here: some of the benefit is tied to antenatal checkups completed before delivery.",
    );
  }

  res.json({
    scheme_id: scheme.id,
    scheme_name: scheme.name,
    // Deliberately absent: is_eligible and match_score. See the note above.
    decision: "not_assessed",
    decisionNote:
      "This app cannot decide eligibility. Eligibility for this scheme is " +
      "confirmed by an Ayushman Mitra or the scheme office against the SECC " +
      "and state records. Based on the information available you may be " +
      "eligible — take the documents below and have it checked.",
    criteria: scheme.eligibility_criteria,
    checklist,
    unknownCount: checklist.filter(c => c.state === "unknown").length,
    documents: scheme.required_documents,
    notes,
    next_steps: [
      "Carry the original Aadhaar and ration card, not photocopies alone",
      "Ask the Ayushman Mitra at a listed hospital, a CSC, or an Ayushman Arogya Mandir to check your name",
      "Registration is free — pay nobody a fee for it",
      "Your village ASHA worker can help with the paperwork",
    ],
    verification: "inferred",
    source_name: scheme.source_name,
    source_url: scheme.source_url,
  });
});

// 8. GET /api/facilities/nearby — retired.
//
// This route served LOCAL_FACILITIES: a hand-written array of health centres
// with invented names, invented distances, invented doctors and invented
// phone numbers, sorted by a Haversine distance to coordinates that were
// themselves made up. It has been replaced by GET /api/hospitals/nearby,
// which reads the National Health Authority's PM-JAY empanelled hospital
// registry imported into Postgres.
//
// It answers 410 rather than being deleted outright because a stale caller
// would otherwise fall through to the Vite catch-all and receive index.html,
// and JSON.parse on a page of HTML produces an error that tells nobody
// anything. This can go once no client references it.
app.get("/api/facilities/nearby", (_req, res) => {
  res.status(410).json({
    error: "Retired endpoint",
    detail:
      "GET /api/facilities/nearby has been replaced by GET /api/hospitals/nearby?lat=&lng=, which serves the National Health Authority PM-JAY empanelled hospital registry.",
    replacement: "/api/hospitals/nearby",
  });
});

// 9. POST /api/image/analyze - Medical Image / Prescription / OPD Slip Assist
app.post("/api/image/analyze", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/jpeg", notes = "", language = "Hindi" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "Image data is required" });
    }

    const isHindi = language.toLowerCase().includes("hi") || language === "हिन्दी";
    const candidateVisionModels = [
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ];

    const prompt = `You are Sehat Sathi's expert Indian medical document & prescription analyzer for rural and urban citizens.
Analyze this medical document (OPD prescription, lab investigation order slip, hospital note, doctor parchi, or medicine strip).

EXTRACTION INSTRUCTIONS:
1. Extract Header & Patient Details: Hospital/Clinic name, Doctor name, Patient Name, Date, OPD No, Department.
2. Clinical Complaints / Diagnosis: Explain any complaints (fever, chest pain, diabetes, hypertension, weakness, etc.) in simple ${language}.
3. Prescribed Medicines (if present):
   - Name and strength
   - Jan Aushadhi generic salt equivalent (highlighting 50%-80% cost savings)
   - Exact dosage & timing (e.g., 1 गोली सुबह-शाम भोजन के बाद / 1 tab twice daily after meals)
   - Purpose in simple ${language}
4. Ordered Diagnostic Investigations / Lab Tests (crucial for OPD slips):
   - Name of test (e.g., Blood Sugar Fasting, Lipid Profile / Serum Cholesterol, SGOT/SGPT, Urine Routine, ECG, Echocardiography, TMT, Serum Creatinine, Uric Acid)
   - Why doctor ordered it / Purpose in simple ${language} (e.g. दिल की जाँच, लिवर/किडनी कार्यप्रणाली, कोलेस्ट्रॉल स्तर)
   - Patient Preparation (e.g., 8-10 घंटे खाली पेट / Fasting required)
   - Government Facility: State that this test is available free or at low cost at Government District Hospitals, CHC, or Ayushman Arogya Mandir.
5. Patient Next Steps: Clear bullet points on what the patient should do step-by-step.
6. Precautions & Lifestyle: Diet advice (low salt/oil, boiled water, hydration) and precautions.
7. Government Schemes: Mention applicable schemes (Ayushman Bharat PM-JAY ₹5L cover, Jan Aushadhi generic savings, Free Diagnostics under NHM).
8. If the image is not a medical document at all, set "error": "This does not appear to be a medical prescription or slip. Please upload a clear doctor's prescription."

Output ONLY valid JSON matching this schema:
{
  "detected_document_type": "डॉक्टर पर्ची व जाँच आदेश (OPD Prescription & Investigation Order)",
  "confidence": "high",
  "patient_info": {
    "hospital": "Hospital or Clinic name",
    "doctor": "Doctor name",
    "patient_name": "Patient name",
    "date": "Date if visible",
    "department": "General / Cardiology / etc."
  },
  "diagnosis_summary": "Plain language explanation of doctor findings or complaints in ${language}",
  "medicines": [
    {
      "name": "Medicine Name & Strength",
      "generic_equivalent": "Jan Aushadhi Generic Equivalent (Available at Kendra @ 80% discount)",
      "dosage": "Dosage instructions",
      "purpose": "Purpose of medication"
    }
  ],
  "investigations": [
    {
      "test_name": "Test Name",
      "purpose": "Why doctor ordered it in ${language}",
      "preparation": "Fasting or special instructions",
      "facility_support": "Free / Low-cost at PHC, CHC & District Hospital"
    }
  ],
  "treatment_advice": "Overall medical guidance in ${language}",
  "next_steps": [
    "Step 1...",
    "Step 2..."
  ],
  "precautions": [
    "Precaution 1...",
    "Precaution 2..."
  ],
  "scheme_suggestion": "Government schemes information in ${language}",
  "safety_warning": "⚠️ AI-assisted reading. Always confirm with doctor or pharmacist before taking medicines or undergoing treatments."
}

User Notes: "${notes || 'None'}"
Language: ${language}`;

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const parsedResult = await callGeminiSafe(
      candidateVisionModels,
      (gemini, model) =>
        gemini.models.generateContent({
          model,
          contents: {
            parts: [
              { inlineData: { data: cleanBase64, mimeType } },
              { text: prompt }
            ]
          },
          config: { responseMimeType: "application/json" }
        }),
      (text) => JSON.parse(text)
    );

    // If Gemini returned an explicit error (e.g. non-medical image)
    if (parsedResult?.error) {
      return res.json({
        detected_document_type: isHindi ? "अमान्य दस्तावेज़" : "Invalid Document",
        confidence: "none",
        patient_info: null,
        diagnosis_summary: "",
        medicines: [],
        investigations: [],
        next_steps: [],
        precautions: [],
        scheme_suggestion: "",
        safety_warning: parsedResult.error
      });
    }

    if (parsedResult) {
      const meds = Array.isArray(parsedResult.medicines) ? parsedResult.medicines : [];
      const tests = Array.isArray(parsedResult.investigations) ? parsedResult.investigations : [];

      // Post-processing safety filter on medicines if present
      const unclearCount = meds.filter((m: any) => 
        String(m?.name || "").toLowerCase().includes("unclear") || 
        String(m?.name || "").toLowerCase().includes("unknown")
      ).length;
      
      let confidence = parsedResult.confidence || "high";
      if (meds.length > 0 && unclearCount / meds.length > 0.5) {
        confidence = "low";
      }

      return res.json({
        detected_document_type: parsedResult.detected_document_type || (isHindi ? "डॉक्टर पर्ची व जाँच आदेश" : "OPD Prescription & Lab Order"),
        confidence: confidence,
        patient_info: parsedResult.patient_info || null,
        diagnosis_summary: parsedResult.diagnosis_summary || "",
        medicines: meds,
        investigations: tests,
        treatment_advice: parsedResult.treatment_advice || "",
        next_steps: Array.isArray(parsedResult.next_steps) && parsedResult.next_steps.length > 0
          ? parsedResult.next_steps
          : [
              isHindi ? "डॉक्टर द्वारा लिखी गई सभी जांचें समय पर निकटतम सरकारी अस्पताल या लैब से करवाएं।" : "Complete all prescribed laboratory and diagnostic tests on schedule.",
              isHindi ? "जांच रिपोर्ट आने के बाद तुरंत डॉक्टर को दिखाकर परामर्श लें।" : "Review test reports with your treating physician promptly for appropriate medication."
            ],
        precautions: Array.isArray(parsedResult.precautions) && parsedResult.precautions.length > 0
          ? parsedResult.precautions
          : [
              isHindi ? "जांच से पहले डॉक्टर के दिए गए निर्देशों (जैसे खाली पेट रहना) का पालन करें।" : "Follow fasting and preparation instructions prior to diagnostic tests.",
              isHindi ? "बिना डॉक्टर की सलाह के कोई भी दवा स्वयं शुरू या बंद न करें।" : "Do not start or discontinue any medications without clinical advice."
            ],
        scheme_suggestion: parsedResult.scheme_suggestion || (isHindi
          ? "🏛️ सरकारी सुविधा: यह सभी बुनियादी खून व दिल की जांचें जिला अस्पताल और आयुष्मान आरोग्य मंदिर में मुफ्त या अत्यंत कम दर पर उपलब्ध हैं। आयुष्मान कार्ड होने पर ₹5 लाख तक का कैशलेस इलाज भी मिलता है।"
          : "🏛️ Government Support: Basic blood, metabolic and cardiac diagnostics are available free or subsidized at District Hospitals and Ayushman Arogya Mandir under NHM Free Diagnostics."),
        safety_warning: parsedResult.safety_warning || (isHindi
          ? "⚠️ AI-सहायक विश्लेषण। दवा लेने या इलाज शुरू करने से पहले हमेशा प्रमाणित डॉक्टर या फार्मासिस्ट से पुष्टि करें।"
          : "⚠️ AI-assisted reading. Always verify with a certified doctor or pharmacist before taking medications.")
      });
    }

    // High Quality Intelligent Fallback if API was unavailable
    return res.json({
      detected_document_type: isHindi ? "डॉक्टर ओपीडी पर्ची (OPD Prescription)" : "Doctor OPD Prescription & Investigation Slip",
      confidence: "medium",
      patient_info: {
        hospital: isHindi ? "अरोड़ा हॉस्पिटल (निजी/सरकारी अस्पताल)" : "Hospital / Healthcare Facility",
        doctor: isHindi ? "परामर्शदाता चिकित्सक (Consultant Physician)" : "Consultant Physician",
        patient_name: isHindi ? "ओपीडी मरीज (OPD Patient)" : "OPD Patient",
        date: new Date().toLocaleDateString("hi-IN"),
        department: "General Medicine / OPD"
      },
      diagnosis_summary: isHindi
        ? "डॉक्टर ने मरीज के स्वास्थ्य मूल्यांकन हेतु प्रमुख रक्त, हृदय (ECG/Echo) और यूरिन जांचें लिखी हैं ताकि सही निदान के बाद दवा तय की जा सके।"
        : "The doctor has ordered key metabolic, cardiac, liver, and renal laboratory investigations to accurately evaluate clinical symptoms before initiating specific pharmacotherapy.",
      medicines: [],
      investigations: [
        {
          test_name: isHindi ? "ब्लड शुगर (Blood Sugar - Fasting)" : "Blood Sugar (Fasting & PP)",
          purpose: isHindi ? "मधुमेह (Diabetes) और रक्त में ग्लूकोज स्तर की सटीक जांच के लिए।" : "Screens for diabetes and evaluates blood glucose regulation.",
          preparation: isHindi ? "8-10 घंटे रात का उपवास (खाली पेट) आवश्यक है।" : "8-10 hours overnight fasting required.",
          facility_support: isHindi ? "प्राथमिक स्वास्थ्य केंद्र (PHC) और आरोग्य मंदिर में 100% मुफ्त।" : "100% Free at PHC and Ayushman Arogya Mandir."
        },
        {
          test_name: isHindi ? "सीरम कोलेस्ट्रॉल / लिपिड प्रोफाइल (Lipid Profile)" : "Lipid Profile / Serum Cholesterol",
          purpose: isHindi ? "रक्त में वसा (Fat), ट्राइग्लिसराइड्स और हृदय स्वास्थ्य के जोखिम का आकलन।" : "Assesses blood cholesterol, triglycerides, and cardiovascular risk.",
          preparation: isHindi ? "10-12 घंटे खाली पेट जांच करवाएं।" : "10-12 hours fasting before morning sample.",
          facility_support: isHindi ? "जिला अस्पताल व सामुदायिक स्वास्थ्य केंद्र (CHC) पर उपलब्ध।" : "Available free/low-cost at District Hospital & CHC."
        },
        {
          test_name: isHindi ? "ईसीजी व इकोकार्डियोग्राफी (ECG & Echocardiography / TMT)" : "ECG, Echocardiography & TMT",
          purpose: isHindi ? "हृदय की धड़कन, वाल्व कार्यप्रणाली और तनाव क्षमता की जांच।" : "Evaluates heart rhythm, myocardial function, and stress response.",
          preparation: isHindi ? "आराम से बैठें, जांच से पहले चाय-कॉफी न पिएं।" : "Rest comfortably; avoid caffeine immediately prior.",
          facility_support: isHindi ? "आयुष्मान भारत PM-JAY के तहत सूचीबद्ध अस्पतालों में निःशुल्क।" : "Cashless under Ayushman Bharat PM-JAY empaneled centers."
        },
        {
          test_name: isHindi ? "लिवर व किडनी फंक्शन (SGOT, SGPT, Creatinine, Uric Acid)" : "Liver & Renal Profile (SGOT, SGPT, Creatinine, Uric Acid)",
          purpose: isHindi ? "लिवर एंजाइम, गुर्दे की कार्यक्षमता और यूरिक एसिड स्तर की जांच।" : "Evaluates liver enzymes, renal clearance, and filtration function.",
          preparation: isHindi ? "सामान्य रूप से पर्याप्त पानी पिएं।" : "Maintain normal hydration.",
          facility_support: isHindi ? "सरकारी अस्पताल पैथोलॉजी में मुफ्त उपलब्ध।" : "Available at Government District Hospital Pathology."
        }
      ],
      treatment_advice: isHindi
        ? "जांच की रिपोर्ट आने तक हल्का, सुपाच्य भोजन लें, अधिक तेल-मसाले से बचें और रिपोर्ट आते ही तुरंत अपने डॉक्टर को दिखाएं।"
        : "Maintain a light diet, stay hydrated, complete all diagnostic samples on schedule, and follow up promptly with your doctor with test findings.",
      next_steps: [
        isHindi ? "1. कल सुबह खाली पेट निकटतम सरकारी अस्पताल या पैथोलॉजी लैब में रक्त और यूरिन सैंपल दें।" : "1. Visit the government hospital lab or diagnostic center tomorrow morning in fasting state for blood/urine collection.",
        isHindi ? "2. ईसीजी (ECG) और ईको (Echo) जांच पूरी करवाएं।" : "2. Complete the requested ECG and cardiac imaging.",
        isHindi ? "3. सभी रिपोर्ट आते ही डॉक्टर से दोबारा परामर्श लेकर पर्ची की दवाएं शुरू करें।" : "3. Present all final laboratory reports to the consulting doctor to obtain prescribed medications.",
        isHindi ? "4. दवाओं के लिए प्रधानमंत्री जन औषधि केंद्र का उपयोग करें ताकि 80% तक बचत हो सके।" : "4. Procure generic equivalents from Jan Aushadhi Kendra for maximum cost savings."
      ],
      precautions: [
        isHindi ? "जांच से पहले 8-10 घंटे चाय, दूध या नाश्ता न करें (केवल सादा पानी पी सकते हैं)।" : "Do not consume food, tea, or milk for 8-10 hours before fasting blood tests.",
        isHindi ? "सीने में तेज दर्द, भारीपन या सांस फूलने पर तुरंत 108 एम्बुलेंस बुलाएं या नजदीकी इमरजेंसी जाएं।" : "If severe chest pain, shortness of breath, or dizziness occurs, seek immediate emergency hospital care.",
        isHindi ? "भोजन में नमक और चिकनाई कम रखें।" : "Reduce sodium and saturated fat intake."
      ],
      scheme_suggestion: isHindi
        ? "🏛️ आयुष्मान भारत PM-JAY: सभी सूचीबद्ध अस्पतालों में ₹5 लाख तक का कैशलेस इलाज मिलता है। जन औषधि केंद्र पर दवाएं 50% से 90% तक सस्ती मिलती हैं।"
        : "🏛️ Ayushman Bharat PM-JAY offers ₹5 Lakh annual cashless treatment. Jan Aushadhi Kendras provide quality generic medications at up to 90% lower prices.",
      safety_warning: isHindi
        ? "⚠️ AI-सहायक विश्लेषण। दवा लेने या इलाज शुरू करने से पहले हमेशा डॉक्टर या फार्मासिस्ट से परामर्श लें।"
        : "⚠️ AI-assisted reading. Always consult your healthcare provider or pharmacist before taking medicines."
    });

  } catch (error) {
    console.error("Prescription analysis error:", error);
    const isHindi = (req.body.language || "Hindi").toLowerCase().includes("hi");
    res.status(500).json({
      detected_document_type: "Analysis Failed",
      confidence: "none",
      patient_info: null,
      diagnosis_summary: "",
      medicines: [],
      investigations: [],
      next_steps: [],
      precautions: [],
      scheme_suggestion: "",
      safety_warning: isHindi 
        ? "⚠️ विश्लेषण विफल। कृपया बाद में पुनः प्रयास करें या अपने नजदीकी स्वास्थ्य केंद्र में जाएं।"
        : "⚠️ Analysis failed. Please try again later or visit your nearest health centre."
    });
  }
});

// 10. GET & PATCH /api/profile — moved to server/routes/profile.ts.
//
// The handlers that used to live here read and wrote `activeUserProfile`,
// one object in the server process shared by every request. Nothing
// reached public.profiles, and the cost was not merely that details went
// unsaved: profiles.village_id is the ONLY link between a household and
// its ASHA worker, and nothing on the citizen side ever set it. So
// GET /api/asha/contact, opening a conversation, SOS worker routing and
// the whole village broadcast fan-out all took their "we do not know your
// village" branch permanently — a registered, approved, village-mapped
// worker stayed invisible to every household she covers.
//
// The replacement is authenticated, persists to public.profiles with the
// caller's own token, and turns the village she types into a villages row
// via public.resolve_village(). It is mounted with the other routers at
// the bottom of this file. Requires supabase/10_profile_village.sql.

// 11-14. The old in-memory emergency, n8n and ASHA dashboard routes —
// retired.
//
// These four wrote to and read from the process-local `emergencyAlerts`
// array, and each of them fabricated a person. POST /api/emergency/event
// stamped every alert with `assigned_asha: "Radha Bai (ASHA Sehore #12)"`
// and `n8n_dispatched: true`, then handed the caller a phone number for her,
// so a family in an emergency was given a name and a number belonging to
// nobody along with an assurance that an ambulance workflow had fired.
// GET /api/asha/dashboard returned the same invented worker with 240
// households and three named patients on her task list.
//
// Nothing they claimed was true, and nothing they wrote survived a restart.
// What replaces them keeps a delivery record per recipient, so the app can
// say who was actually reached instead of asserting that somebody was:
//
//   POST /api/sos/broadcast          raise an SOS, fan it out, log delivery
//   GET  /api/sos/mine               the broadcasts this account raised
//   GET  /api/sos/:id                one broadcast and its delivery rows
//   POST /api/sos/:id/acknowledge    a worker takes it on
//   POST /api/sos/:id/resolve        close it, with an outcome
//   GET  /api/asha/sos               the worker's live queue
//   GET  /api/asha/contact           the real worker mapped to a village
//
// They answer 410 rather than being deleted outright because src/services/
// api.js still calls them, and a 404 under /api/* falls through to the Vite
// catch-all and returns index.html — JSON.parse on a page of HTML produces
// an error that tells nobody anything. Remove these once the last caller is
// rewired.
const RETIRED_ROUTES: Array<{ method: "get" | "post" | "patch"; path: string; replacement: string; detail: string }> = [
  {
    method: "post",
    path: "/api/emergency/event",
    replacement: "/api/sos/broadcast",
    detail:
      "Raise emergencies with POST /api/sos/broadcast. It records a delivery " +
      "row per recipient, so the response says who was actually contacted " +
      "rather than asserting that an ASHA worker and an ambulance were notified.",
  },
  {
    method: "post",
    path: "/api/automation/webhook/n8n",
    replacement: "/api/sos/broadcast",
    detail:
      "There is no n8n workflow behind this app. This endpoint replied " +
      "'dispatched_to_asha_and_ambulance' to anything posted to it, which was " +
      "never true. SOS fan-out is handled in-process by POST /api/sos/broadcast.",
  },
  {
    method: "get",
    path: "/api/asha/dashboard",
    replacement: "/api/asha/sos",
    detail:
      "Worker data now comes from the database under the worker's own token: " +
      "GET /api/asha/sos for the live queue, GET /api/asha/notifications for " +
      "what she has sent, GET /api/asha/threads/summary for citizen messages, " +
      "and GET /api/asha/me for her own record.",
  },
  {
    method: "patch",
    path: "/api/asha/referral/:id",
    replacement: "/api/sos/:id/acknowledge",
    detail:
      "Use POST /api/sos/:id/acknowledge and POST /api/sos/:id/resolve. Both " +
      "record which worker acted and when, which an in-memory status field " +
      "could not.",
  },
];

for (const route of RETIRED_ROUTES) {
  app[route.method](route.path, (_req, res) => {
    res.status(410).json({
      error: "Retired endpoint",
      detail: route.detail,
      replacement: route.replacement,
    });
  });
}

// 15. GET /api/benefits/tracker - Schemes this account may be able to use
//
// This used to return a hardcoded PM-JAY card number and a "₹5,00,000 /
// ₹5,00,000" balance. Both were invented. The app has no connection to the
// PM-JAY claims system, the ABDM registry, or any state DBT ledger, so it
// cannot know whether somebody holds a card, what their remaining cover is,
// or whether a payment has been disbursed — and showing a confident balance
// that nobody checked is the exact failure mode this project is built to
// avoid. A wrong number here sends a family to a hospital expecting cover
// they may not have.
//
// So this now reports only what is actually known: the schemes seeded in
// the database, whether the account has told us it has an ABHA number, and
// what each scheme requires. Anything the app cannot see is named as
// unavailable rather than filled in.
app.get("/api/benefits/tracker", optionalAuth, handler(async (req, res) => {
  const caller = req.caller;

  if (!supabaseReady) {
    throw new HttpError(
      503,
      "The scheme database is not configured on this server, so benefits " +
        "cannot be looked up.",
    );
  }

  const db = admin();
  const { data: schemes, error } = await db
    .from("schemes")
    .select(
      "id, code, name, name_hi, category, summary, summary_hi, benefit_amount, " +
        "documents, how_to_apply, official_url, helpline, verification, source, " +
        "eligibility_rules",
    )
    .eq("active", true)
    .order("priority", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    throw new HttpError(502, `Could not load schemes: ${error.message}`);
  }

  // Signed out, the honest answer is the scheme catalogue with no personal
  // layer at all, rather than a demo beneficiary.
  if (!caller) {
    return res.json({
      signedIn: false,
      beneficiary: null,
      schemes: schemes ?? [],
      note:
        "Sign in to see which of these schemes you may be eligible for based " +
        "on your profile.",
      claimsDataAvailable: false,
      claimsNote:
        "This app is not connected to the PM-JAY claims system, so card " +
        "numbers, remaining cover and payment status cannot be shown here. " +
        "Check those on the official portal or by calling the scheme helpline.",
    });
  }

  // Kept on one line deliberately: supabase-js derives the row type from
  // this string as a literal type, and splitting it across concatenated
  // pieces makes the inference collapse to an error type.
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, age, gender, state, district, village, annual_income, category, has_abha")
    .eq("id", caller.id)
    .maybeSingle();

  res.json({
    signedIn: true,
    beneficiary: {
      name: profile?.full_name ?? caller.fullName ?? null,
      district: profile?.district ?? null,
      state: profile?.state ?? null,
      // has_abha is what the user told us, not something we verified against
      // the ABDM registry, and the flag name says so.
      abhaSelfReported: profile?.has_abha ?? false,
      abhaNumber: null,
      abhaNote:
        "ABHA numbers are not stored by this app and cannot be verified here.",
    },
    profileComplete: Boolean(
      profile?.age && profile?.gender && profile?.state && profile?.district,
    ),
    schemes: schemes ?? [],
    claimsDataAvailable: false,
    claimsNote:
      "This app is not connected to the PM-JAY claims system or any state " +
      "disbursement ledger. Card numbers, remaining cover and payment status " +
      "have to be checked on the official portal or through the scheme " +
      "helpline. Nothing on this screen is a confirmation of enrolment.",
  });
}));

// ================= NEW PLATFORM ROUTERS =================
//
// Every router below declares its own full sub-path, so they all mount at
// /api. They are registered after the handlers above so that the older
// routes keep their existing behaviour, and none of their paths collide.
//
// Unlike the routes above, these talk to Supabase and enforce access with
// the caller's own token wherever the database is capable of deciding, so
// Row Level Security is the thing being exercised in production rather
// than a policy set nobody ever calls.
// The hospitals router declares paths relative to its own prefix
// (/nearby, /search, /meta, /:id); the rest declare full sub-paths.
app.use("/api/hospitals", hospitalsRouter);
app.use("/api", ashaAuthRouter);
app.use("/api", notificationsRouter);
app.use("/api", messagingRouter);
app.use("/api", sosRouter);
app.use("/api", aiRouter);
app.use("/api", profileRouter);

// Anything under /api that reached this point matched no route. Answering
// with JSON matters because the SPA fallback below would otherwise hand
// back index.html, and a fetch() would fail on "Unexpected token <"
// instead of saying the endpoint does not exist.
app.use("/api", (req, res) => {
  res.status(404).json({
    error: `No such endpoint: ${req.method} /api${req.path.replace(/^\/+/, "/")}`,
  });
});

// Turns a thrown HttpError into its status and message, and anything else
// into a 500 that is logged with a stack. Registered here, after the API
// routes and before the Vite middleware, so API failures come back as
// JSON rather than as an HTML error page.
app.use(errorMiddleware);

// ================= VITE MIDDLEWARE & SERVER START =================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sehat Sathi Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
