-- =====================================================================
-- 10_profile_village.sql
--
-- Fixes the break that made a registered ASHA worker invisible to the
-- households she covers, and stopped notifications flowing in either
-- direction.
--
-- Run order: 01 → 02 → 03 → 04(optional) → 05 → 06 → 07 → 08 → 09 → 10.
-- Everything here is ADDITIVE and IDEMPOTENT. Re-running it is safe.
--
-- ---------------------------------------------------------------------
-- What was actually wrong
-- ---------------------------------------------------------------------
-- Every link between a citizen and her ASHA worker is keyed on
-- public.profiles.village_id:
--
--   · GET /api/asha/contact       → asha_for_village(profiles.village_id)
--   · POST /api/messages/threads  → threads_insert → asha_covers_citizen()
--                                   → joins asha_villages on profiles.village_id
--   · the village broadcast       → select id from profiles
--                                     where village_id = <village>
--   · SOS routing to a worker     → asha_for_village(profiles.village_id)
--
-- 08_asha_claim.sql sets village_id correctly — but only on the ASHA
-- worker's own row. On the citizen side nothing ever set it, because the
-- old PATCH /api/profile handler wrote to a JavaScript object in the
-- server process and never touched this table at all. So every citizen's
-- village_id stayed null for ever, and all four paths above silently took
-- their "we don't know your village" branch. The app was not broken in
-- the sense of throwing errors; it answered honestly about a fact that
-- nothing was ever going to establish.
--
-- Two things were needed and both are here: somewhere to put what the
-- citizen types, and a way to turn the village NAME she types into the
-- villages row her worker is actually mapped to.
--
-- ---------------------------------------------------------------------
-- The part that is easy to get wrong
-- ---------------------------------------------------------------------
-- uq_villages_identity in 05_platform.sql treats a village as
-- (name, block, district, state). An ASHA registering from the roster
-- supplies all four. A citizen filling in her details supplies a name and
-- usually a district, and has no idea what her block is called.
--
-- Resolving her text with the same four-part key would therefore create a
-- SECOND villages row — same name, empty block — and she would end up in
-- a village of one with no worker mapped to it. The contact card would
-- say "no ASHA worker is mapped to your village", which is a true
-- statement about the wrong village, and the hardest kind of bug to
-- notice. resolve_village() below exists to prevent exactly that.
-- =====================================================================


-- =====================================================================
-- SECTION 1 — the columns the citizen profile form actually writes
-- =====================================================================

-- These were being sent by src/pages/Profile.jsx and src/pages/Onboarding.jsx
-- and accepted by a handler that discarded them. `block` is new: it is
-- what disambiguates two villages of the same name in one district, and
-- it is optional everywhere.
alter table public.profiles
  add column if not exists block                    text,
  add column if not exists ration_card_type         text,
  add column if not exists family_members           int,
  add column if not exists is_pregnant_or_lactating boolean,
  add column if not exists chronic_conditions       text[] not null default '{}',
  add column if not exists consents                 jsonb  not null default '{}'::jsonb,
  add column if not exists saved_schemes            text[] not null default '{}';

-- A household size of zero is not a household, and a negative one is a
-- typo. Left nullable because "not told us yet" has to stay expressible.
do $$ begin
  alter table public.profiles
    add constraint profiles_family_members_sane
    check (family_members is null or family_members between 1 and 60);
exception when duplicate_object then null; end $$;

comment on column public.profiles.block is
  'Administrative block / tehsil. Optional. Its only job is to tell two '
  'villages of the same name in one district apart when resolve_village() '
  'would otherwise report an ambiguity.';

comment on column public.profiles.ration_card_type is
  'Self-declared, and must be presented as self-declared. This app cannot '
  'see the PDS database, so a scheme check that reads this column may only '
  'ever say "may be eligible", never "you qualify".';

comment on column public.profiles.is_pregnant_or_lactating is
  'Nullable on purpose: false means "she said no", null means "never '
  'asked". The maternal-scheme suggestions must not treat the two alike.';

comment on column public.profiles.consents is
  'The consent checkboxes as given, e.g. {"voice_processing": true, '
  '"location_access": false, "health_guidance_disclaimer": true, '
  '"asha_referral_consent": false}. An absent key means never asked. '
  'consent_voice and consent_data on this table are kept in step with '
  'voice_processing and asha_referral_consent by the profile route.';

comment on column public.profiles.saved_schemes is
  'Scheme ids the person bookmarked. Held server-side so a bookmark '
  'survives clearing the browser or changing phone — the app used to keep '
  'these in localStorage only.';


-- ---------------------------------------------------------------------
-- village_id is server-set, and now the grants say so
-- ---------------------------------------------------------------------
-- profiles_update_own in 02_rls.sql lets an account update its own row,
-- and RLS cannot restrict a policy to particular columns. So as it stood,
-- any signed-in citizen could set village_id to any village's uuid with
-- one supabase-js call and thereby join that village: receive its
-- broadcasts, and open a conversation with a worker who has no duty of
-- care for her. Nothing in the app does that, but the boundary should not
-- depend on the app being the only client.
--
-- The fix is the same column-level grant pattern 06_platform_rls.sql
-- already uses for notification_recipients.read_at: revoke UPDATE on the
-- table, then grant it back column by column. village_id is left out, so
-- it can only be written by the service role or by the SECURITY DEFINER
-- claim functions in 08_asha_claim.sql. `role` is left out too — the
-- guard_role_change trigger already refused it, but a grant that refuses
-- it earlier is one less thing relying on a trigger staying installed.
revoke update on public.profiles from anon, authenticated;

grant update (
  full_name, phone, language, age, gender,
  state, district, village, block, pincode,
  annual_income, category, has_abha,
  consent_data, consent_voice, consents,
  ration_card_type, family_members, is_pregnant_or_lactating,
  chronic_conditions, saved_schemes, updated_at
) on public.profiles to authenticated;


-- =====================================================================
-- SECTION 2 — resolve_village(): village name → villages row
-- =====================================================================
--
-- Returns the id of the village a person means, how it was arrived at,
-- and how many candidates were considered. The caller is expected to show
-- the match_kind to the user when it is 'ambiguous', because at that
-- point the honest answer is a question.
--
--   'exact'     all four parts matched a row.
--   'relaxed'   the name matched exactly one row in the district, and the
--               parts one side left blank were not held against it.
--   'created'   nothing matched, so a row was made. Expected for the
--               first household in a village with no ASHA registered.
--   'ambiguous' more than one village of that name in that district and
--               nothing to choose between them. No id is returned and
--               nothing is created — guessing here would attach a
--               household to a stranger's village.
--   'blank'     no name was given.
--
-- Why 'relaxed' exists, concretely. A worker registers from the roster as
-- ('Shyampur', block 'Budhni', district 'Sehore', state 'Madhya Pradesh').
-- A household in Shyampur types the village and district and leaves block
-- empty. Exact matching would miss, create ('Shyampur', '', 'Sehore',
-- 'Madhya Pradesh'), and put her in an empty village next door to her own
-- worker. Relaxed matching treats a blank on EITHER side as "not stated"
-- rather than as a value that must be equal, so she lands on the worker's
-- row. The name still has to match exactly, and the district still has to
-- be given, so this is not fuzzy matching — it is only refusing to read a
-- blank as a claim.
create or replace function public.resolve_village(
  p_name     text,
  p_block    text default null,
  p_district text default null,
  p_state    text default null
)
returns table (
  village_id      uuid,
  match_kind      text,
  candidate_count int
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_block text := nullif(btrim(coalesce(p_block, '')), '');
  v_dist  text := nullif(btrim(coalesce(p_district, '')), '');
  v_state text := nullif(btrim(coalesce(p_state, '')), '');
  v_ids   uuid[];
  v_id    uuid;
  v_n     int;
begin
  if v_name is null then
    return query select null::uuid, 'blank'::text, 0;
    return;
  end if;

  -- 1. Exact: the same four-part key as uq_villages_identity.
  select v.id into v_id
    from public.villages v
   where lower(btrim(v.name))                    = lower(v_name)
     and lower(coalesce(btrim(v.block), ''))     = lower(coalesce(v_block, ''))
     and lower(coalesce(btrim(v.district), ''))  = lower(coalesce(v_dist,  ''))
     and lower(coalesce(btrim(v.state), ''))     = lower(coalesce(v_state, ''))
   limit 1;

  if v_id is not null then
    return query select v_id, 'exact'::text, 1;
    return;
  end if;

  -- 2. Relaxed, but only when a district was given. Without one, the name
  --    alone is not enough: there are villages called Rampur in most
  --    states of India and attaching somebody to the wrong one is worse
  --    than attaching her to none.
  if v_dist is not null then
    select array_agg(v.id) into v_ids
      from public.villages v
     where lower(btrim(v.name)) = lower(v_name)
       and (v.district is null or btrim(v.district) = ''
            or lower(btrim(v.district)) = lower(v_dist))
       and (v_state is null or v.state is null or btrim(v.state) = ''
            or lower(btrim(v.state)) = lower(v_state))
       and (v_block is null or v.block is null or btrim(v.block) = ''
            or lower(btrim(v.block)) = lower(v_block));

    v_n := coalesce(array_length(v_ids, 1), 0);

    if v_n = 1 then
      return query select v_ids[1], 'relaxed'::text, 1;
      return;
    elsif v_n > 1 then
      return query select null::uuid, 'ambiguous'::text, v_n;
      return;
    end if;
  end if;

  -- 3. Nothing matched. Make the row.
  insert into public.villages (name, block, district, state)
  values (v_name, v_block, v_dist, v_state)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Another transaction inserted the same village between the lookup
    -- and the insert. Its row is the right answer; re-read it.
    select v.id into v_id
      from public.villages v
     where lower(btrim(v.name))                   = lower(v_name)
       and lower(coalesce(btrim(v.block), ''))    = lower(coalesce(v_block, ''))
       and lower(coalesce(btrim(v.district), '')) = lower(coalesce(v_dist,  ''))
       and lower(coalesce(btrim(v.state), ''))    = lower(coalesce(v_state, ''))
     limit 1;
  end if;

  return query select v_id, 'created'::text, 1;
end $$;

comment on function public.resolve_village is
  'Maps a typed village name onto public.villages, creating the row only '
  'when nothing plausible exists and refusing to choose when two '
  'candidates are equally good. Service-role only: it can insert into a '
  'table that villages_write reserves for admins, so it is not exposed '
  'to authenticated callers.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which
-- would hand every signed-in client a way to create villages rows. Both
-- revokes are deliberate: the second is not implied by the first when a
-- grant was made to those roles directly.
revoke all on function public.resolve_village(text, text, text, text) from public;
revoke all on function public.resolve_village(text, text, text, text) from anon, authenticated;
grant execute on function public.resolve_village(text, text, text, text) to service_role;


-- =====================================================================
-- SECTION 3 — backfill anybody who already typed a village
-- =====================================================================
-- Rows whose free-text village was saved before village_id existed, or by
-- the ASHA profile editor, which writes `village` but not `village_id`.
-- Ambiguous names are left alone: the person is asked next time she saves.
do $$
declare
  r record;
  v record;
  n_linked int := 0;
  n_ambiguous int := 0;
begin
  for r in
    select id, village, block, district, state
      from public.profiles
     where village_id is null
       and coalesce(btrim(village), '') <> ''
  loop
    select * into v from public.resolve_village(r.village, r.block, r.district, r.state);

    if v.village_id is not null then
      update public.profiles set village_id = v.village_id where id = r.id;
      n_linked := n_linked + 1;
    else
      n_ambiguous := n_ambiguous + 1;
    end if;
  end loop;

  raise notice 'village backfill: % profile(s) linked, % left for the person to disambiguate',
    n_linked, n_ambiguous;
end $$;


-- =====================================================================
-- Verification. Run these after applying.
-- =====================================================================
-- -- Nobody should be left with a village typed but not linked, unless
-- -- resolve_village called it ambiguous:
-- select count(*) as unlinked from public.profiles
--  where village_id is null and coalesce(btrim(village), '') <> '';
--
-- -- Which households each worker can now actually reach:
-- select v.name as village, count(p.id) as households, count(av.asha_user_id) as workers
--   from public.villages v
--   left join public.profiles p on p.village_id = v.id and p.role = 'citizen'
--   left join public.asha_villages av on av.village_id = v.id
--  group by v.name order by households desc;
--
-- -- The resolver, on a village that does not exist yet and then on the
-- -- same one again — 'created' the first time, 'exact' the second:
-- select * from public.resolve_village('Shyampur', null, 'Sehore', 'Madhya Pradesh');
-- select * from public.resolve_village('Shyampur', null, 'Sehore', 'Madhya Pradesh');
--
-- -- And that a citizen can no longer move herself between villages
-- -- (expect: permission denied for table profiles):
-- --   as an authenticated user →  update public.profiles set village_id = '...' where id = auth.uid();
