-- =====================================================================
-- Sehat Sathi — platform tables
-- Run AFTER 01_schema.sql and 02_rls.sql, BEFORE 06_platform_rls.sql.
--
-- What this file adds, and why each piece exists:
--
--   1. The PMJAY hospital registry (39,526 rows from the NHA scrape)
--      lands in its own table. It is bulk external reference data with
--      its own natural key, so mixing it into healthcare_facilities
--      would make re-importing destructive. They stay separate and a
--      referral may point at either one.
--
--   2. Villages become a real table with a real id. "Send this to
--      everyone in my village" cannot be built on free-text matching —
--      'Shyampur', 'shyampur' and 'Shyampur ' would be three villages.
--      profiles.village_id and the asha_villages junction carry the
--      actual relationship.
--
--   3. An ASHA account cannot be self-declared. asha_roster holds what
--      the block office issued; the invite code is stored as a bcrypt
--      hash so a database leak does not hand out worker accounts.
--
--   4. Notification fan-out is materialised into notification_recipients
--      rather than computed at read time. One row per person means read
--      state, delivery state and "who was actually told" are all
--      answerable after the fact.
--
--   5. Every SOS snapshots the hospitals it found into the broadcast row.
--      The registry changes; what the operator was told at 2am must not.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type request_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_audience as enum ('village', 'user', 'all');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sos_status as enum ('open', 'acknowledged', 'resolved', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type delivery_channel as enum ('in_app', 'sms', 'voice');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'skipped' is a first-class outcome, not a failure: it records that
  -- we deliberately did not contact someone (no phone, no consent, no
  -- SMS provider configured). Silence needs a reason attached.
  create type delivery_status as enum ('queued', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sos_recipient_kind as enum ('emergency_contact', 'asha', 'hospital', 'self');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_status as enum ('pending', 'processing', 'complete', 'unreadable', 'failed');
exception when duplicate_object then null; end $$;

-- A photograph of a handwritten prescription is often simply not legible.
-- That outcome deserves its own state: recording it as 'complete' would
-- claim a reading that does not exist, and recording it as 'failed' would
-- blame the software for what is actually a blurry photo the user can
-- retake. Added separately as well so a database created before this line
-- existed picks the value up on a re-run.
alter type scan_status add value if not exists 'unreadable';


-- =====================================================================
-- SECTION 1 — Reference lookups for the NHA dataset
-- =====================================================================

-- The scrape carries stateCode / districtCode as bare integers and no
-- names at all. These two tables are what turn 27 into 'Maharashtra'.
create table if not exists public.ref_states (
  code       int primary key,
  name       text not null,
  short_code text,
  source     text,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_districts (
  code       int primary key,
  state_code int not null references public.ref_states(code) on delete cascade,
  name       text not null,
  source     text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ref_districts_state
  on public.ref_districts (state_code, name);

create table if not exists public.ref_specialities (
  code       text primary key,          -- '100005'
  name       text not null,             -- 'General Surgery'
  short_code text,                      -- 'GS'
  sort_order int,
  created_at timestamptz not null default now()
);

comment on table public.ref_districts is
  'District names are fetched from the NHA district list at import time. '
  'When that lookup is unavailable the hospital keeps its numeric code and '
  'district_name stays null — the UI must then omit the district rather '
  'than guess one.';


-- =====================================================================
-- SECTION 2 — hospitals (PMJAY empanelled registry)
-- =====================================================================

create table if not exists public.hospitals (
  id              uuid primary key default gen_random_uuid(),

  -- Natural keys from the source. facility_id is what makes the import
  -- idempotent: re-running it updates rows instead of duplicating them.
  facility_id     text not null unique,          -- 'HOSP27P26277430'
  hospital_id     bigint unique,                 -- 277430
  hfr_id          text,                          -- 'IN2710026947'

  name            text not null,
  address         text,

  -- Present in the source schema but empty in every one of the 39,526
  -- rows. Kept so a future import can fill them; the API must never
  -- offer city or pincode search while they are null.
  city            text,
  pincode         text,

  phone           text,
  mobile          text,
  email           text,
  website         text,

  -- 'G' government, 'P' private, 'PP' public-private.
  type_code       text check (type_code is null or type_code in ('G','P','PP')),
  ownership_sub_type text,                       -- 'Medical College Hospital'
  facility_type   text,                          -- 'Hospital', 'Clinic', ...

  scheme_code     text,                          -- 'PMJAY' for all current rows
  speciality_codes text[] not null default '{}',

  state_code      int references public.ref_states(code) on delete set null,
  district_code   int references public.ref_districts(code) on delete set null,
  -- Denormalised at import so a nearby-search result needs no joins.
  state_name      text,
  district_name   text,

  latitude        double precision check (latitude is null or latitude between -90 and 90),
  longitude       double precision check (longitude is null or longitude between -180 and 180),
  -- False when the source had no usable coordinate, or one that fell
  -- outside India. Such a hospital is findable by name and district but
  -- must never appear in a distance-sorted list.
  geo_usable      boolean not null default false,

  nabh_accredited boolean,
  empanelment_status text,
  deempanel_status   text,
  empaneled_date  timestamptz,
  establishment_year date,

  nodal_officer_name  text,
  nodal_officer_phone text,

  -- This registry is an official dataset, so rows import as 'verified'
  -- with the source string the UI prints verbatim. Contact numbers are
  -- a separate matter: see contact_verified below.
  verification    verification_state not null default 'verified',
  source          text not null default 'National Health Authority — PMJAY empanelled hospital registry',
  source_url      text default 'https://hem.nha.gov.in/search',
  verified_at     timestamptz,

  -- The listing is official; the phone number in it is not independently
  -- checked. Anything that dials or texts this row must treat an
  -- unverified number as unverified.
  contact_verified boolean not null default false,

  active          boolean not null default true,
  imported_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Bounding-box prefilter for the nearby search. Latitude leads because
-- the query always constrains it to a narrow band.
create index if not exists idx_hospitals_geo
  on public.hospitals (latitude, longitude)
  where geo_usable;

create index if not exists idx_hospitals_district
  on public.hospitals (state_code, district_code);

create index if not exists idx_hospitals_type
  on public.hospitals (type_code) where active;

create index if not exists idx_hospitals_specialities
  on public.hospitals using gin (speciality_codes);

-- Name search without requiring pg_trgm.
create index if not exists idx_hospitals_name_lower
  on public.hospitals (lower(name));

comment on column public.hospitals.geo_usable is
  'True only when latitude and longitude parsed and fell inside India. '
  '1,492 of the 39,526 source rows have no coordinate and 21 fall outside '
  'the country; those are excluded from distance search by construction.';


-- =====================================================================
-- SECTION 3 — villages, and who belongs to them
-- =====================================================================

create table if not exists public.villages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  block         text,
  district      text,
  state         text,
  district_code int references public.ref_districts(code) on delete set null,
  state_code    int references public.ref_states(code) on delete set null,
  lgd_code      text,                    -- Local Government Directory code, when known
  latitude      double precision check (latitude is null or latitude between -90 and 90),
  longitude     double precision check (longitude is null or longitude between -180 and 180),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Case- and whitespace-insensitive identity. This is the constraint that
-- stops 'Shyampur' and 'shyampur ' becoming two audiences.
create unique index if not exists uq_villages_identity
  on public.villages (
    lower(btrim(name)),
    lower(coalesce(btrim(block), '')),
    lower(coalesce(btrim(district), '')),
    lower(coalesce(btrim(state), ''))
  );

-- Additive: the existing free-text profiles.village stays for display,
-- village_id carries the relationship that fan-out depends on.
alter table public.profiles
  add column if not exists village_id uuid;

alter table public.profiles
  drop constraint if exists profiles_village_id_fkey;
alter table public.profiles
  add constraint profiles_village_id_fkey
  foreign key (village_id) references public.villages(id) on delete set null;

create index if not exists idx_profiles_village on public.profiles (village_id);

-- An ASHA serves one or more villages. asha_profiles.villages (text[])
-- remains for display; this junction is the enforceable relationship.
create table if not exists public.asha_villages (
  asha_user_id uuid not null references public.profiles(id) on delete cascade,
  village_id   uuid not null references public.villages(id) on delete cascade,
  is_primary   boolean not null default false,
  assigned_at  timestamptz not null default now(),
  primary key (asha_user_id, village_id)
);

create index if not exists idx_asha_villages_village
  on public.asha_villages (village_id);

comment on table public.asha_villages is
  'The join that answers both directions: which villages does this worker '
  'cover, and which worker do I contact for this village.';


-- =====================================================================
-- SECTION 4 — ASHA identity: roster, invite codes, approval queue
-- =====================================================================

-- What the block office issued. Populated by an admin upload, never by
-- the person registering.
create table if not exists public.asha_roster (
  id            uuid primary key default gen_random_uuid(),
  asha_code     text not null unique,          -- official worker code
  full_name     text not null,
  phone         text,
  block         text,
  sub_centre    text,
  district      text,
  state         text,
  village_names text[] not null default '{}',
  supervisor_name  text,
  supervisor_phone text,

  -- bcrypt hash via pgcrypto's crypt(). The plaintext code is shown to
  -- the admin once at issue time and is not recoverable from this row.
  invite_code_hash text,
  code_issued_at   timestamptz,
  code_expires_at  timestamptz,

  -- Set when a worker successfully claims this row. The partial unique
  -- index below is what makes a code single-use.
  claimed_by    uuid references public.profiles(id) on delete set null,
  claimed_at    timestamptz,

  active        boolean not null default true,
  source        text,                          -- 'block office roster 2026-08'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One roster row can be claimed by at most one account, and one account
-- can claim at most one roster row.
create unique index if not exists uq_asha_roster_claimed_by
  on public.asha_roster (claimed_by) where claimed_by is not null;

create index if not exists idx_asha_roster_lookup
  on public.asha_roster (lower(asha_code)) where active;

comment on table public.asha_roster is
  'Service-role only. No RLS policy grants any authenticated user read '
  'access, because reading this table plus a guessable code would be '
  'enough to impersonate a health worker.';

-- For a worker who is genuinely an ASHA but is not on the uploaded
-- roster. Lands in a queue an admin works through.
create table if not exists public.asha_registration_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  full_name      text not null,
  phone          text not null,
  asha_code_claimed text,
  village_name   text not null,
  block          text,
  district       text,
  state          text,
  sub_centre     text,
  supervisor_name  text,
  supervisor_phone text,
  -- Supabase Storage object path. Not a public URL.
  id_proof_path  text,
  note           text,

  status         request_status not null default 'pending',
  reviewed_by    uuid references public.profiles(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One open request per person; rejected ones do not block a resubmission.
create unique index if not exists uq_asha_request_open
  on public.asha_registration_requests (user_id) where status = 'pending';

create index if not exists idx_asha_requests_queue
  on public.asha_registration_requests (status, created_at);


-- =====================================================================
-- SECTION 5 — emergency contacts
-- =====================================================================

create table if not exists public.emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  phone        text not null check (phone ~ '^[0-9+][0-9 \-]{6,17}$'),
  relationship text,
  -- Lower number is contacted first.
  priority     int not null default 1 check (priority between 1 and 10),
  notify_sms   boolean not null default true,
  notify_voice boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, phone)
);

create index if not exists idx_emergency_contacts_user
  on public.emergency_contacts (user_id, priority);


-- =====================================================================
-- SECTION 6 — notifications (ASHA to village fan-out)
-- =====================================================================

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  audience      notification_audience not null default 'village',

  -- Exactly one target must match the audience. Enforced below.
  village_id    uuid references public.villages(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,

  title         text not null,
  body          text not null,
  category      text,                   -- 'scheme' | 'camp' | 'advisory' | 'eligibility'
  severity      alert_severity not null default 'low',
  language      text not null default 'English',

  -- When the notification is about a scheme, link it so the user can
  -- open the real record rather than re-reading prose.
  scheme_id     uuid references public.schemes(id) on delete set null,
  camp_id       uuid references public.health_camps(id) on delete set null,

  verification  verification_state not null default 'unverified',
  source        text,

  published_at  timestamptz not null default now(),
  expires_at    timestamptz,
  recipient_count int not null default 0 check (recipient_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint notifications_target_matches_audience check (
    (audience = 'village' and village_id is not null and target_user_id is null) or
    (audience = 'user'    and target_user_id is not null and village_id is null) or
    (audience = 'all'     and village_id is null and target_user_id is null)
  )
);

create index if not exists idx_notifications_village
  on public.notifications (village_id, published_at desc);

-- One row per person told. Materialised at send time so that read state
-- and delivery state are per-recipient and auditable.
create table if not exists public.notification_recipients (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (notification_id, user_id)
);

-- Drives the unread badge.
create index if not exists idx_notif_recipients_unread
  on public.notification_recipients (user_id, read_at, created_at desc);


-- =====================================================================
-- SECTION 7 — direct messaging between a citizen and their ASHA
-- =====================================================================

create table if not exists public.message_threads (
  id            uuid primary key default gen_random_uuid(),
  citizen_id    uuid not null references public.profiles(id) on delete cascade,
  asha_id       uuid not null references public.profiles(id) on delete cascade,
  village_id    uuid references public.villages(id) on delete set null,
  subject       text,
  last_message_at timestamptz not null default now(),
  closed        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (citizen_id, asha_id),
  constraint message_threads_distinct_parties check (citizen_id <> asha_id)
);

create index if not exists idx_threads_citizen
  on public.message_threads (citizen_id, last_message_at desc);
create index if not exists idx_threads_asha
  on public.message_threads (asha_id, last_message_at desc);

create table if not exists public.thread_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.message_threads(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (btrim(body) <> ''),
  attachment_path text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_thread_messages_thread
  on public.thread_messages (thread_id, created_at);

-- Keep the thread's ordering column current so the inbox sorts without
-- a subquery.
create or replace function public.touch_thread_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.message_threads
     set last_message_at = new.created_at,
         updated_at      = now()
   where id = new.thread_id;
  return new;
end $$;

drop trigger if exists trg_touch_thread on public.thread_messages;
create trigger trg_touch_thread
  after insert on public.thread_messages
  for each row execute function public.touch_thread_on_message();


-- =====================================================================
-- SECTION 8 — SOS broadcast
-- =====================================================================

create table if not exists public.sos_broadcasts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,

  patient_name  text not null,
  contact_phone text not null,
  category      text not null,           -- 'Severe chest pain / heart attack'
  symptoms      text,

  latitude      double precision check (latitude is null or latitude between -90 and 90),
  longitude     double precision check (longitude is null or longitude between -180 and 180),
  accuracy_m    numeric(8,1),
  location_note text,
  village_id    uuid references public.villages(id) on delete set null,

  -- Snapshot of what we found and told the operator. The registry moves;
  -- the record of what was said must not.
  nearest_hospitals jsonb not null default '[]'::jsonb,

  status        sos_status not null default 'open',
  alert_id      uuid references public.asha_alerts(id) on delete set null,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at   timestamptz,
  outcome       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_sos_user on public.sos_broadcasts (user_id, created_at desc);
create index if not exists idx_sos_open
  on public.sos_broadcasts (status, created_at desc) where status = 'open';

-- One row per attempted contact, per channel. A failed SMS is as
-- important to record as a successful one.
create table if not exists public.sos_deliveries (
  id             uuid primary key default gen_random_uuid(),
  sos_id         uuid not null references public.sos_broadcasts(id) on delete cascade,
  channel        delivery_channel not null,
  recipient_kind sos_recipient_kind not null,
  recipient_name text,
  recipient_phone text,
  recipient_user_id uuid references public.profiles(id) on delete set null,
  hospital_id    uuid references public.hospitals(id) on delete set null,
  status         delivery_status not null default 'queued',
  provider       text,                   -- 'twilio' | 'in_app'
  provider_message_id text,
  -- On 'skipped' this holds the reason. Never left null for a non-sent row.
  error          text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_sos_deliveries_sos
  on public.sos_deliveries (sos_id, channel, status);


-- =====================================================================
-- SECTION 9 — prescription scans
-- =====================================================================

create table if not exists public.prescription_scans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Storage object path in a private bucket, not a public URL.
  image_path   text,
  language     text not null default 'English',
  model        text,
  status       scan_status not null default 'pending',

  -- Structured reading: medicines, dosage, timing, purpose, cautions.
  extracted    jsonb not null default '{}'::jsonb,
  summary      text,

  -- A model read this image. It is never 'verified', and the UI must
  -- stamp it accordingly and repeat that it is not a diagnosis.
  verification verification_state not null default 'inferred',
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_scans_user
  on public.prescription_scans (user_id, created_at desc);

alter table public.prescription_scans
  drop constraint if exists prescription_scans_never_verified;
alter table public.prescription_scans
  add constraint prescription_scans_never_verified
  check (verification <> 'verified');


-- =====================================================================
-- SECTION 10 — let a referral point at a PMJAY hospital
-- =====================================================================

alter table public.referrals
  add column if not exists hospital_id uuid;

alter table public.referrals
  drop constraint if exists referrals_hospital_id_fkey;
alter table public.referrals
  add constraint referrals_hospital_id_fkey
  foreign key (hospital_id) references public.hospitals(id) on delete set null;


-- =====================================================================
-- SECTION 11 — nearby search
-- =====================================================================

-- Haversine over a bounding-box prefilter. Deliberately no PostGIS and
-- no earthdistance: at 39,526 rows the box narrows the candidate set to
-- a few hundred and the trigonometry is cheap, and this way the schema
-- has no extension prerequisite beyond pgcrypto.
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
set search_path = public
as $$
  with bounds as (
    select
      greatest(p_radius_km, 0.1) / 111.045                              as d_lat,
      -- Longitude degrees shrink with latitude; guard the pole case so
      -- cos() never reaches zero.
      greatest(p_radius_km, 0.1) /
        (111.045 * greatest(cos(radians(least(abs(p_lat), 89.5))), 0.01)) as d_lng
  )
  select
    h.id, h.facility_id, h.name, h.address, h.phone, h.mobile,
    h.type_code, h.ownership_sub_type, h.facility_type, h.speciality_codes,
    h.state_name, h.district_name, h.latitude, h.longitude,
    round(
      (6371 * 2 * asin(
        sqrt(
          power(sin(radians(h.latitude - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(h.latitude)) *
          power(sin(radians(h.longitude - p_lng) / 2), 2)
        )
      ))::numeric, 2
    )::double precision as distance_km,
    h.contact_verified, h.verification, h.source, h.source_url
  from public.hospitals h, bounds b
  where h.active
    and h.geo_usable
    and h.latitude  between p_lat - b.d_lat and p_lat + b.d_lat
    and h.longitude between p_lng - b.d_lng and p_lng + b.d_lng
    and (p_type is null or h.type_code = p_type)
    and (p_speciality is null or h.speciality_codes @> array[p_speciality])
    -- Re-check the true great-circle distance: the box is a square, the
    -- radius is a circle.
    and (6371 * 2 * asin(
          sqrt(
            power(sin(radians(h.latitude - p_lat) / 2), 2) +
            cos(radians(p_lat)) * cos(radians(h.latitude)) *
            power(sin(radians(h.longitude - p_lng) / 2), 2)
          )
        )) <= greatest(p_radius_km, 0.1)
  order by distance_km asc, h.name asc
  limit greatest(least(coalesce(p_limit, 20), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.hospitals_nearby is
  'Distance-sorted PMJAY hospitals within a radius. Returns zero rows '
  'rather than widening the search: an empty result is a truthful answer '
  'and the caller is expected to say so.';

-- Which ASHA covers a village. Used by SOS routing, notification
-- authoring, and the "contact your ASHA" card.
create or replace function public.asha_for_village(p_village_id uuid)
returns table (
  asha_user_id uuid,
  full_name    text,
  phone        text,
  asha_code    text,
  sub_centre   text,
  is_primary   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.phone, ap.asha_code, ap.sub_centre, av.is_primary
  from public.asha_villages av
  join public.profiles p       on p.id = av.asha_user_id
  left join public.asha_profiles ap on ap.user_id = p.id
  where av.village_id = p_village_id
    and p.role = 'asha'
    and coalesce(ap.active, true)
  order by av.is_primary desc, p.full_name asc
$$;

comment on function public.asha_for_village is
  'security definer on purpose: a citizen must be able to see the name and '
  'phone of the worker covering their village without being granted read '
  'access to the profiles table at large.';


-- =====================================================================
-- SECTION 12 — updated_at triggers for the new tables
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'hospitals', 'villages', 'asha_roster', 'asha_registration_requests',
    'emergency_contacts', 'notifications', 'message_threads',
    'sos_broadcasts', 'sos_deliveries', 'prescription_scans'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
