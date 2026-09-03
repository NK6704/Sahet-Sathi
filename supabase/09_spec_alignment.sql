-- =====================================================================
-- 09_spec_alignment.sql
--
-- Brings the database in line with the technical specification on the
-- three points where the built schema and the spec genuinely differ.
-- Everything here is ADDITIVE and IDEMPOTENT: run it as many times as
-- you like. It creates no table that 01/05 already created and drops
-- nothing that holds data.
--
-- Run order: 01 → 02 → 03 → 04(optional) → 05 → 06 → 07 → 08 → 09.
--
-- Three changes:
--
--   1. PostGIS. The spec calls for GEOGRAPHY(POINT,4326) with a GIST
--      index and ST_DWithin for the nearest-hospital query. 05 shipped a
--      Haversine implementation with a bounding-box prefilter instead,
--      because PostGIS is not enabled on a fresh Supabase project by
--      default and a hard dependency on it would have made the whole
--      file fail to apply. That implementation is correct but scans the
--      box; at 39.5k hospital rows it is fine, and it stops being fine
--      as the table grows. This file enables PostGIS and swaps the
--      function body for a GIST-indexed ST_DWithin search.
--
--      The function SIGNATURE is unchanged — same parameters, same
--      returns-table columns, same order. server/routes/hospitals.ts
--      needs no edit. If you would rather not enable PostGIS, skip
--      section 1 and everything still works.
--
--   2. schemes.priority_rank, schemes.trigger_keywords and
--      schemes.state_applicable. The spec's suggestion engine ranks
--      schemes, matches conversation keywords against them, and filters
--      out schemes that do not run in the caller's state. All three
--      columns were missing from 01_schema.sql's `schemes` definition.
--
--      state_applicable is the one that bit: an earlier draft of this
--      file used it in section 3 without ever adding it, so applying 09
--      failed with `42703: column s.state_applicable does not exist`.
--      Nothing had been created by then, so a re-run is safe.
--
--   3. public.suggest_schemes(). The spec expresses the suggestion
--      engine as application code holding a hard-coded priority matrix.
--      It belongs in the database next to the rows it ranks, so that
--      the assistant, the schemes page and the ASHA portal cannot each
--      drift to a different idea of what to recommend.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — PostGIS geography column, GIST index, and the rewritten
--             nearest-hospital function.
-- =====================================================================

-- PostGIS is not enabled on a fresh Supabase project, and *where* it gets
-- installed matters. Supabase keeps extensions in the `extensions` schema;
-- a self-hosted Postgres usually has no such schema and lands them in
-- `public`. The functions further down pin `search_path = public,
-- extensions`, which covers both cases — a search_path entry naming a
-- schema that does not exist is ignored rather than an error.
--
-- A generated column is the one thing that cannot lean on search_path,
-- because its expression is resolved once, at DDL time, and stored with
-- the table. So the schema is looked up and written into the statement.
--
-- A generated column, not a trigger-maintained one: the point can never
-- fall out of step with the latitude/longitude it derives from, because
-- Postgres recomputes it on every write and refuses any attempt to set it
-- directly. `stored` rather than `virtual` because a GIST index needs it.
do $$
declare
  v_schema text;
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    if not exists (select 1 from pg_available_extensions where name = 'postgis') then
      raise exception
        'PostGIS is not available on this Postgres instance. Skip section 1 of this file: '
        '05_platform.sql already ships a working Haversine hospitals_nearby() with the same '
        'signature, and the app runs on it unchanged.';
    end if;
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension postgis with schema extensions';
    else
      execute 'create extension postgis';
    end if;
  end if;

  select n.nspname into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis';

  if v_schema not in ('public', 'extensions') then
    raise warning
      'PostGIS lives in schema %. The two functions in this file pin search_path to '
      '(public, extensions), so add % to their SET clauses or the ST_* calls will not '
      'resolve at run time.', v_schema, v_schema;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hospitals'
      and column_name = 'location'
  ) then
    -- ST_MakePoint takes (x, y) = (longitude, latitude). Reversing these
    -- is the single most common PostGIS bug and it fails silently: every
    -- distance comes out wrong and nothing errors.
    execute format(
      'alter table public.hospitals add column location %1$I.geography(Point, 4326) '
      'generated always as ('
      '  case when latitude is null or longitude is null then null '
      '       else %1$I.ST_SetSRID(%1$I.ST_MakePoint(longitude, latitude), 4326)::%1$I.geography '
      '  end) stored',
      v_schema);
  end if;
end $$;

create index if not exists idx_hospitals_location
  on public.hospitals using gist (location);

-- The spec also asks for district/state indexes. `district_name`/`state_name`
-- are the column names in this schema; `pincode` does not exist on
-- hospitals because the source NHA file does not carry one (see the note
-- in 05_platform.sql). Indexing a column that is always null would be
-- theatre, so it is omitted deliberately.
--
-- The `_name` suffixes are load-bearing. 05_platform.sql already owns the
-- name `idx_hospitals_district`, on (state_code, district_code) — and
-- `create index if not exists` matches on the NAME, not the definition,
-- so calling this one `idx_hospitals_district` would have silently created
-- nothing at all and left the name-based lookups unindexed.
create index if not exists idx_hospitals_district_name on public.hospitals (district_name);
create index if not exists idx_hospitals_state_name    on public.hospitals (state_name);
create index if not exists idx_hospitals_active_geo
  on public.hospitals (active, geo_usable) where active and geo_usable;

-- Village lookup for broadcast targeting — an ASHA sends to a village and
-- we need every citizen in it — is already indexed by 05_platform.sql:258
-- as idx_profiles_village. It is not repeated here.


-- Same signature as 05_platform.sql. Only the body changes.
create or replace function public.hospitals_nearby(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  double precision default 25,
  p_type       text default null,          -- 'G' | 'P' | null for both
  p_speciality text default null,          -- '100005'
  p_limit      int default 20,
  p_offset     int default 0
)
returns table (
  id            uuid,
  facility_id   text,
  name          text,
  address       text,
  phone         text,
  mobile        text,
  type_code     text,
  ownership_sub_type text,
  facility_type text,
  speciality_codes text[],
  state_name    text,
  district_name text,
  latitude      double precision,
  longitude     double precision,
  distance_km   double precision,
  contact_verified boolean,
  verification  verification_state,
  source        text,
  source_url    text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           greatest(coalesce(p_radius_km, 25), 0.1)                as radius_km
  )
  select
    h.id, h.facility_id, h.name, h.address, h.phone, h.mobile,
    h.type_code, h.ownership_sub_type, h.facility_type, h.speciality_codes,
    h.state_name, h.district_name, h.latitude, h.longitude,
    round((ST_Distance(h.location, o.g) / 1000.0)::numeric, 2)::double precision
      as distance_km,
    h.contact_verified, h.verification, h.source, h.source_url
  from public.hospitals h, origin o
  where h.active
    and h.geo_usable
    and h.location is not null
    -- ST_DWithin on a geography is index-assisted by idx_hospitals_location,
    -- so this is a GIST lookup rather than the box scan it replaces.
    and ST_DWithin(h.location, o.g, o.radius_km * 1000.0)
    and (p_type is null or h.type_code = p_type)
    and (p_speciality is null or h.speciality_codes @> array[p_speciality])
  order by h.location <-> o.g, h.name asc
  limit greatest(least(coalesce(p_limit, 20), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.hospitals_nearby is
  'Distance-sorted PMJAY hospitals within a radius, GIST-indexed via '
  'PostGIS ST_DWithin. Returns zero rows rather than widening the '
  'search: an empty result is a truthful answer and the caller is '
  'expected to say so. Signature is unchanged from the Haversine '
  'implementation it replaced.';


-- =====================================================================
-- SECTION 2 — Suggestion-engine columns on schemes.
-- =====================================================================

alter table public.schemes
  add column if not exists priority_rank    int not null default 99,
  add column if not exists trigger_keywords text[] not null default '{}',
  add column if not exists state_applicable text;

comment on column public.schemes.state_applicable is
  'Which state a scheme runs in. NULL means unrecorded, and is treated '
  'as "do not filter" rather than "nowhere" — dropping a scheme from '
  'somebody''s list because we never wrote down its geography would be '
  'the app hiding help it has. ''All India'' or ''Central'' mark the '
  'national schemes. A state scheme carries the state name as spelled '
  'in profiles.state.';

comment on column public.schemes.priority_rank is
  'Lower sorts first. 1-20 are the ranked national schemes; 99 is the '
  'default for anything unranked, so a new row is never silently '
  'promoted above a curated one.';

comment on column public.schemes.trigger_keywords is
  'Matched case-insensitively against assistant conversation text to '
  'surface a scheme. These are recall aids for ranking, never an '
  'eligibility decision — eligibility is only ever assessed against '
  'eligibility_rules, and even then reported as "may be eligible".';

create index if not exists idx_schemes_priority
  on public.schemes (priority_rank) where active;

create index if not exists idx_schemes_keywords
  on public.schemes using gin (trigger_keywords);


-- Backfill. Ranks follow the spec's ordering; the codes are the ones
-- actually seeded by 03_seed_schemes.sql and 07_seed_schemes_extra.sql
-- (all twenty were checked against those two files — a code that does not
-- match simply updates nothing, so a typo here fails quietly, which is
-- why they were checked rather than trusted).
--
-- Keywords are deliberately generous on symptom words a person would
-- actually say out loud, in English and transliterated Hindi, because
-- the assistant matches against speech, not form fields.
--
-- Every one of these twenty is a central scheme, so state_applicable is
-- set to 'All India' — but only where it is still null, so that editing a
-- row by hand later is not undone by re-running this file.
update public.schemes s set
  priority_rank = v.rank,
  trigger_keywords = v.kw,
  state_applicable = coalesce(s.state_applicable, 'All India')
from (values
  ('pmjay',        1,  array['hospital','admission','surgery','operation','insurance','cashless','ayushman','bharti','ilaj','kharcha','bill']),
  ('jsy',          2,  array['pregnant','pregnancy','delivery','birth','institutional delivery','garbhvati','prasav','janani']),
  ('pmmvy',        3,  array['pregnant','first child','maternity benefit','wage loss','matritva','garbhvati']),
  ('jssk',         4,  array['delivery','caesarean','newborn','free delivery','transport','prasav','nishulk']),
  ('janaushadhi',  5,  array['medicine','medicines','generic','expensive medicine','dawa','dava','sasti dawa','pharmacy']),
  ('npy',          6,  array['tb','tuberculosis','cough blood','nutrition support','kshay','khansi','nikshay']),
  ('ntep',         7,  array['tb','tuberculosis','sputum','dots','chest x-ray','kshay rog']),
  ('pmndp',        8,  array['dialysis','kidney','renal','creatinine','gurda','kidney failure']),
  ('pmsma',        9,  array['antenatal','checkup','pregnancy checkup','high risk pregnancy','jaanch']),
  ('vay_vandana', 10,  array['pension','senior citizen','old age','60','70','budhapa','vridh']),
  ('ran',         11,  array['cancer','serious illness','financial assistance','major surgery','gambhir bimari']),
  ('rbsk',        12,  array['child','birth defect','developmental delay','school health','bachcha','bacche']),
  ('uip',         13,  array['vaccine','vaccination','immunisation','immunization','tika','tikakaran','polio','measles']),
  ('poshan',      14,  array['malnutrition','anaemia','anemia','underweight','nutrition','kuposhan','khoon ki kami']),
  ('npncd',       15,  array['diabetes','blood pressure','hypertension','cancer screening','stroke','sugar','bp']),
  ('nphce',       16,  array['elderly','old age care','geriatric','arthritis','budhe','bujurg']),
  ('rksk',        17,  array['adolescent','teenager','menstrual','period','anaemia in girls','kishori']),
  ('abha',        18,  array['health id','abha','health record','digital record','abha number']),
  ('aam',         19,  array['wellness centre','health and wellness','primary care','screening','arogya mandir']),
  ('hmcpf',       20,  array['mental health','depression','anxiety','stress','suicide','counselling','maansik'])
) as v(code, rank, kw)
where s.code = v.code;


-- =====================================================================
-- SECTION 3 — The suggestion engine, in the database.
-- =====================================================================

-- Ranks schemes for a person and a piece of conversation text. It
-- returns a REASON for every row so the UI can tell someone why a
-- scheme is on their list, and a match_kind so the UI can distinguish
-- "this applies to everyone" from "you said something that points here".
--
-- What it deliberately does NOT do is decide eligibility. Nothing in
-- here reads as a verdict, because the app has no access to SECC data,
-- no Aadhaar verification, and no way to confirm a BPL card. Callers
-- must present the output as "worth checking", never "you qualify".
create or replace function public.suggest_schemes(
  p_text       text default null,   -- what the person said
  p_age        int  default null,
  p_gender     text default null,
  p_pregnant   boolean default null,
  p_state      text default null,
  p_limit      int  default 5
)
returns table (
  id            uuid,
  code          text,
  name          text,
  name_hi       text,
  category      text,
  short_desc    text,
  benefit_summary text,
  helpline      text,
  official_url  text,
  verification  verification_state,
  priority_rank int,
  match_kind    text,     -- 'universal' | 'keyword' | 'profile'
  match_reason  text,
  matched_terms text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with needle as (
    select lower(coalesce(p_text, '')) as t
  ),
  scored as (
    select
      s.id, s.code, s.name, s.name_hi, s.category, s.short_desc,
      s.benefit_summary, s.helpline, s.official_url, s.verification,
      s.priority_rank,
      -- Which of the scheme's trigger words actually appear in what the
      -- person said. Returned so the UI can quote them back; a
      -- suggestion you cannot explain is a suggestion nobody trusts.
      coalesce((
        select array_agg(distinct k)
        from unnest(s.trigger_keywords) as k, needle n
        where n.t <> '' and position(k in n.t) > 0
      ), '{}'::text[]) as hits
    from public.schemes s
    where s.active
      and (
        s.state_applicable is null
        or p_state is null
        or lower(s.state_applicable) in ('all india', 'central')
        or lower(s.state_applicable) = lower(p_state)
      )
  )
  select
    sc.id, sc.code, sc.name, sc.name_hi, sc.category, sc.short_desc,
    sc.benefit_summary, sc.helpline, sc.official_url, sc.verification,
    sc.priority_rank,
    case
      when sc.code = 'pmjay'                    then 'universal'
      when cardinality(sc.hits) > 0             then 'keyword'
      else                                           'profile'
    end as match_kind,
    case
      when sc.code = 'pmjay'
        then 'Applies to every household that is on the SECC list — worth checking first.'
      when cardinality(sc.hits) > 0
        then 'You mentioned: ' || array_to_string(sc.hits, ', ')
      when p_pregnant is true and sc.category = 'maternal'
        then 'Relevant during pregnancy.'
      when p_age is not null and p_age >= 60 and sc.code in ('vay_vandana','nphce')
        then 'Relevant from age 60.'
      when p_age is not null and p_age < 19 and sc.code in ('rbsk','uip','rksk')
        then 'Relevant for children and adolescents.'
      else 'Commonly relevant — check the criteria yourself.'
    end as match_reason,
    sc.hits as matched_terms
  from scored sc
  where
    sc.code = 'pmjay'                                        -- always
    or cardinality(sc.hits) > 0                              -- said something
    or (p_pregnant is true and sc.category = 'maternal')
    or (p_age is not null and p_age >= 60 and sc.code in ('vay_vandana','nphce'))
    or (p_age is not null and p_age < 19  and sc.code in ('rbsk','uip','rksk'))
  order by
    -- Keyword hits outrank the universal default: if someone says
    -- "dialysis", the dialysis scheme matters more than the insurance
    -- everyone gets told about.
    (case when cardinality(sc.hits) > 0 then 0 else 1 end),
    cardinality(sc.hits) desc,
    sc.priority_rank asc,
    sc.name asc
  limit greatest(least(coalesce(p_limit, 5), 25), 1)
$$;

comment on function public.suggest_schemes is
  'Ranks schemes for a person and a snippet of conversation. Returns a '
  'reason and the matched terms for every row. This is a RANKING, not '
  'an eligibility decision: the app cannot see SECC, Aadhaar or BPL '
  'status, so callers must present results as worth checking and never '
  'as a verdict.';

grant execute on function public.suggest_schemes(text, int, text, boolean, text, int)
  to authenticated, anon;
grant execute on function public.hospitals_nearby(double precision, double precision, double precision, text, text, int, int)
  to authenticated, anon;


-- =====================================================================
-- Verification. Run these after applying; each should return a row.
-- =====================================================================
-- select postgis_version();
-- select count(*) as with_location from public.hospitals where location is not null;
-- select code, priority_rank, state_applicable, cardinality(trigger_keywords) as kw
--   from public.schemes order by priority_rank limit 20;
-- select code, match_kind, match_reason
--   from public.suggest_schemes('mujhe dialysis ke liye paisa chahiye', 45, 'Male', false, null, 5);
-- -- and with a state, which is what exercises the column that used to be missing:
-- select code, match_kind
--   from public.suggest_schemes('bacche ka tika', 3, 'Female', false, 'Madhya Pradesh', 5);
-- select name, district_name, distance_km
--   from public.hospitals_nearby(23.2599, 77.4126, 25, null, null, 5, 0);
