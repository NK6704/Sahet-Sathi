import { Router } from "express";
import { HttpError, handler } from "../lib/auth";
import { admin } from "../lib/supabaseAdmin";

/* =====================================================================
   Hospitals — the PM-JAY empanelment registry, and only that.

   Every row behind these four routes comes from one scrape of the
   National Health Authority's hospital empanelment search: 39,526 source
   records, about 38,948 after de-duplication, of which 20,390 are
   government, roughly 18,548 private and 10 public-private. That
   provenance decides what this API is allowed to claim.

   It is an empanelment list, not a directory of hospitals in India. A
   perfectly good hospital two streets away may be absent simply because
   it was never empanelled under PM-JAY, and one that has been
   de-empanelled is inactive and drops out of here entirely. An empty
   result therefore means "not in this registry", never "no hospital near
   you", and the notes below say so in words rather than leaving the UI to
   imply the stronger claim.

   The source publishes no city and no pincode: both columns are null in
   all 39,526 rows. That is a property of the dataset rather than a bug to
   be worked around, so /search refuses a `pincode` or `city` parameter
   with an explanation instead of quietly ignoring it or reverse-guessing
   one from coordinates. District names come from a separate NHA endpoint
   that is usually unreachable at import time, so `district_name` is very
   likely null throughout; wherever it is null the response omits the key
   altogether, because an empty string or a bare numeric code is something
   a UI will eventually render.

   Distance is the one number here somebody might act on at two in the
   morning, so it is fenced off. Only the roughly 37,443 rows whose
   coordinate parsed and fell inside India carry geo_usable and only those
   can appear in /nearby; `distanceKm` is returned by /nearby and by
   nothing else, since anywhere else it would be a fabrication; and a
   radius is never widened on the caller's behalf, because a person
   reading "nearest hospital" has to be able to trust the number.

   One note on the Supabase client. These handlers read through the
   service-role client from admin() even though nothing they touch is
   private. Hospital rows are public reference data — the hospitals_read
   policy lets `anon` select every active row and hospitals_nearby is
   granted to anon — so a plain anon-key client would be the honest
   choice and no user scoping is being bypassed by using the service role
   in its place. There is simply no anon client helper on this server, and
   asUser() needs a bearer token that a public hospital search does not
   have. Because the service role really does bypass RLS, the `active`
   filter the policy would have applied is stated explicitly in every
   query below; forgetting it would surface de-empanelled hospitals, which
   is precisely where somebody holding an Ayushman card must not be sent.
   ===================================================================== */

export const hospitalsRouter = Router();

// ---------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------

/**
 * Copied from the default on hospitals.source deliberately. The
 * top-level `source` on a response and the `source` on each hospital
 * inside it should be the same sentence, because the UI will print
 * whichever one it happens to have to hand.
 */
const REGISTRY_SOURCE =
  "National Health Authority — PMJAY empanelled hospital registry";

/**
 * The same bounding box the importer used to decide geo_usable. A
 * coordinate outside it cannot match a single row, so rejecting it up
 * front lets the error name the real problem instead of returning an
 * empty list that reads as "there is no hospital near you".
 */
const INDIA_BOUNDS = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };

const TYPE_LABELS: Record<string, string> = {
  G: "Government",
  P: "Private",
  PP: "Public-private",
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/**
 * city and pincode are missing from both column lists on purpose. They
 * are null in every row, and selecting them would only tempt a template
 * into rendering an empty address line.
 */
const LIST_COLUMNS = [
  "id",
  "facility_id",
  "name",
  "address",
  "phone",
  "mobile",
  "type_code",
  "ownership_sub_type",
  "facility_type",
  "speciality_codes",
  "state_code",
  "state_name",
  "district_code",
  "district_name",
  "latitude",
  "longitude",
  "geo_usable",
  "nabh_accredited",
  "verification",
  "source",
  "source_url",
  "contact_verified",
].join(", ");

const DETAIL_COLUMNS = [
  LIST_COLUMNS,
  "hospital_id",
  "hfr_id",
  "email",
  "website",
  "scheme_code",
  "empanelment_status",
  "empaneled_date",
  "establishment_year",
  "nodal_officer_name",
  "nodal_officer_phone",
  "verified_at",
  "imported_at",
].join(", ");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The placeholder the importer writes when the NHA district list was
 * unreachable, so a district row reading 'District 271' can be flagged as
 * a code in disguise rather than offered as a real name.
 */
const DISTRICT_PLACEHOLDER_PREFIX = "District ";

// ---------------------------------------------------------------------
// Query-string reading
//
// Express hands back an array when a parameter is repeated and a nested
// object when it is bracketed, so every read goes through firstValue()
// rather than String(), which would happily produce "[object Object]"
// and search for it.
// ---------------------------------------------------------------------

function firstValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function numberParam(raw: unknown): number | null {
  const value = firstValue(raw);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * A bad radius or page size is rounded into range because the clamp was
 * always going to be lossy. A bad state or district code is a different
 * matter and rejected below: silently dropping it would run a much
 * broader search than the caller asked for and present the result as
 * theirs.
 */
function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = numberParam(raw);
  return clamp(Math.trunc(parsed ?? fallback), min, max);
}

function codeParam(raw: unknown, name: string): number | null {
  const value = firstValue(raw);
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new HttpError(
      400,
      `${name} must be one of the numeric codes listed by /api/hospitals/meta.`,
    );
  }
  return Number(value);
}

function typeParam(raw: unknown): string | null {
  const value = firstValue(raw);
  if (value === null) return null;
  const code = value.toUpperCase();
  // 'PP' is accepted alongside 'G' and 'P' because ten rows genuinely
  // carry it, and refusing the filter would misrepresent the data.
  if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, code)) {
    throw new HttpError(
      400,
      "type must be G for government, P for private or PP for public-private.",
    );
  }
  return code;
}

/**
 * PostgREST passes an ilike pattern into SQL unchanged, so a caller
 * typing a bare '%' would match all 39,000 rows and turn the filter that
 * /search insists on back into a full scan.
 */
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// ---------------------------------------------------------------------
// Turning a row into something a screen can show
// ---------------------------------------------------------------------

type Row = Record<string, any>;

async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ placeName: string | null; locality: string | null }> {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: { "User-Agent": "sehat-sathi/1.0" },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!res.ok) return { placeName: null, locality: null };

    const data = (await res.json()) as any;
    const addr = data?.address ?? {};

    return {
      placeName: data?.display_name ?? null,
      locality:
        addr.village ??
        addr.town ??
        addr.suburb ??
        addr.neighbourhood ??
        addr.county ??
        null,
    };
  } catch {
    return { placeName: null, locality: null };
  }
}

/**
 * The fields every source of hospital rows has in common, whether the
 * row came from the table or from the hospitals_nearby function.
 */
function baseHospital(row: Row): Record<string, unknown> {
  const typeCode: string | null = row.type_code ?? null;
  const hospital: Record<string, unknown> = {
    id: row.id,
    facilityId: row.facility_id,
    name: row.name,
    address: row.address ?? null,
    phone: row.phone ?? null,
    mobile: row.mobile ?? null,
    typeCode,
    ownershipSubType: row.ownership_sub_type ?? null,
    facilityType: row.facility_type ?? null,
    specialityCodes: row.speciality_codes ?? [],
    state: row.state_name ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    // An official listing, which is not the same claim as a dialled
    // number: contactVerified is what lets the UI label a phone number as
    // published rather than checked.
    verification: row.verification ?? null,
    source: row.source ?? REGISTRY_SOURCE,
    sourceUrl: row.source_url ?? null,
    contactVerified: row.contact_verified === true,
  };

  // A human label only when the code maps to one. An unrecognised code is
  // left as typeCode alone rather than shown as a guess.
  if (typeCode && TYPE_LABELS[typeCode]) hospital.type = TYPE_LABELS[typeCode];

  // The key is absent, not empty, when the registry has no district name.
  // Nothing renders what it cannot find.
  if (row.district_name) hospital.district = row.district_name;

  return hospital;
}

function listHospital(row: Row): Record<string, unknown> {
  return {
    ...baseHospital(row),
    stateCode: row.state_code ?? null,
    districtCode: row.district_code ?? null,
    // Whether a map pin is even possible for this row.
    geoUsable: row.geo_usable === true,
    nabhAccredited: row.nabh_accredited ?? null,
  };
}

function detailHospital(row: Row): Record<string, unknown> {
  return {
    ...listHospital(row),
    hospitalId: row.hospital_id ?? null,
    hfrId: row.hfr_id ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    schemeCode: row.scheme_code ?? null,
    empanelmentStatus: row.empanelment_status ?? null,
    empaneledDate: row.empaneled_date ?? null,
    establishmentYear: row.establishment_year ?? null,
    nodalOfficerName: row.nodal_officer_name ?? null,
    nodalOfficerPhone: row.nodal_officer_phone ?? null,
    verifiedAt: row.verified_at ?? null,
    importedAt: row.imported_at ?? null,
  };
}

/**
 * distanceKm is attached here and nowhere else, because it only means
 * anything relative to the coordinate the caller supplied.
 */
function nearbyHospital(row: Row): Record<string, unknown> {
  return {
    ...baseHospital(row),
    distanceKm: row.distance_km ?? null,
    placeName: row.place_name ?? null,
    locality: row.locality ?? null,
  };
}

async function enrichNearbyRows(rows: Row[]): Promise<Record<string, unknown>[]> {
  return Promise.all(
    rows.map(async (row) => {
      const lat = row.latitude ?? null;
      const lng = row.longitude ?? null;

      if (lat !== null && lng !== null) {
        const geo = await reverseGeocode(Number(lat), Number(lng));
        row.place_name = geo.placeName;
        row.locality = geo.locality;
      }

      return nearbyHospital(row);
    }),
  );
}

function rowsOf(
  result: { data: any[] | null; error: { message: string } | null },
  what: string,
): any[] {
  if (result.error) {
    throw new HttpError(502, `Could not read ${what}: ${result.error.message}`);
  }
  return result.data ?? [];
}

function countOf(
  result: { count: number | null; error: { message: string } | null },
  what: string,
): number {
  if (result.error) {
    throw new HttpError(502, `Could not count ${what}: ${result.error.message}`);
  }
  return result.count ?? 0;
}

// ---------------------------------------------------------------------
// GET /nearby
// ---------------------------------------------------------------------

hospitalsRouter.get(
  "/nearby",
  handler(async (req, res) => {
    const lat = numberParam(req.query.lat);
    const lng = numberParam(req.query.lng);

    if (lat === null || lng === null) {
      throw new HttpError(
        400,
        "lat and lng are both required, as decimal degrees.",
      );
    }
    if (
      lat < INDIA_BOUNDS.minLat ||
      lat > INDIA_BOUNDS.maxLat ||
      lng < INDIA_BOUNDS.minLng ||
      lng > INDIA_BOUNDS.maxLng
    ) {
      throw new HttpError(
        400,
        "That location looks to be outside India, and this registry only " +
          "covers hospitals empanelled under PM-JAY in India. Please search " +
          "by district instead.",
      );
    }

    const radiusKm = clamp(numberParam(req.query.radiusKm) ?? 15, 1, 100);
    const limit = boundedInt(req.query.limit, 20, 1, 50);
    const offset = Math.max(Math.trunc(numberParam(req.query.offset) ?? 0), 0);
    const typeCode = typeParam(req.query.type);
    const speciality = firstValue(req.query.speciality);

    // The function already restricts itself to active rows with a usable
    // coordinate, so the distance-sorted list cannot contain a hospital
    // that has been de-empanelled or one whose coordinate was rejected.
    const { data, error } = await admin().rpc("hospitals_nearby", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: radiusKm,
      p_type: typeCode,
      p_speciality: speciality,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      throw new HttpError(
        502,
        `The hospital registry could not be searched: ${error.message}`,
      );
    }

    const hospitals = await enrichNearbyRows((data ?? []) as Row[]);

    res.json({
      hospitals,
      count: hospitals.length,
      radiusKm,
      searchedAt: new Date().toISOString(),
      source: REGISTRY_SOURCE,
      // Zero results are a 200 with an empty array and this sentence.
      // Widening the radius here, or quietly searching a neighbouring
      // area, would make every distance shown afterwards untrustworthy.
      note:
        hospitals.length === 0
          ? emptyRadiusNote(radiusKm)
          : "Distances are straight-line from the location you gave, not road " +
            "distance, and only hospitals whose registry row carries a usable " +
            "coordinate can appear in this list.",
    });
  }),
);

/**
 * The nearest empanelled hospitals to a coordinate, for callers inside this
 * server rather than over HTTP.
 *
 * This exists so that the assistant can name hospitals without the model
 * inventing them, and without a second copy of the row mapping drifting out
 * of step with `GET /nearby`. The rows it returns are byte-identical in
 * shape to that endpoint's, so the same card component renders both.
 *
 * It resolves rather than throws. A hospital list is a helpful addition to
 * an answer about a scheme, not the answer itself, so a registry outage
 * should cost the user the list and a sentence explaining its absence — not
 * the health guidance they actually asked for.
 */
export async function nearestHospitals(
  lat: unknown,
  lng: unknown,
  limit = 3,
  radiusKm = 25,
): Promise<{ hospitals: Record<string, unknown>[]; note: string | null }> {
  const latitude = typeof lat === "number" ? lat : Number(lat);
  const longitude = typeof lng === "number" ? lng : Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      hospitals: [],
      note:
        "No location was shared, so no hospitals are listed here. Open Find " +
        "care and allow location to see the nearest empanelled hospitals.",
    };
  }

  if (
    latitude < INDIA_BOUNDS.minLat ||
    latitude > INDIA_BOUNDS.maxLat ||
    longitude < INDIA_BOUNDS.minLng ||
    longitude > INDIA_BOUNDS.maxLng
  ) {
    return {
      hospitals: [],
      note:
        "That location is outside India, and this registry covers only " +
        "hospitals empanelled under PM-JAY in India.",
    };
  }

  try {
    const { data, error } = await admin().rpc("hospitals_nearby", {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: clamp(radiusKm, 1, 100),
      p_type: null,
      p_speciality: null,
      p_limit: clamp(Math.trunc(limit), 1, 20),
      p_offset: 0,
    });

    if (error) {
      return {
        hospitals: [],
        note: `The hospital registry could not be reached just now (${error.message}), so no hospitals are listed here.`,
      };
    }

    const hospitals = await enrichNearbyRows((data ?? []) as Row[]);
    return {
      hospitals,
      note:
        hospitals.length === 0
          ? emptyRadiusNote(clamp(radiusKm, 1, 100))
          : `Nearest PM-JAY empanelled hospitals within ${clamp(radiusKm, 1, 100)} km, straight-line distance. Source: ${REGISTRY_SOURCE}.`,
    };
  } catch (err) {
    return {
      hospitals: [],
      note:
        "The hospital registry could not be reached just now, so no " +
        "hospitals are listed here.",
    };
  }
}

function emptyRadiusNote(radiusKm: number): string {
  const wider = Math.min(radiusKm * 2, 100);
  if (wider > radiusKm) {
    return (
      `No PM-JAY empanelled hospital is listed within ${radiusKm} km of that ` +
      `location. The search was not widened for you, so try ${wider} km, or ` +
      "search by district."
    );
  }
  return (
    `No PM-JAY empanelled hospital is listed within ${radiusKm} km of that ` +
    "location, and 100 km is the widest radius this search accepts. Please " +
    "search by district instead."
  );
}

// ---------------------------------------------------------------------
// GET /search
// ---------------------------------------------------------------------

hospitalsRouter.get(
  "/search",
  handler(async (req, res) => {
    // Answered before anything else, because the honest refusal is more
    // useful than a search that appears to accept the parameter and then
    // ignores it.
    if (req.query.pincode !== undefined || req.query.city !== undefined) {
      throw new HttpError(
        400,
        "The National Health Authority registry publishes no pincode and no " +
          "city for these facilities, so this app cannot search by them. " +
          "Please search by district, or by your location.",
      );
    }

    const q = firstValue(req.query.q);
    const stateCode = codeParam(req.query.stateCode, "stateCode");
    const districtCode = codeParam(req.query.districtCode, "districtCode");

    if (q === null && stateCode === null && districtCode === null) {
      throw new HttpError(
        400,
        "Please give at least one of q, stateCode or districtCode. Returning " +
          "close to 39,000 hospitals in name order is not a search.",
      );
    }

    const typeCode = typeParam(req.query.type);
    const speciality = firstValue(req.query.speciality);
    const page = Math.max(Math.trunc(numberParam(req.query.page) ?? 1), 1);
    const size = boundedInt(req.query.size, 20, 1, 50);
    const from = (page - 1) * size;

    let query = admin()
      .from("hospitals")
      .select(LIST_COLUMNS, { count: "exact" })
      // Stated rather than left to the hospitals_read policy, which the
      // service-role key does not go through. See the note at the top.
      .eq("active", true);

    if (q !== null) query = query.ilike("name", likeContains(q));
    if (stateCode !== null) query = query.eq("state_code", stateCode);
    if (districtCode !== null) query = query.eq("district_code", districtCode);
    if (typeCode !== null) query = query.eq("type_code", typeCode);
    if (speciality !== null) {
      query = query.contains("speciality_codes", [speciality]);
    }

    const result = await query
      .order("name", { ascending: true })
      .range(from, from + size - 1);

    const hospitals = rowsOf(result, "the hospital registry").map(listHospital);
    const count = countOf(result, "matching hospitals");

    res.json({
      hospitals,
      count,
      page,
      size,
      pageCount: Math.max(Math.ceil(count / size), 1),
      source: REGISTRY_SOURCE,
      ...(count === 0
        ? {
            note:
              "Nothing in the registry matches those filters. This list covers " +
              "hospitals empanelled under PM-JAY only, so a hospital that " +
              "exists may simply not be in it.",
          }
        : {}),
    });
  }),
);

// ---------------------------------------------------------------------
// GET /meta
//
// Filters and an honest account of what the registry does and does not
// contain, cached in module scope because the answer changes only when
// the importer runs again.
// ---------------------------------------------------------------------

const META_TTL_MS = 5 * 60 * 1000;

/**
 * Districts are listed in full only below this many rows, so that a
 * future import which brings every district in the country cannot turn
 * one meta call into a very large payload.
 */
const DISTRICT_LIST_CEILING = 1000;

const metaCache = new Map<string, { at: number; payload: Record<string, unknown> }>();

hospitalsRouter.get(
  "/meta",
  handler(async (req, res) => {
    const stateCode = codeParam(req.query.stateCode, "stateCode");
    const cacheKey = stateCode === null ? "all" : String(stateCode);

    const cached = metaCache.get(cacheKey);
    if (cached && Date.now() - cached.at < META_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    const payload = await buildMeta(stateCode);
    metaCache.set(cacheKey, { at: Date.now(), payload });
    res.json(payload);
  }),
);

async function buildMeta(stateCode: number | null): Promise<Record<string, unknown>> {
  const db = admin();
  const activeHospitals = () =>
    db.from("hospitals").select("id", { count: "exact", head: true }).eq("active", true);

  const [
    statesResult,
    specialitiesResult,
    districtTotal,
    total,
    withCoordinates,
    government,
    privateCount,
    publicPrivate,
    realDistrictNames,
  ] = await Promise.all([
    db.from("ref_states").select("code, name, short_code").order("name", { ascending: true }),
    db
      .from("ref_specialities")
      .select("code, name, short_code, sort_order")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    db.from("ref_districts").select("code", { count: "exact", head: true }),
    activeHospitals(),
    activeHospitals().eq("geo_usable", true),
    activeHospitals().eq("type_code", "G"),
    activeHospitals().eq("type_code", "P"),
    activeHospitals().eq("type_code", "PP"),
    // A district row still named 'District 271' is a numeric code wearing
    // a name, so the count of rows that escaped the placeholder is what
    // tells the UI whether a district label can be shown at all.
    db
      .from("ref_districts")
      .select("code", { count: "exact", head: true })
      .not("name", "like", `${DISTRICT_PLACEHOLDER_PREFIX}%`),
  ]);

  const districtCount = countOf(districtTotal, "districts");
  const districtsListable =
    stateCode !== null || districtCount < DISTRICT_LIST_CEILING;

  let districtRows: any[] = [];
  if (districtsListable) {
    let districtQuery = db
      .from("ref_districts")
      .select("code, state_code, name")
      .order("name", { ascending: true });
    if (stateCode !== null) districtQuery = districtQuery.eq("state_code", stateCode);
    districtRows = rowsOf(await districtQuery, "the district list");
  }

  const activeTotal = countOf(total, "active hospitals");
  const geoUsable = countOf(withCoordinates, "hospitals with a usable coordinate");

  return {
    states: rowsOf(statesResult, "the state list").map((row) => ({
      code: row.code,
      name: row.name,
      shortCode: row.short_code ?? null,
    })),

    districts: districtRows.map((row) => ({
      code: row.code,
      stateCode: row.state_code,
      name: row.name,
      // True when this is the importer's stand-in rather than a name the
      // NHA supplied, so a dropdown can mark it or sort it last.
      placeholder: String(row.name ?? "").startsWith(DISTRICT_PLACEHOLDER_PREFIX),
    })),

    specialities: rowsOf(specialitiesResult, "the speciality list").map((row) => ({
      code: row.code,
      name: row.name,
      shortCode: row.short_code ?? null,
      sortOrder: row.sort_order ?? null,
    })),

    coverage: {
      countedAt: new Date().toISOString(),
      totalActiveHospitals: activeTotal,
      withUsableCoordinates: geoUsable,
      // The gap matters on screen: these hospitals are findable by name
      // and district but can never appear in a distance search.
      withoutUsableCoordinates: Math.max(activeTotal - geoUsable, 0),
      government: countOf(government, "government hospitals"),
      private: countOf(privateCount, "private hospitals"),
      publicPrivate: countOf(publicPrivate, "public-private hospitals"),
      districtCount,
      // False when the whole district list is still placeholders, which is
      // the usual outcome because the NHA district-name endpoint is rarely
      // reachable at import time.
      districtNamesAvailable: countOf(realDistrictNames, "named districts") > 0,
      // Always false, and stated rather than omitted so the UI has
      // something explicit to key a disabled search box off. city and
      // pincode are null in all 39,526 source rows.
      pincodeSearchAvailable: false,
      // True only when the district list was withheld for size and the
      // caller has to pass stateCode to get one.
      districtListNeedsState: !districtsListable,
      source: REGISTRY_SOURCE,
    },
  };
}

// ---------------------------------------------------------------------
// GET /:id
//
// Declared last so that /nearby, /search and /meta are matched as routes
// rather than swallowed as identifiers.
// ---------------------------------------------------------------------

hospitalsRouter.get(
  "/:id",
  handler(async (req, res) => {
    const identifier = String(req.params.id ?? "").trim();
    if (identifier === "") {
      throw new HttpError(400, "Give a hospital id or a facility id.");
    }

    const lookup = admin().from("hospitals").select(DETAIL_COLUMNS).eq("active", true);

    // A uuid is our own primary key; anything else is treated as the NHA
    // facility code, which the source issues in upper case
    // ('HOSP27P26277430'), so a lower-case link still resolves.
    const { data, error } = await (UUID_PATTERN.test(identifier)
      ? lookup.eq("id", identifier)
      : lookup.eq("facility_id", identifier.toUpperCase())
    ).maybeSingle();

    if (error) {
      throw new HttpError(
        502,
        `Could not read the hospital registry: ${error.message}`,
      );
    }
    if (!data) {
      throw new HttpError(
        404,
        `No empanelled hospital in the registry matches "${identifier}". A ` +
          "hospital that has been de-empanelled is removed from this list, so " +
          "a link that worked before can legitimately stop resolving.",
      );
    }

    res.json({ hospital: detailHospital(data as Row), source: REGISTRY_SOURCE });
  }),
);
