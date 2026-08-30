-- =====================================================================
-- Sehat Sathi — Row Level Security for the platform tables
-- Run AFTER 05_platform.sql.
--
-- The two rules this file exists to hold:
--
--   1. A citizen must not be able to become, or read the data of, a
--      health worker. That means asha_roster is unreadable by every
--      client role — a leaked invite code plus a readable roster would
--      be enough to impersonate an ASHA.
--
--   2. An ASHA must not be able to broadcast to a village she does not
--      serve. The insert policy on notifications checks the
--      asha_villages junction, so the audience is decided by the
--      database and not by whatever village_id the client posts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
--
-- SECURITY DEFINER for the same reason as the ones in 02_rls.sql: a
-- policy that reads the table it guards would recurse.
-- ---------------------------------------------------------------------

-- Does the caller cover this village? This is the authority for
-- "who may broadcast here".
create or replace function public.asha_covers_village(v uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.asha_villages av
     where av.asha_user_id = auth.uid()
       and av.village_id = v
  );
$$;

-- Is `worker` an ASHA covering `citizen`'s village? Used to decide who a
-- citizen is allowed to open a message thread with, so that threads
-- cannot be created against an arbitrary worker elsewhere in the state.
create or replace function public.asha_covers_citizen(worker uuid, citizen uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.profiles p
      join public.asha_villages av on av.village_id = p.village_id
     where p.id = citizen
       and av.asha_user_id = worker
  );
$$;

-- The caller's own village. Kept as a function so policies stay readable.
create or replace function public.my_village()
returns uuid
language sql stable security definer set search_path = public as $$
  select village_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.asha_covers_village(uuid)     from anon;
revoke all on function public.asha_covers_citizen(uuid,uuid) from anon;
revoke all on function public.my_village()                   from anon;

-- ---------------------------------------------------------------------
-- Enable RLS on every new table. None is left open.
-- ---------------------------------------------------------------------
alter table public.ref_states                 enable row level security;
alter table public.ref_districts              enable row level security;
alter table public.ref_specialities           enable row level security;
alter table public.hospitals                  enable row level security;
alter table public.villages                   enable row level security;
alter table public.asha_villages              enable row level security;
alter table public.asha_roster                enable row level security;
alter table public.asha_registration_requests enable row level security;
alter table public.emergency_contacts         enable row level security;
alter table public.notifications              enable row level security;
alter table public.notification_recipients    enable row level security;
alter table public.message_threads            enable row level security;
alter table public.thread_messages            enable row level security;
alter table public.sos_broadcasts             enable row level security;
alter table public.sos_deliveries             enable row level security;
alter table public.prescription_scans         enable row level security;


-- =====================================================================
-- Reference data — readable by anyone, writable only by admins
--
-- `anon` is included because "where is the nearest hospital" must be
-- answerable before anyone signs in. That is the whole point of the
-- landing page.
-- =====================================================================

drop policy if exists ref_states_read on public.ref_states;
create policy ref_states_read on public.ref_states
  for select to anon, authenticated using (true);

drop policy if exists ref_states_write on public.ref_states;
create policy ref_states_write on public.ref_states
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ref_districts_read on public.ref_districts;
create policy ref_districts_read on public.ref_districts
  for select to anon, authenticated using (true);

drop policy if exists ref_districts_write on public.ref_districts;
create policy ref_districts_write on public.ref_districts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists ref_specialities_read on public.ref_specialities;
create policy ref_specialities_read on public.ref_specialities
  for select to anon, authenticated using (true);

drop policy if exists ref_specialities_write on public.ref_specialities;
create policy ref_specialities_write on public.ref_specialities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Only active hospitals are visible. A de-empanelled hospital is not a
-- place to send someone with an Ayushman card.
drop policy if exists hospitals_read on public.hospitals;
create policy hospitals_read on public.hospitals
  for select to anon, authenticated using (active);

-- The bulk import runs with the service role, which bypasses RLS. This
-- policy is only for an admin editing a single row from a client.
drop policy if exists hospitals_write on public.hospitals;
create policy hospitals_write on public.hospitals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists villages_read on public.villages;
create policy villages_read on public.villages
  for select to anon, authenticated using (true);

drop policy if exists villages_write on public.villages;
create policy villages_write on public.villages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- asha_villages — the worker's own assignment, and nobody else's
--
-- A citizen does NOT read this table to find their worker. They call
-- public.asha_for_village(), which is security definer and returns just
-- the name, phone, code and sub-centre. That keeps "I can contact my
-- ASHA" from turning into "I can enumerate every worker in the state".
-- =====================================================================

drop policy if exists asha_villages_select on public.asha_villages;
create policy asha_villages_select on public.asha_villages
  for select to authenticated
  using (asha_user_id = auth.uid() or public.is_admin());

drop policy if exists asha_villages_write on public.asha_villages;
create policy asha_villages_write on public.asha_villages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- asha_roster — no client access whatsoever
--
-- RLS is on and not one policy is created, so every read and write from
-- anon or authenticated returns nothing. The roster is reachable only
-- with the service role, from the server. The revokes below are belt and
-- braces in case somebody adds a policy here later without thinking it
-- through.
-- =====================================================================

revoke all on public.asha_roster from anon, authenticated;

comment on column public.asha_roster.invite_code_hash is
  'bcrypt hash from pgcrypto crypt(). Verified server-side with '
  'crypt(candidate, invite_code_hash) = invite_code_hash. The plaintext '
  'is displayed to the issuing admin once and is not stored.';


-- =====================================================================
-- asha_registration_requests — the fallback path for a worker who is
-- not on the uploaded roster
-- =====================================================================

drop policy if exists asha_requests_select on public.asha_registration_requests;
create policy asha_requests_select on public.asha_registration_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- A signed-in person may file a request about themselves. Filing one
-- grants nothing: role stays 'citizen' until an admin approves, and the
-- guard_role_change trigger from 02_rls.sql is what stops any shortcut.
drop policy if exists asha_requests_insert on public.asha_registration_requests;
create policy asha_requests_insert on public.asha_registration_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- The applicant may withdraw. Only an admin may approve or reject, and
-- the status check here is what enforces that split.
drop policy if exists asha_requests_withdraw on public.asha_registration_requests;
create policy asha_requests_withdraw on public.asha_registration_requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'withdrawn');

drop policy if exists asha_requests_review on public.asha_registration_requests;
create policy asha_requests_review on public.asha_registration_requests
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =====================================================================
-- emergency_contacts — strictly the owner's own
--
-- Note that an ASHA is given no read access here. She does not need the
-- family's phone list; the SOS fan-out runs server-side with the service
-- role.
-- =====================================================================

drop policy if exists emergency_contacts_own on public.emergency_contacts;
create policy emergency_contacts_own on public.emergency_contacts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- =====================================================================
-- notifications
-- =====================================================================

-- You can read a notification if you wrote it, if you were one of its
-- recipients, or if you are an admin.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.notification_recipients nr
       where nr.notification_id = id and nr.user_id = auth.uid()
    )
  );

-- The important one. An ASHA may only address a village she is assigned
-- to; 'all' is reserved for admins. Because the check reads
-- asha_villages, posting someone else's village_id fails at the database
-- rather than being filtered later.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_admin()
      or (
        public.is_asha()
        and audience = 'village'
        and village_id is not null
        and public.asha_covers_village(village_id)
      )
      or (
        -- A direct note to one person, allowed only if that person is in
        -- a village this worker covers.
        public.is_asha()
        and audience = 'user'
        and target_user_id is not null
        and public.asha_covers_citizen(auth.uid(), target_user_id)
      )
    )
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- notification_recipients
--
-- Rows are created by the server with the service role during fan-out,
-- so there is no INSERT policy. A recipient may only mark their own row
-- read, and column-level grants are what stop them rewriting anything
-- else on it — RLS alone cannot restrict a policy to a single column.
-- ---------------------------------------------------------------------

drop policy if exists notif_recipients_select on public.notification_recipients;
create policy notif_recipients_select on public.notification_recipients
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists notif_recipients_mark_read on public.notification_recipients;
create policy notif_recipients_mark_read on public.notification_recipients
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.notification_recipients from anon, authenticated;
grant  update (read_at) on public.notification_recipients to authenticated;


-- =====================================================================
-- message_threads + thread_messages — participants only
-- =====================================================================

drop policy if exists threads_select on public.message_threads;
create policy threads_select on public.message_threads
  for select to authenticated
  using (citizen_id = auth.uid() or asha_id = auth.uid() or public.is_admin());

-- A citizen opens the thread, and only with a worker who covers their
-- village. An ASHA may also open one with a household she covers.
drop policy if exists threads_insert on public.message_threads;
create policy threads_insert on public.message_threads
  for insert to authenticated
  with check (
    (citizen_id = auth.uid() and public.asha_covers_citizen(asha_id, auth.uid()))
    or (asha_id = auth.uid() and public.is_asha()
        and public.asha_covers_citizen(auth.uid(), citizen_id))
    or public.is_admin()
  );

drop policy if exists threads_update on public.message_threads;
create policy threads_update on public.message_threads
  for update to authenticated
  using (citizen_id = auth.uid() or asha_id = auth.uid() or public.is_admin())
  with check (citizen_id = auth.uid() or asha_id = auth.uid() or public.is_admin());

drop policy if exists thread_messages_select on public.thread_messages;
create policy thread_messages_select on public.thread_messages
  for select to authenticated
  using (exists (
    select 1 from public.message_threads t
     where t.id = thread_id
       and (t.citizen_id = auth.uid() or t.asha_id = auth.uid() or public.is_admin())
  ));

-- You may only post as yourself, into a thread you are part of, that is
-- still open.
drop policy if exists thread_messages_insert on public.thread_messages;
create policy thread_messages_insert on public.thread_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.message_threads t
       where t.id = thread_id
         and not t.closed
         and (t.citizen_id = auth.uid() or t.asha_id = auth.uid())
    )
  );

-- The other participant marks a message read. Same column-grant trick as
-- notification_recipients: the policy authorises the row, the grant
-- restricts it to read_at.
drop policy if exists thread_messages_mark_read on public.thread_messages;
create policy thread_messages_mark_read on public.thread_messages
  for update to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.message_threads t
       where t.id = thread_id
         and (t.citizen_id = auth.uid() or t.asha_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.message_threads t
       where t.id = thread_id
         and (t.citizen_id = auth.uid() or t.asha_id = auth.uid())
    )
  );

revoke update, delete on public.thread_messages from anon, authenticated;
grant  update (read_at) on public.thread_messages to authenticated;

-- A message is a record of what was said. It is not editable and not
-- deletable, by anyone holding a client key.
revoke delete on public.message_threads from anon, authenticated;


-- =====================================================================
-- SOS
-- =====================================================================

-- The person who raised it, the worker covering their village, and
-- admins. The village clause is what lets an ASHA see an emergency from
-- a household she has no prior alert or referral for — which is exactly
-- the case an SOS exists to cover.
drop policy if exists sos_select on public.sos_broadcasts;
create policy sos_select on public.sos_broadcasts
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (village_id is not null and public.asha_covers_village(village_id))
  );

drop policy if exists sos_insert on public.sos_broadcasts;
create policy sos_insert on public.sos_broadcasts
  for insert to authenticated
  with check (user_id = auth.uid());

-- The raiser may cancel; the covering worker may acknowledge and
-- resolve. Nobody may delete: an emergency record that can be erased is
-- worse than none.
drop policy if exists sos_update on public.sos_broadcasts;
create policy sos_update on public.sos_broadcasts
  for update to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (village_id is not null and public.asha_covers_village(village_id))
  )
  with check (
    user_id = auth.uid()
    or public.is_admin()
    or (village_id is not null and public.asha_covers_village(village_id))
  );

revoke delete on public.sos_broadcasts from anon, authenticated;

-- Delivery rows are written by the server with the service role, so
-- there is no INSERT or UPDATE policy. The owner can read them, because
-- "was my mother actually told?" is a question they are entitled to an
-- answer to.
drop policy if exists sos_deliveries_select on public.sos_deliveries;
create policy sos_deliveries_select on public.sos_deliveries
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.sos_broadcasts s
       where s.id = sos_id
         and (s.user_id = auth.uid()
              or (s.village_id is not null and public.asha_covers_village(s.village_id)))
    )
  );

revoke insert, update, delete on public.sos_deliveries from anon, authenticated;


-- =====================================================================
-- prescription_scans — the owner's own, and nobody else's
--
-- Not even an ASHA. A prescription is the most sensitive thing in this
-- app and nothing in the product requires a worker to read one.
-- =====================================================================

drop policy if exists scans_own on public.prescription_scans;
create policy scans_own on public.prescription_scans
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- =====================================================================
-- Function grants
-- =====================================================================

-- Nearby search is available before sign-in, by design.
grant execute on function public.hospitals_nearby(
  double precision, double precision, double precision, text, text, int, int
) to anon, authenticated;

-- Finding your village's worker requires being signed in.
revoke all    on function public.asha_for_village(uuid) from anon;
grant  execute on function public.asha_for_village(uuid) to authenticated;
