import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import https from 'https';
import crypto from 'node:crypto';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

for (const envFile of ['.env.local', '.env']) {
  dotenv.config({ path: path.join(REPO_ROOT, envFile), quiet: true });
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const agent = new https.Agent({ rejectUnauthorized: false });

const NHA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/json; charset=UTF-8',
  'Origin': 'https://hem.nha.gov.in',
  'Referer': 'https://hem.nha.gov.in/',
  'Authorization': 'Bearer undefined',
};

const NHA_BASE = "https://apisprod.nha.gov.in/pmjay/prodhem";
const UMP_BASE = "https://apisprod.nha.gov.in/pmjay/prodump";
const HOSP_URL = `${NHA_BASE}/hem/external/hospital/list`;
const STATE_URL = `${UMP_BASE}/ump/ump/fetch/statelist`;
const SPEC_URL = `${NHA_BASE}/hem/hbp/get/specialities/list`;

async function nhaPost(url, body = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: NHA_HEADERS,
    body: JSON.stringify(body),
    agent,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`NHA POST ${url} ${r.status}: ${text.slice(0, 100)}`);
  }
  return r.json();
}

async function nhaGet(url) {
  const r = await fetch(url, { headers: NHA_HEADERS, agent });
  if (!r.ok) throw new Error(`NHA GET ${url} ${r.status}`);
  return r.json();
}

function clean(val) {
  if (val === null || val === undefined) return null;
  const text = String(val).trim();
  if (['', 'na', 'n/a', 'null', 'undefined', '-'].includes(text.toLowerCase())) return null;
  return text;
}

function toInt(val) {
  const c = clean(val);
  if (c === null) return null;
  const n = parseInt(c, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(val) {
  const c = clean(val);
  if (c === null) return null;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : null;
}

async function syncStatesAndSpecialities() {
  console.log("Fetching States from NHA...");
  const statesData = await nhaGet(STATE_URL);
  const stateRows = Object.entries(statesData?.StateList || {}).map(([name, code]) => ({
    code: Number(code),
    name: name,
    source: 'NHA Live API'
  }));
  
  if (stateRows.length > 0) {
    const { error } = await supabase.from('ref_states').upsert(stateRows, { onConflict: 'code' });
    if (error) console.error("Error upserting states", error);
    else console.log(`Upserted ${stateRows.length} states.`);
  }

  console.log("Fetching Specialities from NHA...");
  const specsData = await nhaPost(SPEC_URL, {});
  const rawSpecs = Array.isArray(specsData) ? specsData : [];
  
  const specsMap = new Map();
  for (const s of rawSpecs) {
    specsMap.set(s.specialitycode, {
      code: s.specialitycode,
      name: s.specialityname
    });
  }
  const specRows = Array.from(specsMap.values());

  if (specRows.length > 0) {
    const { error } = await supabase.from('ref_specialities').upsert(specRows, { onConflict: 'code' });
    if (error) console.error("Error upserting specialities", error);
    else console.log(`Upserted ${specRows.length} specialities.`);
  }

  return stateRows.map(s => s.code);
}

async function scrapeHospitals(stateCodes) {
  let totalUpserted = 0;
  
  for (const stateCode of stateCodes) {
    console.log(`\n--- Fetching hospitals for stateCode: ${stateCode} ---`);
    let page = 1;
    let hasNext = true;
    let stateDistricts = new Map();
    let batchHospitals = [];

    while (hasNext) {
      try {
        const payload = { facilityName: "", pageNo: page, size: 30, pincode: "", stateCode: String(stateCode) };
        const data = await nhaPost(HOSP_URL, payload);
        const records = data.content || [];
        
        for (const h of records) {
          const dCode = toInt(h.districtCode);
          if (dCode && !stateDistricts.has(dCode)) {
            stateDistricts.set(dCode, {
              code: dCode,
              state_code: stateCode,
              name: h.hospCity || `District ${dCode}`,
              source: 'NHA Live API'
            });
          }

          let lat = toFloat(h.hospLatitude);
          let lng = toFloat(h.hospLongitude);
          
          if (lat !== null && (lat < -90 || lat > 90)) lat = null;
          if (lng !== null && (lng < -180 || lng > 180)) lng = null;

          const geoUsable = lat !== null && lng !== null && lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

          batchHospitals.push({
            id: crypto.randomUUID(), 
            facility_id: h.facilityId,
            name: h.hospName,
            address: clean(h.hospAddress),
            phone: clean(h.hospContactNumber),
            mobile: clean(h.hospMobileNumber),
            type_code: clean(h.hospTypeCode),
            ownership_sub_type: clean(h.facilityOwnershipSubType),
            speciality_codes: h.specialityCode ? h.specialityCode.split(',').map(s=>s.trim()) : [],
            state_code: stateCode,
            state_name: clean(h.stateName),
            district_code: dCode,
            district_name: clean(h.districtName) || clean(h.hospCity),
            latitude: lat,
            longitude: lng,
            geo_usable: geoUsable,
            nabh_accredited: clean(h.accredited) === 'Yes' || clean(h.accredited) === 'NABH Accredited',
            active: true,
            imported_at: new Date().toISOString()
          });
        }

        hasNext = !data.last;
        page++;
        
        await new Promise(r => setTimeout(r, 100)); // Be gentle with the API
      } catch (err) {
        console.error(`Error fetching page ${page} for state ${stateCode}:`, err.message);
        hasNext = false;
      }
    }

    if (stateDistricts.size > 0) {
      const distRows = Array.from(stateDistricts.values());
      await supabase.from('ref_districts').upsert(distRows, { onConflict: 'code' });
      console.log(`Upserted ${distRows.length} districts for state ${stateCode}.`);
    }

    if (batchHospitals.length > 0) {
      // Deduplicate batchHospitals by facility_id to prevent Postgres ON CONFLICT error
      const uniqueHospitalsMap = new Map();
      for (const h of batchHospitals) {
         uniqueHospitalsMap.set(h.facility_id, h);
      }
      const deduplicatedHospitals = Array.from(uniqueHospitalsMap.values());

      const { error } = await supabase
        .from('hospitals')
        .upsert(deduplicatedHospitals, { onConflict: 'facility_id' });
        
      if (error) {
         console.error(`Error upserting hospitals for state ${stateCode}`, error.message);
      } else {
         console.log(`Upserted ${deduplicatedHospitals.length} hospitals for state ${stateCode}.`);
         totalUpserted += deduplicatedHospitals.length;
      }
    }
  }
  
  console.log(`\nFinished! Total hospitals upserted in this run: ${totalUpserted}`);
}

async function run() {
  const stateCodes = await syncStatesAndSpecialities();
  await scrapeHospitals(stateCodes);
}

run().catch(console.error);
