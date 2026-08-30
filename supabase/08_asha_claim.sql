-- =====================================================================
-- Sehat Sathi — becoming an ASHA worker
-- Run AFTER 06_platform_rls.sql.
--
-- There are exactly two ways an account may end up with role 'asha',
-- and this file is the whole of both of them.
--
--   1. The roster path. A block office roster is uploaded by an admin.
--      Each row is issued a single-use invite code whose bcrypt hash is
--      the only thing stored. A worker types her official ASHA code plus
--      the invite code she was given; if the pair matches an active,
--      unclaimed roster row then her account is promoted and bound to
--      that row's villages, in one transaction, and the roster row is
--      marked claimed so the code cannot be used twice.
--
--   2. The approval path. A worker who is genuinely an ASHA but is not
--      on the uploaded roster files a request instead. Filing it grants
--      her nothing at all: her role stays 'citizen' and the request sits
--      in a queue until an admin approves it, at which point the same
--      promotion happens with the admin as the recorded authority.
--
-- Both paths live in the database rather than in the Node server for one
-- practical reason and one security reason. The practical reason is that
-- supabase-js cannot execute arbitrary SQL, so a multi-step verify-then-
-- claim written in TypeScript would be several round trips with no
-- transaction around them, and two workers submitting the same code at
-- the same moment could both succeed. The security reason is that
-- asha_roster has no RLS policy at all and its grants are revoked
-- (06_platform_rls.sql), so no client key can read it — reading the
-- roster plus guessing a short code would be enough to impersonate a
-- health worker, so the roster is reachable only with the service role,
-- from the server, and only through these functions.
--
-- Every function here is SECURITY DEFINER and every one of them is
-- revoked from anon, authenticated and PUBLIC at the bottom of the file.
-- That is not decoration. These functions deliberately step around the
-- guard_role_change trigger from 02_rls.sql, which is the single control
-- that stops an account holder promoting herself, so a client role able
-- to call them would be a role escalation with extra steps.
--
-- A note on `set search_path`. Every function pins its path, because an
-- unpinned SECURITY DEFINER function can be hijacked by a caller who
-- puts a same-named object earlier in their own search_path. `extensions`
-- is listed alongside `public` because a hosted Supabase project ships
-- pgcrypto in the `extensions` schema, and crypt() and gen_salt() must
-- resolve there; a self-hosted project that installed pgcrypto into
-- public resolves them from the first entry instead. Both layouts work,
-- and neither is left to the caller's environment.
-- =====================================================================

create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------
-- 1. hash_invite_code — the only place a code becomes a stored value
--
-- bcrypt via pgcrypto, with a per-code salt from gen_salt('bf'). The
-- plaintext is shown to the issuing admin exactly once, in the HTTP
-- response to the roster upload, and is never written anywhere: not to
-- asha_roster, not to audit_logs, not to the server log. If the admin
-- loses it before it is handed to the worker, the only remedy is to
-- issue a new one, which is the correct trade — a recoverable invite
-- code is a plaintext password with a friendlier name.
--
-- The salt means the same plaintext hashes differently on every call, so
-- two roster rows carrying the same code are not detectable from the
-- stored hashes, and verification has to be done with crypt() against
-- the stored value rather than by comparing hashes.
-- ---------------------------------------------------------------------
create or replace function public.hash_invite_code(p_code text)
returns text
language sql
volatile
security definer
set search_path = public, extensions
as $$
  select crypt(p_code, gen_salt('bf'));
$$;

comment on function public.hash_invite_code(text) is
  'bcrypt hash of an invite code, for asha_roster.invite_code_hash. The '
  'plaintext is displayed to the issuing admin once and is never stored, '
  'logged or audited, so a leak of this table hands out no accounts.';


-- ---------------------------------------------------------------------
-- 2. claim_asha_roster — the atomic claim
--
-- Everything that has to be true for a promotion, checked and applied in
-- one transaction: the roster row is found case-insensitively, the invite
-- code verifies against the stored bcrypt hash, the row is active, is
-- unclaimed and has not expired, the caller is not already a worker, and
-- then the role change, the asha_profiles row, the villages and the
-- asha_villages assignments are all written together or not at all.
--
-- Two things about the shape of this function are load-bearing.
--
-- The first is the order of the checks. The row is located by asha_code
-- and the invite code is verified BEFORE anything about the row's state
-- is reported back. A wrong invite code and a non-existent ASHA code
-- both return the same 'bad_code', which means the endpoint cannot be
-- used to enumerate the roster: an attacker with a list of guessed ASHA
-- codes learns nothing about which of them the block office actually
-- issued, because the answer is identical either way. 'already_claimed',
-- 'expired' and 'inactive' are only ever returned to somebody who has
-- already proved she holds the right code for that row, and she is
-- entitled to know why it did not work.
--
-- The second is that the lookup filters on asha_code alone — not on
-- `active`, not on `claimed_by`. Partly so the reasons above stay
-- distinguishable, and partly because of the `for update`: under read
-- committed, a second claimer blocked on the lock re-checks the WHERE
-- clause against the newly committed row when the lock is released. If
-- the WHERE mentioned claimed_by the row would vanish from under her and
-- she would be told 'bad_code' for a code that was perfectly good; as
-- written she is told 'already_claimed', which is the truth.
--
-- Failures return jsonb rather than raising, so the endpoint can map a
-- machine-readable reason onto an HTTP status without parsing an error
-- string. A genuinely unexpected error is left to propagate: the one
-- thing worse than a failed claim is a silent one.
-- ---------------------------------------------------------------------
create or replace function public.claim_asha_roster(
  p_asha_code   text,
  p_invite_code text,
  p_user_id     uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r             public.asha_roster;
  v_role        user_role;
  v_full_name   text;
  v_phone       text;
  v_name        text;
  v_village_id  uuid;
  v_village_ids uuid[] := '{}';
  v_primary_id  uuid;
  v_first       boolean := true;
  v_guarded     boolean;
  v_constraint  text;
begin
  -- The caller's own account first. None of this leaks anything about the
  -- roster, so it is safe to answer precisely, and it avoids taking a
  -- lock on a roster row on behalf of somebody who cannot use it.
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select p.role, p.full_name, p.phone
    into v_role, v_full_name, v_phone
    from public.profiles p
   where p.id = p_user_id;

  -- No profile row means the on_auth_user_created trigger never ran for
  -- this account. Promoting a row that does not exist is not something to
  -- paper over, but it is also not a claim failure the worker can act on.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_role in ('asha', 'admin') then
    return jsonb_build_object('ok', false, 'reason', 'user_already_asha');
  end if;

  -- One account may hold at most one roster row. The partial unique index
  -- uq_asha_roster_claimed_by enforces it regardless; checking here means
  -- the answer is a reason rather than a constraint violation.
  if exists (select 1 from public.asha_roster where claimed_by = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'user_already_asha');
  end if;

  if coalesce(btrim(p_asha_code), '') = ''
     or coalesce(btrim(p_invite_code), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  -- lower(asha_code) matches idx_asha_roster_lookup exactly, so the trim
  -- is applied to the submitted value only. A worker reading her code off
  -- a printed sheet will type stray spaces and the wrong case, and that
  -- is not a security event.
  select * into r
    from public.asha_roster
   where lower(asha_code) = lower(btrim(p_asha_code))
   for update;

  -- These two returns are deliberately identical, and they must stay
  -- identical. Splitting them into 'no such ASHA code' and 'wrong invite
  -- code' would turn this endpoint into a roster enumeration oracle.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  if r.invite_code_hash is null
     or crypt(p_invite_code, r.invite_code_hash) <> r.invite_code_hash then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  -- From here on the caller has proved she holds the code for this row,
  -- so she gets the real reason.
  if r.claimed_by is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  if r.code_expires_at is not null and r.code_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if not r.active then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;

  -- Is the role escalation guard installed? It is created by 02_rls.sql
  -- and should be, but this file must not fail because somebody ran the
  -- scripts out of order.
  v_guarded := exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'trg_guard_role'
  );

  begin
    update public.asha_roster
       set claimed_by = p_user_id,
           claimed_at = now()
     where id = r.id;

    -- Here is the bypass, stated plainly. guard_role_change() raises
    -- whenever profiles.role changes and public.is_admin() is false, and
    -- under the service role auth.uid() is null, so is_admin() is false
    -- and the guard cannot tell "a citizen promoting herself" from "the
    -- server promoting her after verifying an official invite code".
    -- The trigger is therefore switched off for exactly one statement.
    --
    -- Two properties make that safe. ALTER TABLE ... DISABLE TRIGGER
    -- takes a SHARE ROW EXCLUSIVE lock on profiles, so no other session
    -- can slip an unguarded write through the window; and the catalogue
    -- change is transactional, so if anything below raises, the trigger
    -- comes back on with the rest of the rollback. What is not safe is
    -- letting a client key reach this code, which is why execute is
    -- revoked from anon, authenticated and PUBLIC at the end of the file.
    if v_guarded then
      alter table public.profiles disable trigger trg_guard_role;
    end if;

    -- The roster is the official record, so its spelling of the worker's
    -- name wins. Her phone number does not work that way: the number on
    -- her account is the one she actually answers and may well be newer
    -- than the block office sheet, so the roster only fills a gap.
    update public.profiles
       set role      = 'asha',
           full_name = coalesce(nullif(btrim(r.full_name), ''), v_full_name),
           phone     = coalesce(nullif(btrim(v_phone), ''), r.phone),
           district  = coalesce(nullif(btrim(district), ''), r.district),
           state     = coalesce(nullif(btrim(state), ''), r.state)
     where id = p_user_id;

    if v_guarded then
      alter table public.profiles enable trigger trg_guard_role;
    end if;

    -- asha_profiles carries the working identity the portal renders. On
    -- conflict it is refreshed from the roster rather than left stale,
    -- because the roster is the thing a supervisor audits against.
    insert into public.asha_profiles (
      user_id, asha_code, block, sub_centre, villages,
      supervisor_name, supervisor_phone, active
    )
    values (
      p_user_id,
      r.asha_code,
      r.block,
      r.sub_centre,
      coalesce(r.village_names, '{}'::text[]),
      r.supervisor_name,
      r.supervisor_phone,
      true
    )
    on conflict (user_id) do update
      set asha_code        = excluded.asha_code,
          block            = excluded.block,
          sub_centre       = excluded.sub_centre,
          villages         = excluded.villages,
          supervisor_name  = excluded.supervisor_name,
          supervisor_phone = excluded.supervisor_phone,
          active           = true;

    -- asha_profiles.villages is display text. asha_villages is the
    -- relationship the notification and SOS policies actually read, so
    -- every named village has to become a real row here or the worker
    -- would appear registered and still be unable to address anyone.
    foreach v_name in array coalesce(r.village_names, '{}'::text[]) loop
      if coalesce(btrim(v_name), '') = '' then
        continue;
      end if;

      -- The conflict target mirrors uq_villages_identity from
      -- 05_platform.sql expression for expression. That index is what
      -- stops 'Shyampur' and 'shyampur ' becoming two audiences, so the
      -- insert has to be inferred against it and not against name alone.
      insert into public.villages (name, block, district, state)
      values (
        btrim(v_name),
        nullif(btrim(r.block), ''),
        nullif(btrim(r.district), ''),
        nullif(btrim(r.state), '')
      )
      on conflict (
        lower(btrim(name)),
        lower(coalesce(btrim(block), '')),
        lower(coalesce(btrim(district), '')),
        lower(coalesce(btrim(state), ''))
      ) do nothing;

      -- Re-select rather than rely on RETURNING: do nothing returns no
      -- row when the village already existed, which is the common case
      -- once a second worker from the same block claims her row.
      select v.id into v_village_id
        from public.villages v
       where lower(btrim(v.name))                   = lower(btrim(v_name))
         and lower(coalesce(btrim(v.block), ''))    = lower(coalesce(btrim(r.block), ''))
         and lower(coalesce(btrim(v.district), '')) = lower(coalesce(btrim(r.district), ''))
         and lower(coalesce(btrim(v.state), ''))    = lower(coalesce(btrim(r.state), ''))
       limit 1;

      if v_village_id is null then
        continue;
      end if;

      -- First name in the roster's list is her primary village. An
      -- existing assignment is left exactly as it is; re-running a claim
      -- must not quietly move somebody's primary posting.
      insert into public.asha_villages (asha_user_id, village_id, is_primary)
      values (p_user_id, v_village_id, v_first)
      on conflict (asha_user_id, village_id) do nothing;

      v_village_ids := v_village_ids || v_village_id;

      if v_first then
        v_primary_id := v_village_id;
        v_first := false;
      end if;
    end loop;

    -- Her own village_id, only if she has not already told us one. This
    -- update does not touch role, so the guard is back on and content.
    if v_primary_id is not null then
      update public.profiles
         set village_id = coalesce(village_id, v_primary_id),
             village     = coalesce(
               nullif(btrim(village), ''),
               (select name from public.villages where id = v_primary_id)
             )
       where id = p_user_id;
    end if;

  exception
    -- The two indexes that can fire here mean different things and the
    -- worker deserves the right one: uq_asha_roster_claimed_by means this
    -- account already holds a different roster row, while a clash on
    -- asha_profiles.asha_code means somebody else is already registered
    -- under this code and the roster row should not have been open.
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'uq_asha_roster_claimed_by' then
        return jsonb_build_object('ok', false, 'reason', 'user_already_asha');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end;

  return jsonb_build_object(
    'ok',                 true,
    'roster_id',          r.id,
    'user_id',            p_user_id,
    'asha_code',          r.asha_code,
    'full_name',          coalesce(nullif(btrim(r.full_name), ''), v_full_name),
    'block',              r.block,
    'sub_centre',         r.sub_centre,
    'district',           r.district,
    'state',              r.state,
    'supervisor_name',    r.supervisor_name,
    'villages',           to_jsonb(coalesce(r.village_names, '{}'::text[])),
    'village_ids',        to_jsonb(v_village_ids),
    'primary_village_id', v_primary_id
  );
end $$;

comment on function public.claim_asha_roster(text, text, uuid) is
  'Verifies an official ASHA code against its single-use invite code and, '
  'if they match an active unclaimed roster row, promotes the account and '
  'binds it to that row''s villages in one transaction. Returns '
  'jsonb {ok:false, reason} for every foreseeable failure; reason is one '
  'of not_found, already_claimed, bad_code, expired, inactive, '
  'user_already_asha. A wrong invite code and an ASHA code that does not '
  'exist both return bad_code on purpose, so this cannot be used to '
  'enumerate the roster.';


-- ---------------------------------------------------------------------
-- 3. issue_asha_invite_code — admin side of the roster path
--
-- Called once per roster row straight after an upload, with a plaintext
-- code the server has just generated and is about to show the admin. The
-- hash lands here and the plaintext leaves in the HTTP response; nothing
-- in between records it.
--
-- A claimed row is refused rather than re-issued. Re-uploading a roster
-- file is routine, and silently minting a fresh code for a worker who is
-- already registered would put a live-looking code on the admin's screen
-- that can never be redeemed, which is a support call and a suspicion of
-- a break-in for no reason at all.
-- ---------------------------------------------------------------------
create or replace function public.issue_asha_invite_code(
  p_roster_id  uuid,
  p_code       text,
  p_valid_days int default 30
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_days int := greatest(least(coalesce(p_valid_days, 30), 365), 1);
begin
  -- A short code is a guessable code, and the generator that feeds this
  -- function is ordinary application code that somebody will edit one
  -- day. Refusing here is the check that survives that edit.
  if p_roster_id is null or coalesce(btrim(p_code), '') = '' or length(btrim(p_code)) < 8 then
    return false;
  end if;

  update public.asha_roster
     set invite_code_hash = public.hash_invite_code(btrim(p_code)),
         code_issued_at   = now(),
         code_expires_at  = now() + make_interval(days => v_days)
   where id = p_roster_id
     and claimed_by is null;

  return found;
end $$;

comment on function public.issue_asha_invite_code(uuid, text, int) is
  'Stores the bcrypt hash of a freshly generated invite code against a '
  'roster row and sets its issue and expiry stamps. Returns false, and '
  'changes nothing, for an unknown row or one that has already been '
  'claimed. Admin use only, through the service role.';


-- ---------------------------------------------------------------------
-- 4. approve_asha_request — the approval path
--
-- The queue exists because a real ASHA worker missing from an uploaded
-- spreadsheet is a data problem, not grounds for refusing her the portal.
-- What she filed granted her nothing; this function is where the grant
-- happens, and it happens on a named admin's authority, recorded on the
-- request row.
--
-- It re-checks that the reviewer really is an admin against profiles
-- rather than trusting the endpoint that called it. The middleware in
-- server/lib/auth.ts already checks, but this function can promote any
-- account in the system and a second reading of the authoritative column
-- costs one index lookup.
--
-- Idempotent by way of the status check: a request that has already been
-- approved, rejected or withdrawn comes back as already_reviewed, so a
-- double-clicked approve button cannot mint a second asha_profiles row
-- or overwrite the first reviewer's note.
-- ---------------------------------------------------------------------
create or replace function public.approve_asha_request(
  p_request_id uuid,
  p_reviewer   uuid,
  p_note       text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  q             public.asha_registration_requests;
  v_reviewer    user_role;
  v_code        text;
  v_provisional boolean := false;
  v_village_id  uuid;
  v_guarded     boolean;
  v_constraint  text;
begin
  if p_request_id is null or p_reviewer is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select role into v_reviewer from public.profiles where id = p_reviewer;
  if not found or v_reviewer <> 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- for update so two admins working the same queue cannot both approve.
  select * into q
    from public.asha_registration_requests
   where id = p_request_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if q.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  -- If she told us the code the block office gave her, that is the code
  -- she will be asked for at a review meeting, so it is the one to use.
  -- Otherwise she gets a provisional code derived from her user id:
  -- deterministic, so re-running this cannot produce a second identity,
  -- and prefixed so that nobody mistakes it for an official number. An
  -- admin is expected to replace it once the block office issues one.
  v_code := nullif(upper(btrim(coalesce(q.asha_code_claimed, ''))), '');
  if v_code is null then
    v_code := 'PROV-' || upper(substr(replace(q.user_id::text, '-', ''), 1, 8));
    v_provisional := true;
  end if;

  v_guarded := exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'trg_guard_role'
  );

  begin
    update public.asha_registration_requests
       set status      = 'approved',
           reviewed_by = p_reviewer,
           reviewed_at = now(),
           review_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = q.id;

    -- Same deliberate bypass as claim_asha_roster, for the same reason:
    -- under the service role is_admin() is false, so guard_role_change
    -- would refuse a promotion the admin has explicitly authorised. The
    -- window is one statement wide and holds a lock on profiles for its
    -- duration.
    if v_guarded then
      alter table public.profiles disable trigger trg_guard_role;
    end if;

    update public.profiles
       set role      = 'asha',
           full_name = coalesce(nullif(btrim(q.full_name), ''), full_name),
           phone     = coalesce(nullif(btrim(phone), ''), q.phone),
           district  = coalesce(nullif(btrim(district), ''), q.district),
           state     = coalesce(nullif(btrim(state), ''), q.state)
     where id = q.user_id;

    if v_guarded then
      alter table public.profiles enable trigger trg_guard_role;
    end if;

    insert into public.asha_profiles (
      user_id, asha_code, block, sub_centre, villages,
      supervisor_name, supervisor_phone, active
    )
    values (
      q.user_id,
      v_code,
      q.block,
      q.sub_centre,
      case
        when coalesce(btrim(q.village_name), '') = '' then '{}'::text[]
        else array[btrim(q.village_name)]
      end,
      q.supervisor_name,
      q.supervisor_phone,
      true
    )
    on conflict (user_id) do update
      set block            = excluded.block,
          sub_centre       = excluded.sub_centre,
          villages         = excluded.villages,
          supervisor_name  = excluded.supervisor_name,
          supervisor_phone = excluded.supervisor_phone,
          active           = true;

    -- Her village, resolved the same way the roster path resolves one.
    -- The duplication is deliberate: a fifth helper would be a fifth
    -- function to grant, revoke and reason about, and the sanctioned
    -- surface here is worth keeping at four.
    if coalesce(btrim(q.village_name), '') <> '' then
      insert into public.villages (name, block, district, state)
      values (
        btrim(q.village_name),
        nullif(btrim(q.block), ''),
        nullif(btrim(q.district), ''),
        nullif(btrim(q.state), '')
      )
      on conflict (
        lower(btrim(name)),
        lower(coalesce(btrim(block), '')),
        lower(coalesce(btrim(district), '')),
        lower(coalesce(btrim(state), ''))
      ) do nothing;

      select v.id into v_village_id
        from public.villages v
       where lower(btrim(v.name))                   = lower(btrim(q.village_name))
         and lower(coalesce(btrim(v.block), ''))    = lower(coalesce(btrim(q.block), ''))
         and lower(coalesce(btrim(v.district), '')) = lower(coalesce(btrim(q.district), ''))
         and lower(coalesce(btrim(v.state), ''))    = lower(coalesce(btrim(q.state), ''))
       limit 1;

      if v_village_id is not null then
        insert into public.asha_villages (asha_user_id, village_id, is_primary)
        values (q.user_id, v_village_id, true)
        on conflict (asha_user_id, village_id) do nothing;

        update public.profiles
           set village_id = coalesce(village_id, v_village_id),
               village     = coalesce(nullif(btrim(village), ''), btrim(q.village_name))
         where id = q.user_id;
      end if;
    end if;

  exception
    -- asha_profiles.asha_code is unique, so an approval that would reuse
    -- a code already registered to somebody else stops here with the
    -- whole approval rolled back. The admin has to correct the code on
    -- the request before it can go through, which is the right outcome:
    -- two workers sharing one official code is a records problem to fix,
    -- not one to absorb.
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object(
        'ok', false,
        'reason', 'asha_code_taken',
        'constraint', v_constraint
      );
  end;

  return jsonb_build_object(
    'ok',          true,
    'request_id',  q.id,
    'user_id',     q.user_id,
    'asha_code',   v_code,
    'provisional', v_provisional,
    'village_id',  v_village_id,
    'village',     nullif(btrim(coalesce(q.village_name, '')), ''),
    'reviewed_by', p_reviewer
  );
end $$;

comment on function public.approve_asha_request(uuid, uuid, text) is
  'Approves a queued ASHA registration request on a named admin''s '
  'authority: marks the request approved, promotes the applicant, creates '
  'her asha_profiles row and links her village. Returns jsonb {ok:false, '
  'reason} with reason one of not_found, not_admin, already_reviewed or '
  'asha_code_taken. Re-approving an already reviewed request changes '
  'nothing and returns already_reviewed. An applicant who gave no '
  'official code gets a deterministic PROV- code that is plainly not a '
  'block office number and is expected to be replaced.';


-- =====================================================================
-- Grants — service role only, all four of them
--
-- The revoke from PUBLIC is the one that matters. Postgres grants EXECUTE
-- on a new function to PUBLIC by default, and `authenticated` inherits
-- that, so revoking from anon and authenticated alone would leave every
-- one of these callable from the browser with a publishable key.
--
-- What a client role would gain is worth spelling out. Each of these
-- functions switches off trg_guard_role and writes profiles.role, which
-- is the trigger 02_rls.sql calls the single most important one in the
-- file. claim_asha_roster would additionally become an oracle for
-- brute-forcing invite codes with no rate limit in front of it, and
-- issue_asha_invite_code would let a caller set a code of their own
-- choosing on any roster row and then redeem it. They are reachable only
-- with the service key, from the server, behind requireAuth or
-- requireAdmin and behind a per-user attempt limit.
-- =====================================================================

revoke all on function public.hash_invite_code(text)
  from public, anon, authenticated;

revoke all on function public.claim_asha_roster(text, text, uuid)
  from public, anon, authenticated;

revoke all on function public.issue_asha_invite_code(uuid, text, int)
  from public, anon, authenticated;

revoke all on function public.approve_asha_request(uuid, uuid, text)
  from public, anon, authenticated;
