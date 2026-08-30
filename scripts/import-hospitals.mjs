#!/usr/bin/env node
// =====================================================================
// Import the National Health Authority PMJAY empanelled hospital
// registry (the nha_scraper export) into public.hospitals, plus the
// ref_states / ref_districts / ref_specialities lookups it depends on.
//
// Run from the repo root:
//
//   node scripts/import-hospitals.mjs --dry-run
//   node scripts/import-hospitals.mjs
//   node scripts/import-hospitals.mjs --limit 500 --file ../hospitals.json
//   node scripts/import-hospitals.mjs --skip-districts
//
// Requires SUPABASE_URL (or VITE_SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY, read from .env.local, then .env, then the
// ambient environment. The service role key is needed because the
// hospitals table is written by no one but this importer and RLS gives
// anonymous callers read-only access.
//
// The import is idempotent: every row conflicts on facility_id, so
// re-running updates in place instead of duplicating the registry.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

const BATCH_SIZE = 500;
const MAX_ATTEMPTS = 3;              // one try plus two retries
const RETRY_BASE_MS = 750;
const PROGRESS_EVERY = 5000;
const FETCH_TIMEOUT_MS = 15000;

// The India bounding box used to decide whether a coordinate is usable.
// Deliberately generous: 6..38 north covers Indira Point to the top of
// Ladakh, 68..98 east covers Gujarat's western edge to Arunachal.
const INDIA_MIN_LAT = 6;
const INDIA_MAX_LAT = 38;
const INDIA_MIN_LNG = 68;
const INDIA_MAX_LNG = 98;

const NHA_DISTRICT_URL =
  'https://apisprod.nha.gov.in/pmjay/prodump/ump/ump/fetch/districtlist';

// Copied from nha_scraper/scraper.py, which is the only place these have
// been observed to work. 'Bearer undefined' is not a mistake: the public
// search front end sends exactly that string.
const NHA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json; charset=UTF-8',
  Origin: 'https://hem.nha.gov.in',
  Referer: 'https://hem.nha.gov.in/',
  Authorization: 'Bearer undefined',
};

// The 2011 census / LGD state codes, verified against the stateCode
// values present in this export. This map is hardcoded rather than
// fetched because the state list endpoint lives on the same frequently
// blocked host as the district list, and a hospital with no state name
// is a materially worse result than one with a name we can vouch for.
// A code missing from this map gets a 'State <code>' placeholder and a
// warning; it never gets a guessed name.
const STATE_NAMES = new Map([
  [1, 'Jammu & Kashmir'],
  [2, 'Himachal Pradesh'],
  [3, 'Punjab'],
  [4, 'Chandigarh'],
  [5, 'Uttarakhand'],
  [6, 'Haryana'],
  [7, 'Delhi'],
  [8, 'Rajasthan'],
  [9, 'Uttar Pradesh'],
  [10, 'Bihar'],
  [11, 'Sikkim'],
  [12, 'Arunachal Pradesh'],
  [13, 'Nagaland'],
  [14, 'Manipur'],
  [15, 'Mizoram'],
  [16, 'Tripura'],
  [17, 'Meghalaya'],
  [18, 'Assam'],
  [19, 'West Bengal'],
  [20, 'Jharkhand'],
  [21, 'Odisha'],
  [22, 'Chhattisgarh'],
  [23, 'Madhya Pradesh'],
  [24, 'Gujarat'],
  [25, 'Daman & Diu'],
  [26, 'Dadra & Nagar Haveli'],
  [27, 'Maharashtra'],
  [28, 'Andhra Pradesh'],
  [29, 'Karnataka'],
  [30, 'Goa'],
  [31, 'Lakshadweep'],
  [32, 'Kerala'],
  [33, 'Tamil Nadu'],
  [34, 'Puducherry'],
  [35, 'Andaman & Nicobar Islands'],
  [36, 'Telangana'],
  [37, 'Ladakh'],
  [38, 'Other Territory'],
]);

// The NHA speciality list has 74 entries and we have confirmed names for
// three of them (from the scraper's documented /specialities response).
// Every other code that appears in the data is inserted as a
// 'Speciality <code>' placeholder. Naming a medical speciality wrongly
// would put false clinical information in front of a patient, so the
// placeholder stays until the real list can be fetched.
const KNOWN_SPECIALITIES = new Map([
  ['100001', { name: 'Burns Management', short_code: 'BM', sort_order: 1 }],
  ['100002', { name: 'Cancer (Oncology)', short_code: 'CA', sort_order: 2 }],
  ['100005', { name: 'General Surgery', short_code: 'GS', sort_order: 5 }],
]);

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function usage() {
  console.log(`
Usage: node scripts/import-hospitals.mjs [options]

  --file <path>      Source JSON array (default: first hospitals.json found
                     next to the repo or in ./data)
  --limit N          Import only the first N records
  --dry-run          Parse and report, write nothing
  --skip-districts   Do not attempt the NHA district-name lookup
  -h, --help         Show this message
`);
}

function parseArgs(argv) {
  const opts = { file: null, limit: null, dryRun: false, skipDistricts: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, null];

    const next = () => {
      const value = inlineValue ?? argv[i + 1];
      if (inlineValue === null) i += 1;
      return value;
    };

    switch (flag) {
      case '--file':
        opts.file = next();
        break;
      case '--limit': {
        const raw = next();
        opts.limit = Number.parseInt(raw, 10);
        if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
          console.error(`--limit needs a positive integer, got "${raw}"`);
          process.exit(1);
        }
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--skip-districts':
        opts.skipDistricts = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        usage();
        process.exit(1);
    }
  }

  return opts;
}

function resolveSourceFile(explicit) {
  if (explicit) {
    const resolved = path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(resolved)) {
      console.error(`Source file not found: ${resolved}`);
      process.exit(1);
    }
    return resolved;
  }

  const candidates = [
    path.join(REPO_ROOT, 'data', 'hospitals.json'),
    path.join(REPO_ROOT, 'hospitals.json'),
    path.resolve(REPO_ROOT, '..', 'nha_scraper (2)', 'nha_scraper', 'hospitals.json'),
    path.resolve(REPO_ROOT, '..', 'nha_scraper', 'hospitals.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  console.error('Could not find hospitals.json. Pass --file <path>. Looked in:');
  for (const candidate of candidates) console.error(`  ${candidate}`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------

// The export uses at least four different ways of saying "no value":
// JSON null, the empty string, the literal "NA" (very common in
// createdDate / updatedDate) and the literal "null". Everything that
// reaches the database goes through here so that one of those spellings
// cannot leak into the UI as a visible "NA".
const NULLISH_STRINGS = new Set(['', 'na', 'n/a', 'null', 'undefined', '-']);

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : String(value).trim();
  if (NULLISH_STRINGS.has(text.toLowerCase())) return null;
  return text;
}

function toInt(value) {
  const text = clean(value);
  if (text === null) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(value) {
  const text = clean(value);
  if (text === null) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

const TRUTHY = new Set(['true', 't', 'yes', 'y', '1']);
const FALSY = new Set(['false', 'f', 'no', 'n', '0']);

// NABH accreditation is a claim about a hospital's quality certification.
// Only an unambiguously truthy or falsy source value produces a boolean;
// anything else stays null so that "we do not know" is distinguishable
// from "not accredited".
function toBoolOrNull(value) {
  const text = clean(value);
  if (text === null) return null;
  const lower = text.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null;
}

// establishment_year is a date column. Where the source string already
// starts with a YYYY-MM-DD prefix we slice it rather than round-tripping
// through Date, because parsing '1998-04-01 00:00:00' as local time and
// then serialising as UTC can move the day backwards.
function toDateOnly(value) {
  const text = clean(value);
  if (text === null) return null;

  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoPrefix) return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;

  const yearOnly = /^(\d{4})$/.exec(text);
  if (yearOnly) {
    const year = Number.parseInt(yearOnly[1], 10);
    if (year >= 1700 && year <= 2200) return `${yearOnly[1]}-01-01`;
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function toTimestamp(value) {
  const text = clean(value);
  if (text === null) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function splitSpecialities(value) {
  const text = clean(value);
  if (text === null) return [];
  return text
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pct(part, total) {
  if (!total) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------
// Streaming reader
// ---------------------------------------------------------------------

// The export is a single 53 MB JSON array holding 39,526 objects.
// JSON.parse on the whole file would allocate the entire text plus the
// entire object graph before the first row could be written, which on a
// modest laptop is a few hundred megabytes of peak heap for no reason,
// and it makes --limit 10 as expensive as a full import. So the file is
// read as a stream and split into individual array elements here, then
// each element is handed to JSON.parse on its own. Peak memory is one
// chunk plus one hospital record.
//
// The split is done by counting brace and bracket depth rather than by
// looking for lines or indentation, because the writer's formatting is
// not part of the contract: the same data could arrive minified on a
// single line. The one thing depth counting must get right is string
// literals. Hospital names and addresses in this dataset contain braces
// and quotes, so the scanner tracks whether it is inside a "..." literal
// and, while inside one, treats every structural character as ordinary
// text. Backslash escapes are tracked too, so that a name ending in a
// literal \" does not look like the end of the string and throw the
// depth count off for the rest of the file.
async function* streamJsonArrayElements(filePath, onMalformed) {
  const stream = fs.createReadStream(filePath, {
    encoding: 'utf8',          // Node's StringDecoder keeps multi-byte
    highWaterMark: 1 << 20,    // characters intact across chunk edges
  });

  let sawArrayStart = false;
  let inElement = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pieces = [];             // fragments of an element that spans chunks

  for await (const chunk of stream) {
    // Where the current element starts inside this chunk. -1 means we are
    // between elements; 0 means the element began in an earlier chunk.
    let sliceStart = inElement ? 0 : -1;

    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (!sawArrayStart) {
        // Skip a byte-order mark and any leading whitespace until the
        // array actually opens. This '[' is the container, not a record.
        if (ch === '[') sawArrayStart = true;
        continue;
      }

      if (!inElement) {
        if (ch === '{' || ch === '[') {
          inElement = true;
          depth = 1;
          sliceStart = i;
        }
        // Commas, whitespace and the closing ']' fall through untouched.
        continue;
      }

      if (ch === '{' || ch === '[') {
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          pieces.push(chunk.slice(sliceStart, i + 1));
          const text = pieces.join('');
          pieces = [];
          inElement = false;
          sliceStart = -1;

          let record;
          try {
            record = JSON.parse(text);
          } catch (err) {
            if (onMalformed) onMalformed(text, err);
            continue;
          }
          yield record;
        }
      }
    }

    if (inElement && sliceStart >= 0) pieces.push(chunk.slice(sliceStart));
  }

  if (!sawArrayStart) {
    throw new Error(`${filePath} does not contain a JSON array.`);
  }
  if (inElement) {
    throw new Error(
      `${filePath} ended in the middle of a record — the file looks truncated.`,
    );
  }
}

// ---------------------------------------------------------------------
// District names
// ---------------------------------------------------------------------

// Why this is written as a best-effort attempt wrapped in try/catch
// rather than a hard dependency: the NHA host that serves the district
// list is reachable only intermittently, refuses connections from most
// datacentre ranges, and presents a self-signed certificate that Node's
// TLS stack correctly rejects. When it does not answer, this importer
// must not stall the whole registry and must not substitute a guess.
// Instead every district gets a 'District <code>' row in ref_districts,
// which keeps the foreign key from hospitals valid, and
// hospitals.district_name is left NULL — which is the signal the schema
// comment already describes, and which the UI reads as "omit the
// district line entirely" rather than "print a number at the patient".
async function fetchDistrictNames(stateCodes) {
  const names = new Map();

  const attempts = [
    { label: 'GET (full list)', method: 'GET', url: NHA_DISTRICT_URL, body: null },
    ...[...stateCodes].map((code) => ({
      label: `POST stateCode=${code}`,
      method: 'POST',
      url: NHA_DISTRICT_URL,
      body: { stateCode: String(code), stateId: String(code) },
    })),
  ];

  let anySucceeded = false;

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];

    // Give the host two chances — the bare GET and one per-state POST —
    // and then stop. If neither answered, the problem is the host rather
    // than the payload shape, and walking the remaining thirty-odd states
    // would only add thirty timeouts to the import.
    if (!anySucceeded && i >= 2) break;

    try {
      const response = await fetch(attempt.url, {
        method: attempt.method,
        headers: NHA_HEADERS,
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(`  district lookup ${attempt.label}: HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const found = collectDistrictNames(payload);
      if (found.length > 0) {
        anySucceeded = true;
        for (const { code, name } of found) {
          if (!names.has(code)) names.set(code, name);
        }
        // A single response carrying the whole country is enough.
        if (attempt.method === 'GET' && found.length > 100) break;
      } else {
        console.warn(`  district lookup ${attempt.label}: no districts in response`);
      }
    } catch (err) {
      console.warn(`  district lookup ${attempt.label} failed: ${err.message}`);
      if (/certificate|self.signed/i.test(String(err.message))) {
        console.warn(
          '  (that host presents a self-signed certificate; a re-run with ' +
            'NODE_TLS_REJECT_UNAUTHORIZED=0 would accept it, at the cost of ' +
            'not verifying the peer)',
        );
      }
    }
  }

  return names;
}

// The district endpoint has never been captured responding, so its exact
// envelope is unknown. Rather than assume one shape, walk whatever comes
// back and accept only pairs where a numeric code sits next to a
// non-numeric name; anything ambiguous is dropped.
function collectDistrictNames(payload) {
  const out = [];

  const pushPair = (rawCode, rawName) => {
    const code = toInt(rawCode);
    const name = clean(rawName);
    if (code === null || name === null) return;
    if (/^\d+$/.test(name)) return;
    out.push({ code, name });
  };

  const visit = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 6) return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    if (typeof node !== 'object') return;

    const keys = Object.keys(node);

    // Shape A, mirroring the state list: { "DISTRICT NAME": "506", ... }
    const looksLikeNameToCodeMap =
      keys.length > 1 &&
      keys.every((key) => /[A-Za-z]/.test(key) && /^\d+$/.test(String(node[key] ?? '')));
    if (looksLikeNameToCodeMap) {
      for (const key of keys) pushPair(node[key], key);
      return;
    }

    // Shape B: an object describing one district.
    const codeKey = keys.find((key) => /^(district)?(code|id)$/i.test(key));
    const nameKey = keys.find((key) => /^(district)?name$/i.test(key));
    if (codeKey && nameKey) {
      pushPair(node[codeKey], node[nameKey]);
      return;
    }

    for (const key of keys) visit(node[key], depth + 1);
  };

  visit(payload);
  return out;
}

// ---------------------------------------------------------------------
// Supabase writes
// ---------------------------------------------------------------------

function makeWriter(supabase, dryRun) {
  const state = { failedBatches: 0, upserted: 0, byTable: new Map() };

  async function upsert(table, rows, onConflict, firstKeyLabel) {
    if (rows.length === 0) return true;

    const credit = () => {
      state.upserted += rows.length;
      state.byTable.set(table, (state.byTable.get(table) ?? 0) + rows.length);
    };

    if (dryRun) {
      credit();
      return true;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      if (!error) {
        credit();
        return true;
      }

      if (attempt === MAX_ATTEMPTS) {
        state.failedBatches += 1;
        console.error(
          `  ${table}: batch of ${rows.length} failed after ${MAX_ATTEMPTS} attempts ` +
            `(first key ${firstKeyLabel}): ${error.message}`,
        );
        return false;
      }

      console.warn(
        `  ${table}: batch starting ${firstKeyLabel} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ` +
          `${error.message} — retrying`,
      );
      await sleep(RETRY_BASE_MS * attempt * attempt);
    }

    return false;
  }

  return { upsert, state };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceFile = resolveSourceFile(opts.file);

  // Both files are optional; dotenv reports a missing path in its return
  // value rather than throwing, so an absent .env.local is a non-event.
  for (const envFile of ['.env.local', '.env']) {
    dotenv.config({ path: path.join(REPO_ROOT, envFile), quiet: true });
  }

  const supabaseUrl = clean(process.env.SUPABASE_URL) ?? clean(process.env.VITE_SUPABASE_URL);
  const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!opts.dryRun) {
    if (!supabaseUrl) {
      console.error(
        'No Supabase URL. Set SUPABASE_URL or VITE_SUPABASE_URL in .env.local, ' +
          'or re-run with --dry-run to parse the file without writing.',
      );
      process.exit(1);
    }
    if (!serviceKey) {
      console.error(
        'No SUPABASE_SERVICE_ROLE_KEY. This import writes reference tables and ' +
          'bypasses RLS, so the anon key cannot be used. Add the service role key ' +
          '(Project Settings -> API) to .env.local, or re-run with --dry-run.',
      );
      process.exit(1);
    }
  }

  const supabase =
    opts.dryRun || !supabaseUrl || !serviceKey
      ? null
      : createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

  const writer = makeWriter(supabase, opts.dryRun);
  const now = new Date().toISOString();

  console.log('NHA hospital import');
  console.log(`  source:   ${sourceFile}`);
  console.log(`  target:   ${opts.dryRun ? '(dry run — nothing is written)' : supabaseUrl}`);
  console.log(`  limit:    ${opts.limit ?? 'all rows'}`);
  console.log(`  batch:    ${BATCH_SIZE}`);
  console.log('');

  let malformed = 0;
  const onMalformed = (text, err) => {
    malformed += 1;
    if (malformed <= 5) {
      console.warn(`  skipped unparseable record: ${err.message} — ${text.slice(0, 80)}…`);
    }
  };

  // -------------------------------------------------------------------
  // Pass 1 — collect the lookups
  //
  // hospitals.state_code and hospitals.district_code are real foreign
  // keys, and ref_districts.state_code is NOT NULL, so every
  // (state, district) pair in the data has to exist in the lookup tables
  // before the first hospital row is sent. That is only knowable after
  // reading the whole file, which is why the file is streamed twice
  // instead of buffering 39,526 rows to avoid the second read.
  // -------------------------------------------------------------------
  console.log('Pass 1 of 2 — scanning for states, districts and specialities');

  const stateCodes = new Set();
  const districtToState = new Map();       // districtCode -> first stateCode seen
  const districtConflicts = new Map();     // one entry per distinct collision
  const specialityCodes = new Set();
  let scanned = 0;

  for await (const record of streamJsonArrayElements(sourceFile, onMalformed)) {
    scanned += 1;

    const stateCode = toInt(record.stateCode);
    const districtCode = toInt(record.districtCode);

    if (stateCode !== null) stateCodes.add(stateCode);

    if (districtCode !== null && stateCode !== null) {
      const existing = districtToState.get(districtCode);
      if (existing === undefined) {
        districtToState.set(districtCode, stateCode);
      } else if (existing !== stateCode) {
        // District codes are supposed to be unique nationally. Where the
        // data disagrees the first association wins, and the collision is
        // recorded once per distinct (district, state) pair rather than
        // once per hospital, so a single reused code does not bury the
        // rest of the log under hundreds of identical lines.
        const key = `${districtCode}:${stateCode}`;
        if (!districtConflicts.has(key)) {
          districtConflicts.set(key, { districtCode, kept: existing, alsoSeen: stateCode });
        }
      }
    }

    for (const code of splitSpecialities(record.specialityCode)) specialityCodes.add(code);

    if (scanned % PROGRESS_EVERY === 0) console.log(`  scanned ${scanned} records`);
    if (opts.limit && scanned >= opts.limit) break;
  }

  console.log(
    `  scanned ${scanned} records: ${stateCodes.size} states, ` +
      `${districtToState.size} districts, ${specialityCodes.size} speciality codes`,
  );

  for (const conflict of [...districtConflicts.values()].slice(0, 20)) {
    console.warn(
      `  district ${conflict.districtCode} appears under state ${conflict.kept} and ` +
        `state ${conflict.alsoSeen}; keeping ${conflict.kept}. Hospitals in state ` +
        `${conflict.alsoSeen} keep that district_code, so a later district-name ` +
        'backfill has to key on (state_code, district_code), not the code alone.',
    );
  }
  if (districtConflicts.size > 20) {
    console.warn(`  ...and ${districtConflicts.size - 20} more district/state collisions`);
  }
  console.log('');

  // -------------------------------------------------------------------
  // ref_states
  // -------------------------------------------------------------------
  console.log('Writing ref_states');

  const unknownStateCodes = [];
  const stateRows = [...stateCodes]
    .sort((a, b) => a - b)
    .map((code) => {
      const known = STATE_NAMES.get(code);
      if (!known) unknownStateCodes.push(code);
      return {
        code,
        name: known ?? `State ${code}`,
        source: known
          ? 'LGD / 2011 census state codes'
          : 'placeholder — state code not in the LGD map',
      };
    });

  for (const code of unknownStateCodes) {
    console.warn(
      `  state code ${code} is not in the LGD map; inserted as "State ${code}" and ` +
        'hospitals in it will have a null state_name until the real name is confirmed',
    );
  }

  for (let i = 0; i < stateRows.length; i += BATCH_SIZE) {
    const batch = stateRows.slice(i, i + BATCH_SIZE);
    const ok = await writer.upsert('ref_states', batch, 'code', `code=${batch[0].code}`);
    if (!ok) {
      console.error(
        'ref_states could not be written. Aborting: every hospital row has a ' +
          'foreign key into it, so continuing would fail 500 rows at a time.',
      );
      process.exit(1);
    }
  }
  console.log(`  ${stateRows.length} states`);
  console.log('');

  // -------------------------------------------------------------------
  // ref_districts
  // -------------------------------------------------------------------
  let districtNames = new Map();
  let districtNamesAvailable = false;

  if (opts.skipDistricts) {
    console.log('Skipping the NHA district-name lookup (--skip-districts)');
  } else {
    console.log('Fetching district names from the NHA district list');
    districtNames = await fetchDistrictNames(stateCodes);
    districtNamesAvailable = districtNames.size > 0;
  }

  if (districtNamesAvailable) {
    console.log(`  got ${districtNames.size} district names`);
  } else {
    console.warn(
      '  District names are NOT available. ref_districts will hold ' +
        '"District <code>" placeholders and hospitals.district_name will be left ' +
        'NULL, which means the UI will omit the district rather than show a code. ' +
        'Re-run this import once the NHA list is reachable to fill them in.',
    );
  }
  console.log('');

  console.log('Writing ref_districts');
  const districtRows = [...districtToState.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, state_code]) => {
      const name = districtNames.get(code) ?? null;
      return {
        code,
        state_code,
        name: name ?? `District ${code}`,
        source: name ? 'NHA district list' : 'placeholder — NHA district list unavailable',
      };
    });

  for (let i = 0; i < districtRows.length; i += BATCH_SIZE) {
    const batch = districtRows.slice(i, i + BATCH_SIZE);
    const ok = await writer.upsert('ref_districts', batch, 'code', `code=${batch[0].code}`);
    if (!ok) {
      console.error(
        'ref_districts could not be written. Aborting before hospitals, whose ' +
          'district_code points here.',
      );
      process.exit(1);
    }
  }
  const namedDistricts = districtRows.filter((row) => row.source === 'NHA district list').length;
  console.log(
    `  ${districtRows.length} districts (${namedDistricts} named, ` +
      `${districtRows.length - namedDistricts} placeholder)`,
  );
  console.log('');

  const insertedDistrictCodes = new Set(districtRows.map((row) => row.code));

  // -------------------------------------------------------------------
  // ref_specialities
  // -------------------------------------------------------------------
  console.log('Writing ref_specialities');
  const specialityRows = [...specialityCodes]
    .sort()
    .map((code) => {
      const known = KNOWN_SPECIALITIES.get(code);
      if (known) {
        return {
          code,
          name: known.name,
          short_code: known.short_code,
          sort_order: known.sort_order,
        };
      }
      return { code, name: `Speciality ${code}` };
    });

  const pendingSpecialities = specialityRows.length - specialityRows.filter(
    (row) => KNOWN_SPECIALITIES.has(row.code),
  ).length;

  for (let i = 0; i < specialityRows.length; i += BATCH_SIZE) {
    const batch = specialityRows.slice(i, i + BATCH_SIZE);
    await writer.upsert('ref_specialities', batch, 'code', `code=${batch[0].code}`);
  }
  console.log(
    `  ${specialityRows.length} speciality codes; ${pendingSpecialities} have no confirmed ` +
      'name yet and were inserted as "Speciality <code>" placeholders',
  );
  console.log('');

  // -------------------------------------------------------------------
  // Pass 2 — hospitals
  // -------------------------------------------------------------------
  console.log('Pass 2 of 2 — importing hospitals');

  const stats = {
    parsed: 0,
    prepared: 0,
    geoUsable: 0,
    geoOutsideIndia: 0,
    geoMissing: 0,
    typeG: 0,
    typeP: 0,
    typePP: 0,
    typeOther: 0,
    inactive: 0,
    skippedNoFacilityId: 0,
    skippedNoName: 0,
    duplicateFacilityId: 0,
    droppedHospitalId: 0,
    districtDroppedNoState: 0,
  };

  const seenFacilityIds = new Set();
  const seenHospitalIds = new Set();
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await writer.upsert('hospitals', batch, 'facility_id', batch[0].facility_id);
    batch = [];
  };

  for await (const record of streamJsonArrayElements(sourceFile, onMalformed)) {
    stats.parsed += 1;

    const facilityId = clean(record.facilityId);
    if (facilityId === null) {
      // facility_id is the conflict target that makes this import
      // idempotent. A row without one cannot be safely re-imported, so
      // it is reported rather than given a synthetic key.
      stats.skippedNoFacilityId += 1;
      if (stats.skippedNoFacilityId <= 5) {
        console.warn(`  skipped record with no facilityId (hospitalId ${record.hospitalId})`);
      }
      if (opts.limit && stats.parsed >= opts.limit) break;
      continue;
    }

    const name = clean(record.hospName);
    if (name === null) {
      stats.skippedNoName += 1;
      if (stats.skippedNoName <= 5) {
        console.warn(`  skipped ${facilityId}: no hospName, and hospitals.name is NOT NULL`);
      }
      if (opts.limit && stats.parsed >= opts.limit) break;
      continue;
    }

    if (seenFacilityIds.has(facilityId)) {
      // Two rows with the same conflict key inside one upsert make
      // Postgres reject the whole batch ("cannot affect row a second
      // time"), so the first occurrence wins and the repeat is counted.
      stats.duplicateFacilityId += 1;
      if (stats.duplicateFacilityId <= 5) {
        console.warn(`  duplicate facilityId ${facilityId} in the source; keeping the first`);
      }
      if (opts.limit && stats.parsed >= opts.limit) break;
      continue;
    }
    seenFacilityIds.add(facilityId);

    // hospital_id carries its own unique constraint. If the export
    // repeats one under a different facility_id, keeping both would abort
    // the batch, so the later row keeps its facility_id and loses the
    // numeric id rather than losing the hospital.
    let hospitalId = toInt(record.hospitalId);
    if (hospitalId !== null && seenHospitalIds.has(hospitalId)) {
      stats.droppedHospitalId += 1;
      if (stats.droppedHospitalId <= 5) {
        console.warn(
          `  hospitalId ${hospitalId} already used; storing ${facilityId} without it`,
        );
      }
      hospitalId = null;
    } else if (hospitalId !== null) {
      seenHospitalIds.add(hospitalId);
    }

    // Coordinates arrive as strings in this export, and three outcomes
    // have to stay distinguishable. When both strings parse as finite
    // numbers the pair is stored, because even a coordinate we do not
    // trust for distance sorting is worth keeping for a later fix or an
    // external map link. geo_usable is then the narrower question of
    // whether the point actually falls inside India: a handful of rows
    // carry transposed or zeroed coordinates that would otherwise put a
    // hospital in the Gulf of Guinea at the top of a "nearest to me"
    // list. Rows with no parseable coordinate get null for both and
    // geo_usable false, so the distance query excludes them by
    // construction rather than by remembering to filter.
    const latitude = toFloat(record.hospLatitude);
    const longitude = toFloat(record.hospLongitude);
    let geoUsable = false;

    if (latitude === null || longitude === null) {
      stats.geoMissing += 1;
    } else if (
      latitude >= INDIA_MIN_LAT &&
      latitude <= INDIA_MAX_LAT &&
      longitude >= INDIA_MIN_LNG &&
      longitude <= INDIA_MAX_LNG
    ) {
      geoUsable = true;
      stats.geoUsable += 1;
    } else {
      stats.geoOutsideIndia += 1;
    }

    const stateCode = toInt(record.stateCode);
    const knownStateName = stateCode === null ? null : STATE_NAMES.get(stateCode) ?? null;

    const districtCodeRaw = toInt(record.districtCode);
    // A district row needs a state (ref_districts.state_code is NOT
    // NULL), so a district code that arrived without one was never
    // inserted and referencing it here would violate the foreign key.
    const districtCode =
      districtCodeRaw !== null && insertedDistrictCodes.has(districtCodeRaw)
        ? districtCodeRaw
        : null;
    if (districtCodeRaw !== null && districtCode === null) stats.districtDroppedNoState += 1;

    const typeCodeRaw = clean(record.hospTypeCode);
    const typeCode =
      typeCodeRaw && ['G', 'P', 'PP'].includes(typeCodeRaw.toUpperCase())
        ? typeCodeRaw.toUpperCase()
        : null;
    if (typeCode === 'G') stats.typeG += 1;
    else if (typeCode === 'P') stats.typeP += 1;
    else if (typeCode === 'PP') stats.typePP += 1;
    else stats.typeOther += 1;

    const deempanelStatus = clean(record.deempanelStatus);
    const active = deempanelStatus === null;
    if (!active) stats.inactive += 1;

    batch.push({
      facility_id: facilityId,
      hospital_id: hospitalId,
      hfr_id: clean(record.hfrId),

      name,
      address: clean(record.hospAddress),

      // Empty in all 39,526 source rows. Written anyway so that an
      // export which does carry them fills the columns without a code
      // change; until then they stay null and no city or pincode search
      // may be offered.
      city: clean(record.hospCity),
      pincode: clean(record.hospPin),

      phone: clean(record.hospContactNumber),
      mobile: clean(record.hospMobileNumber),   // a JSON number in the source
      email: clean(record.hospEmailId),
      website: clean(record.hospWebsite),

      type_code: typeCode,
      ownership_sub_type: clean(record.facilityOwnershipSubType),
      facility_type: clean(record.type),

      scheme_code: clean(record.schemeCode),
      speciality_codes: splitSpecialities(record.specialityCode),

      state_code: stateCode,
      district_code: districtCode,
      // Denormalised names are only filled from a name we can stand
      // behind. An unmapped state code or an unavailable district list
      // leaves these null, and the UI omits the line.
      state_name: knownStateName,
      district_name: districtCode === null ? null : districtNames.get(districtCode) ?? null,

      latitude,
      longitude,
      geo_usable: geoUsable,

      nabh_accredited: toBoolOrNull(record.accredited),
      // Not present in the profiled export; read defensively so a later
      // export that includes it lands in the column.
      empanelment_status: clean(record.empanelmentStatus),
      deempanel_status: deempanelStatus,
      empaneled_date: toTimestamp(record.empaneledDate),
      establishment_year: toDateOnly(record.establishmentYear),

      nodal_officer_name: clean(record.nodalOfficerName),
      nodal_officer_phone: clean(record.nodalOfficerNumber),

      // This is an official registry, so the row is verified. The phone
      // number in it is a separate claim that nobody has dialled, hence
      // contact_verified stays false. source and source_url are left to
      // the column defaults on purpose, so the attribution string the UI
      // prints lives in one place: the schema.
      verification: 'verified',
      contact_verified: false,
      verified_at: now,
      imported_at: now,

      active,
    });

    stats.prepared += 1;

    if (batch.length >= BATCH_SIZE) await flush();

    if (stats.parsed % PROGRESS_EVERY === 0) {
      console.log(
        `  ${stats.parsed} parsed, ${writer.state.byTable.get('hospitals') ?? 0} upserted, ` +
          `${stats.geoUsable} with usable coordinates`,
      );
    }

    if (opts.limit && stats.parsed >= opts.limit) break;
  }

  await flush();
  console.log('');

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  const hospitalsUpserted = writer.state.byTable.get('hospitals') ?? 0;

  console.log('Summary');
  console.log(`  parsed:              ${stats.parsed}`);
  console.log(`  prepared:            ${stats.prepared}`);
  console.log(
    `  upserted:            ${hospitalsUpserted}` +
      (opts.dryRun ? '  (dry run — nothing was written)' : ''),
  );
  console.log(
    `  geo_usable:          ${stats.geoUsable}  (${pct(stats.geoUsable, stats.prepared)})`,
  );
  console.log(`  outside India:       ${stats.geoOutsideIndia}  (coordinates kept, geo_usable false)`);
  console.log(`  no coordinates:      ${stats.geoMissing}`);
  console.log(`  government (G):      ${stats.typeG}`);
  console.log(`  private (P):         ${stats.typeP}`);
  console.log(`  public-private (PP): ${stats.typePP}`);
  console.log(`  no/unknown type:     ${stats.typeOther}`);
  console.log(`  de-empanelled:       ${stats.inactive}  (active = false)`);
  console.log(`  failed batches:      ${writer.state.failedBatches}`);
  console.log(
    `  district names:      ${
      districtNamesAvailable
        ? `available (${namedDistricts} of ${districtRows.length} districts named)`
        : 'UNAVAILABLE — district_name left NULL, UI omits the district'
    }`,
  );

  if (malformed) console.log(`  unparseable records: ${malformed}`);
  if (stats.skippedNoFacilityId) console.log(`  skipped, no facilityId: ${stats.skippedNoFacilityId}`);
  if (stats.skippedNoName) console.log(`  skipped, no name:      ${stats.skippedNoName}`);
  if (stats.duplicateFacilityId) console.log(`  duplicate facilityId:  ${stats.duplicateFacilityId}`);
  if (stats.droppedHospitalId) console.log(`  hospitalId dropped:    ${stats.droppedHospitalId}`);
  if (stats.districtDroppedNoState) {
    console.log(`  district_code nulled:  ${stats.districtDroppedNoState}  (no state code in source)`);
  }
  if (unknownStateCodes.length) {
    console.log(`  unmapped state codes:  ${unknownStateCodes.join(', ')}`);
  }

  if (writer.state.failedBatches > 0) {
    console.error('');
    console.error(
      `${writer.state.failedBatches} batch(es) failed permanently. Re-running is safe: ` +
        'the upsert conflicts on facility_id, so already-imported rows are updated ' +
        'rather than duplicated.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Import failed: ${err.stack ?? err.message ?? err}`);
  process.exit(1);
});
