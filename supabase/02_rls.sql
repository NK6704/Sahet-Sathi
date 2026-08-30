-- =====================================================================
-- Sehat Sathi — Row Level Security
-- Run after 01_schema.sql.
--
-- The rule the brief states and this file enforces:
--   "A normal user must never reach ASHA-only pages by changing the
--    URL." Hiding the route in React is cosmetic. This is the part
--    that actually holds, because it holds even if someone talks to
--    the REST endpoint directly with a valid citizen token.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers.
--
-- SECURITY DEFINER on purpose: a policy on `profiles` that itself
-- selects from `profiles` recurses forever. These run as owner, so
-- they read the table without re-entering RLS.
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_asha()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('asha','admin'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- An ASHA worker may see a citizen's data only where a record already
-- links them: an alert routed to her, or a referral she raised. There
-- is no "browse all citizens" capability, by design.
create or replace function public.asha_serves(citizen uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.asha_alerts a
     where a.asha_id = auth.uid() and a.citizen_id = citizen
  ) or exists (
    select 1 from public.referrals r
     where r.asha_id = auth.uid() and r.citizen_id = citizen
  );
$$;

revoke all on function public.my_role()          from anon;
revoke all on function public.asha_serves(uuid)  from anon;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere. No table is left open.
-- ---------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.asha_profiles         enable row level security;
alter table public.healthcare_facilities enable row level security;
alter table public.schemes               enable row level security;
alter table public.scheme_benefits       enable row level security;
alter table public.health_camps          enable row level security;
alter table public.asha_alerts           enable row level security;
alter table public.referrals             enable row level security;
alter table public.referral_events       enable row level security;
alter table public.conversations         enable row level security;
alter table public.messages              enable row level security;
alter table public.audit_logs            enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.asha_serves(id) or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Deliberately no INSERT policy: rows arrive only via the
-- on_auth_user_created trigger. And no DELETE: removing an account
-- goes through auth.users.

-- Role escalation guard. The UPDATE policy above would otherwise let
-- a citizen set their own role to 'asha' and walk straight into the
-- portal. This is the single most important trigger in the file.
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role cannot be changed by the account holder';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_role on public.profiles;
create trigger trg_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------------------------------------------------------------------
-- asha_profiles
-- ---------------------------------------------------------------------
drop policy if exists asha_profiles_select on public.asha_profiles;
create policy asha_profiles_select on public.asha_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists asha_profiles_update on public.asha_profiles;
create policy asha_profiles_update on public.asha_profiles
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists asha_profiles_insert on public.asha_profiles;
create policy asha_profiles_insert on public.asha_profiles
  for insert to authenticated
  with check ((user_id = auth.uid() and public.is_asha()) or public.is_admin());

-- ---------------------------------------------------------------------
-- Reference data: read by anyone, written by nobody but admins.
--
-- Readable by `anon` too, because the landing page answers "where is
-- the nearest hospital" before a user has signed in.
-- ---------------------------------------------------------------------
drop policy if exists facilities_read on public.healthcare_facilities;
create policy facilities_read on public.healthcare_facilities
  for select to anon, authenticated using (active);

drop policy if exists facilities_write on public.healthcare_facilities;
create policy facilities_write on public.healthcare_facilities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists schemes_read on public.schemes;
create policy schemes_read on public.schemes
  for select to anon, authenticated using (active);

drop policy if exists schemes_write on public.schemes;
create policy schemes_write on public.schemes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Only verified, uncancelled camps are visible. The brief is explicit:
-- show "No verified health camps found." rather than anything softer.
drop policy if exists camps_read on public.health_camps;
create policy camps_read on public.health_camps
  for select to anon, authenticated
  using (verification = 'verified' and not cancelled);

drop policy if exists camps_write on public.health_camps;
create policy camps_write on public.health_camps
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- scheme_benefits
-- ---------------------------------------------------------------------
drop policy if exists benefits_select on public.scheme_benefits;
create policy benefits_select on public.scheme_benefits
  for select to authenticated
  using (user_id = auth.uid() or public.asha_serves(user_id) or public.is_admin());

drop policy if exists benefits_insert on public.scheme_benefits;
create policy benefits_insert on public.scheme_benefits
  for insert to authenticated
  with check (user_id = auth.uid() or public.asha_serves(user_id) or public.is_admin());

drop policy if exists benefits_update on public.scheme_benefits;
create policy benefits_update on public.scheme_benefits
  for update to authenticated
  using (user_id = auth.uid() or public.asha_serves(user_id) or public.is_admin())
  with check (user_id = auth.uid() or public.asha_serves(user_id) or public.is_admin());

drop policy if exists benefits_delete on public.scheme_benefits;
create policy benefits_delete on public.scheme_benefits
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- asha_alerts — scoped to the assigned worker
-- ---------------------------------------------------------------------
drop policy if exists alerts_select on public.asha_alerts;
create policy alerts_select on public.asha_alerts
  for select to authenticated
  using (asha_id = auth.uid() or citizen_id = auth.uid() or public.is_admin());

drop policy if exists alerts_insert on public.asha_alerts;
create policy alerts_insert on public.asha_alerts
  for insert to authenticated
  with check (
    -- A citizen may raise an alert about themselves (the emergency
    -- button). An ASHA worker may log one for a household she serves.
    (citizen_id = auth.uid())
    or (asha_id = auth.uid() and public.is_asha())
    or public.is_admin()
  );

-- Only the assigned worker moves an alert along. Note the absence of
-- any DELETE policy: alerts close, they do not disappear.
drop policy if exists alerts_update on public.asha_alerts;
create policy alerts_update on public.asha_alerts
  for update to authenticated
  using (asha_id = auth.uid() or public.is_admin())
  with check (asha_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- referrals
-- ---------------------------------------------------------------------
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select to authenticated
  using (asha_id = auth.uid() or citizen_id = auth.uid() or public.is_admin());

drop policy if exists referrals_insert on public.referrals;
create policy referrals_insert on public.referrals
  for insert to authenticated
  with check (asha_id = auth.uid() and public.is_asha());

drop policy if exists referrals_update on public.referrals;
create policy referrals_update on public.referrals
  for update to authenticated
  using (asha_id = auth.uid() or public.is_admin())
  with check (asha_id = auth.uid() or public.is_admin());

drop policy if exists referral_events_select on public.referral_events;
create policy referral_events_select on public.referral_events
  for select to authenticated
  using (exists (
    select 1 from public.referrals r
     where r.id = referral_id
       and (r.asha_id = auth.uid() or r.citizen_id = auth.uid() or public.is_admin())
  ));

-- ---------------------------------------------------------------------
-- conversations + messages — strictly the owner's own
-- ---------------------------------------------------------------------
drop policy if exists conversations_own on public.conversations;
create policy conversations_own on public.conversations
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_own on public.messages;
create policy messages_own on public.messages
  for all to authenticated
  using (exists (
    select 1 from public.conversations c
     where c.id = conversation_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.conversations c
     where c.id = conversation_id and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------
-- audit_logs — append-only, never client-readable
--
-- No SELECT policy at all: with RLS on and no policy, reads return
-- nothing. Logs are read with the service role, server-side.
-- ---------------------------------------------------------------------
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs
  for insert to authenticated
  with check (actor_id = auth.uid());

-- Belt and braces: revoke the grants that would let a client mutate
-- history even if a policy were added by mistake later.
revoke update, delete on public.audit_logs from authenticated, anon;
revoke delete on public.referrals, public.asha_alerts from authenticated, anon;
