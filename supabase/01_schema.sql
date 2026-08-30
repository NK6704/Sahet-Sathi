-- =====================================================================
-- Sehat Sathi — schema
-- Run this first, in the Supabase SQL editor.
--
-- Design rules that this file enforces:
--   1. Every row that belongs to a person carries that person's
--      auth.uid() so RLS can reason about it.
--   2. Reference data (facilities, schemes, camps) carries a
--      verification stamp. The UI is not allowed to show anything as
--      confirmed unless the row says it is.
--   3. Nothing is hard-deleted. Referrals cancel; facilities go
--      inactive. A field record you can silently lose is worse than
--      no record.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('citizen', 'asha', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  -- The seven states from the brief, in the order a referral moves
  -- through them. 'cancelled' is terminal and reachable from anywhere.
  create type referral_status as enum (
    'pending', 'acknowledged', 'contacted', 'referred',
    'in_progress', 'resolved', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_severity as enum ('low', 'moderate', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type alert_status as enum ('new', 'acknowledged', 'actioned', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'verified' means a human or an official dataset confirmed it.
  -- 'inferred' means a model produced it. The two must never be
  -- rendered the same way.
  create type verification_state as enum ('verified', 'inferred', 'unverified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type facility_kind as enum (
    'sub_centre', 'phc', 'chc', 'district_hospital',
    'medical_college', 'private_clinic', 'pharmacy', 'diagnostic_lab'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- profiles — one row per auth user, created by trigger
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null default 'citizen',
  full_name     text,
  phone         text,
  language      text not null default 'Hindi',
  age           int check (age is null or (age between 0 and 130)),
  gender        text,
  state         text,
  district      text,
  village       text,
  pincode       text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  annual_income numeric(12,2),
  category      text,             -- General / OBC / SC / ST
  has_abha      boolean not null default false,
  consent_data  boolean not null default false,
  consent_voice boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.role is
  'Authoritative role. Never trust a role sent from the client.';

-- ---------------------------------------------------------------------
-- asha_profiles — the extra fields an ASHA worker carries
-- ---------------------------------------------------------------------
create table if not exists public.asha_profiles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references public.profiles(id) on delete cascade,
  asha_code      text not null unique,
  block          text,
  sub_centre     text,
  villages       text[] not null default '{}',
  households     int not null default 0 check (households >= 0),
  supervisor_name  text,
  supervisor_phone text,
  phc_facility_id  uuid,
  active         boolean not null default true,
  joined_on      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- healthcare_facilities — reference data, read-mostly
-- ---------------------------------------------------------------------
create table if not exists public.healthcare_facilities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          facility_kind not null,
  address       text,
  village       text,
  block         text,
  district      text,
  state         text,
  pincode       text,
  latitude      double precision check (latitude between -90 and 90),
  longitude     double precision check (longitude between -180 and 180),
  phone         text,
  open_24x7     boolean not null default false,
  services      text[] not null default '{}',
  has_ambulance boolean not null default false,
  verification  verification_state not null default 'unverified',
  source        text,               -- e.g. 'NHM facility registry 2025'
  source_url    text,
  verified_at   timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.healthcare_facilities.source is
  'Shown to the user verbatim. A facility with no source cannot be stamped verified.';

alter table public.asha_profiles
  drop constraint if exists asha_profiles_phc_facility_id_fkey;
alter table public.asha_profiles
  add constraint asha_profiles_phc_facility_id_fkey
  foreign key (phc_facility_id) references public.healthcare_facilities(id) on delete set null;

create index if not exists idx_facilities_geo on public.healthcare_facilities (latitude, longitude);
create index if not exists idx_facilities_district on public.healthcare_facilities (state, district);

-- ---------------------------------------------------------------------
-- schemes + scheme_benefits
-- ---------------------------------------------------------------------
create table if not exists public.schemes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,      -- 'pmjay', 'jsy', ...
  name           text not null,
  name_hi        text,
  short_desc     text,
  full_desc      text,
  ministry       text,
  category       text,                      -- maternal / insurance / nutrition
  benefit_amount numeric(12,2),
  benefit_summary text,
  eligibility_rules jsonb not null default '{}'::jsonb,
  documents      text[] not null default '{}',
  how_to_apply   text,
  official_url   text,
  helpline       text,
  verification   verification_state not null default 'unverified',
  source         text,
  verified_at    timestamptz,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.schemes.eligibility_rules is
  'Machine-checkable criteria. The backend evaluates these; the model only phrases the result.';

create table if not exists public.scheme_benefits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  scheme_id    uuid not null references public.schemes(id) on delete cascade,
  status       text not null default 'saved'
               check (status in ('saved','applied','documents_pending','approved','received','rejected')),
  applied_on   date,
  amount_received numeric(12,2),
  reference_no text,
  notes        text,
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, scheme_id)
);

-- ---------------------------------------------------------------------
-- health_camps — only verified camps are ever displayed
-- ---------------------------------------------------------------------
create table if not exists public.health_camps (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  camp_date     date not null,
  start_time    time,
  end_time      time,
  venue         text,
  village       text,
  block         text,
  district      text,
  state         text,
  organiser     text,
  services      text[] not null default '{}',
  facility_id   uuid references public.healthcare_facilities(id) on delete set null,
  contact_phone text,
  verification  verification_state not null default 'unverified',
  source        text,
  verified_at   timestamptz,
  cancelled     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_camps_date on public.health_camps (camp_date);

-- ---------------------------------------------------------------------
-- asha_alerts — what needs the worker's attention today
-- ---------------------------------------------------------------------
create table if not exists public.asha_alerts (
  id            uuid primary key default gen_random_uuid(),
  asha_id       uuid not null references public.profiles(id) on delete cascade,
  citizen_id    uuid references public.profiles(id) on delete set null,
  -- Denormalised so an alert stays readable even if the citizen row
  -- is removed. Field records must not evaporate.
  citizen_name  text,
  citizen_phone text,
  village       text,
  title         text not null,
  body          text,
  category      text,                       -- maternal / child / emergency
  severity      alert_severity not null default 'moderate',
  status        alert_status not null default 'new',
  source        text,                       -- 'emergency_button' | 'assistant' | 'manual'
  conversation_id uuid,
  acknowledged_at timestamptz,
  closed_at     timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_alerts_asha_status
  on public.asha_alerts (asha_id, status, severity desc, created_at desc);

-- ---------------------------------------------------------------------
-- referrals — the ASHA worker's core record
-- ---------------------------------------------------------------------
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  asha_id        uuid not null references public.profiles(id) on delete restrict,
  citizen_id     uuid references public.profiles(id) on delete set null,
  patient_name   text not null,
  patient_age    int check (patient_age is null or patient_age between 0 and 130),
  patient_gender text,
  patient_phone  text,
  village        text,
  reason         text not null,
  symptoms       text,
  urgency        alert_severity not null default 'moderate',
  facility_id    uuid references public.healthcare_facilities(id) on delete set null,
  facility_name  text,
  status         referral_status not null default 'pending',
  alert_id       uuid references public.asha_alerts(id) on delete set null,
  referred_on    date not null default current_date,
  visited_on     date,
  outcome        text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_referrals_asha
  on public.referrals (asha_id, status, created_at desc);

-- Every status change is recorded. "When did this move?" is the
-- question a supervisor always asks.
create table if not exists public.referral_events (
  id          uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  from_status referral_status,
  to_status   referral_status not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- conversations + messages
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text,
  language   text not null default 'Hindi',
  channel    text not null default 'voice' check (channel in ('voice','text','image')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  -- Which stamp the UI must render for this message.
  verification    verification_state not null default 'inferred',
  sources         jsonb not null default '[]'::jsonb,
  audio_url       text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_messages_conv on public.messages (conversation_id, created_at);

alter table public.asha_alerts
  drop constraint if exists asha_alerts_conversation_id_fkey;
alter table public.asha_alerts
  add constraint asha_alerts_conversation_id_fkey
  foreign key (conversation_id) references public.conversations(id) on delete set null;

-- ---------------------------------------------------------------------
-- audit_logs — append-only
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  user_role,
  action      text not null,          -- 'referral.status_changed'
  entity      text not null,          -- 'referrals'
  entity_id   text,
  subject_id  uuid,                   -- whose data was touched
  detail      jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_actor on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','asha_profiles','healthcare_facilities','schemes',
    'scheme_benefits','health_camps','asha_alerts','referrals','conversations'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- A profile row for every new auth user. Role comes from signup
-- metadata but is clamped: nobody self-assigns 'admin'.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare requested text;
begin
  requested := coalesce(new.raw_user_meta_data->>'role', 'citizen');
  if requested not in ('citizen', 'asha') then
    requested := 'citizen';
  end if;

  insert into public.profiles (id, role, full_name, phone, language)
  values (
    new.id,
    requested::user_role,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), new.phone),
    coalesce(nullif(new.raw_user_meta_data->>'language', ''), 'Hindi')
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Referral status changes write their own history + audit row.
create or replace function public.log_referral_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.referral_events (referral_id, from_status, to_status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), new.notes);

    insert into public.audit_logs (actor_id, action, entity, entity_id, subject_id, detail)
    values (
      auth.uid(), 'referral.status_changed', 'referrals', new.id::text, new.citizen_id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_referral_status on public.referrals;
create trigger trg_referral_status
  after update on public.referrals
  for each row execute function public.log_referral_status();
