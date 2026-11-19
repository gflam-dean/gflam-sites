-- =====================================================================
-- Migration 226: a members list's full rows (email, mobile, postcode, birth month) are read by the venue's OWNER and
-- MANAGERS only. Hosts, marketing logins and HQ read number, names and status through v_vp_members_list (208).
-- ---------------------------------------------------------------------
-- INBOX 707 + 710 (one fix, INBOX 712k), 19 Nov 2026. Sources: ~/venue-enrich/reports/member-contacts-access-19nov.md,
-- reports/friday-member-contacts-ship-19nov.md, reports/members-dob-factcheck-19nov.md.
-- Notes: ~/venue-enrich/builds/members-access-19nov.md
--
-- WRITTEN, NOT RUN. Not run on TEST, not run on LIVE. Ships only on Dean's yes, after two independent reviews.
-- Branch fix/members-access-19nov (off the Sunday candidate fbfba3d96). Safe to run more than once.
-- NUMBER: 226. Register (19 Nov 11:40): 223 birth5 is the highest file; 224 is held for the full venue-staff lockdown;
-- 225 is 204b (retention, INBOX 712j); 226 is the next free. Main registers it (builder does not edit the register).
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements between the guard's END marker and the end of the file (as for 208, 217 and 218).
--
-- WHAT WAS OPEN. Policy vp_members_host_select (SELECT, authenticated) let any login with a staff row at the venue
-- (roster_id in the rosters of vp_staff_venue_ids()) read EVERY column of that venue's members list straight from the
-- API: no role test, no column list. Since migration 200 those columns hold email, mobile, postcode and offers consent;
-- migration 213 (branch, not live) adds birth year and month. A HOST (signs in by phone, may be a visiting trivia host)
-- or a MARKETING login could therefore read a club's member contacts with its own token. The privacy page says player
-- data is never passed "to a visiting host". The pages never asked for those columns (Friday's console reads named
-- columns), but the database did not stop a direct read.
--
-- WHY A POLICY + THE NAMES VIEW AND NOT A COLUMN GRANT. Every signed-in login (owner, manager, host, marketing, HQ) is
-- the SAME database role, authenticated, so a column-level grant cannot tell a host from an owner. Row security can, so:
--   1. new helper public.vp_owner_manager_venue_ids(): the caller's venues where its staff row is owner or manager.
--      SECURITY DEFINER (vp_venue_staff's own read policy calls vp_staff_venue_ids(), and a plain function here would
--      run under that policy), STABLE, search_path pinned to '' (every name in it is schema-qualified; review 1 S6),
--      EXECUTE for authenticated and service_role only.
--   2. vp_members_host_select is DROPPED and replaced by vp_members_owner_manager_select: FOR SELECT to authenticated,
--      rows of rosters at vp_owner_manager_venue_ids(). The only other policy on vp_members after 208 is none (208
--      dropped vp_members_admin_all), so the full row (every contact and birth column, now and later) is the owner's
--      and the managers' alone. The account page download (billing.html) is theirs; it keeps working.
--   3. Hosts keep the draw console's names through v_vp_members_list (migration 208, NOT changed here): id, roster_id,
--      member_number, first_name, last_name, status, updated_at; owner rights, security_barrier, rows of the caller's
--      own venues (vp_staff_venue_ids()) or every venue for HQ; select to authenticated, nothing to anon. This file
--      REFUSES to run if that view is missing or names any other column, so a birth or contact column can never reach
--      a host through it. Birth fields (213) are therefore readable only by owner, manager and service_role.
--   4. The draw itself is unchanged: vp_members_draw is SECURITY DEFINER and called by the game Worker with the service
--      key (service_role bypasses row security), and every /host/members/* route uses the service key.
--   NOT CHANGED: vp_member_rosters (list header + import_map headings, no person data), vp_member_draws,
--   vp_member_draw_results, vp_staff_venue_ids() itself (about 40 policies use it; its expected body is written down in
--   REFERENCE-vp-staff-venue-ids-READ-ONLY.sql, to be checked against live with pg_get_functiondef, never pasted).
--
-- WHO READS WHAT AFTER IT RUNS (table vp_members / view v_vp_members_list):
--   owner, manager at the venue    every column / names          (as before)
--   host, marketing at the venue   NOTHING / names               (was: every column)
--   staff of another venue         nothing / nothing             (as before)
--   HQ admin (no staff row)        nothing / names, every venue  (as after 208)
--   anon                           nothing / nothing             (as before)
--   service_role (Workers)         every column / every row      (bypasses row security, as before)
--
-- ORDER (read this; review 1, 19 Nov: the earlier "older pages fall through to the view" line was FALSE for live).
--   * NEEDS 208 FIRST (the view). 226 refuses without it.
--   * NEEDS THE 208 PAGES LIVE FIRST. Only a members/host.html that contains v_vp_members_list reads names through the
--     view. Checked 19 Nov: the page live today (origin/main efc35a343, host.html:1172 `select("*")` on vp_members) and
--     the Friday BASE b0f404229 (host.html:1182, named columns) read the TABLE ONLY, with no view anywhere in host.html
--     or billing.html. On those pages, after 226 a host's table read returns nobody, the list is empty and the draw
--     refuses ("No active members to draw from", efc35a343 host.html:914): hosts CANNOT run a members draw. That is a
--     game break. Pages that DO fall through to the view: Friday HEAD b292c86e1, the Sunday candidate fbfba3d96, and
--     this branch (view first). billing.html's members count on efc35a343 has no view fallback either (a host would
--     see 0 there; cosmetic).
--   * RULE: 226 is pasted ONLY AFTER a members/host.html containing v_vp_members_list is live, and NEVER before Friday
--     ships the 208 pages. Pre-paste check (main, read only): GET the live members/host.html and confirm it contains
--     v_vp_members_list (this file cannot read a web page, so the check is main's, item 10 in the build note).
--   * If Friday slips, or ships without the 208 pages, 226 waits until AFTER Sunday's push. That clashes with the
--     "migrations before the push" rule and the release tool's refusal: a decision for main and Dean, made before
--     the night (options in ~/venue-enrich/builds/members-access-19nov.md).
--   * A host opening the account page's members download gets "nobody" (that download is the owner's and managers').
--   PASTE ORDER: after 208 (and after 200; 213 may come before or after) AND after the 208 pages are live. Dean pastes
--   the statements after the guard's END marker into the live SQL editor, then runs the READ-BACK queries at the end,
--   then main re-dumps RLS-BASELINE.json (one policy swapped, one definer function added).
-- rollback-safe: rolling 226 back (ROLLBACK below) restores the any-staff read, so every page build works after a
--   rollback. Going FORWARD is not page-safe on every build: only pages containing v_vp_members_list (Friday head
--   b292c86e1 or later) keep hosts' names after 226; the Workers use the service key and are unaffected.
-- =====================================================================
-- VP-STAGING-GUARD-BEGIN
do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. This is not the venueplay TEST project (rkfaftxgzpsmmrzudlqy), or 01-mark-this-as-test.sql was not run. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''rkfaftxgzpsmmrzudlqy''' into n;
  if n <> 1 then
    raise exception 'REFUSED: the TEST marker does not name rkfaftxgzpsmmrzudlqy. Nothing was changed.';
  end if;
  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '6149157%');
  if n > 0 then
    raise exception 'REFUSED: % real person(s) signed in here since 1 Oct 2026. The TEST project only ever has fake users. Is this LIVE? Nothing was changed.', n;
  end if;
end
$guard$;
-- VP-STAGING-GUARD-END

begin;

-- 0. Refuse unless the names view from 208 is there and names ONLY the seven names columns (hosts read it after this).
do $pre$
declare extra text;
begin
  if to_regclass('public.vp_members') is null or to_regclass('public.vp_member_rosters') is null then
    raise exception 'REFUSED: vp_members or vp_member_rosters is missing. This is not the database this was written for. Nothing was changed.';
  end if;
  if to_regclass('public.v_vp_members_list') is null then
    raise exception 'REFUSED: v_vp_members_list (migration 208) is missing. Run 208 first, or hosts lose the members names. Nothing was changed.';
  end if;
  -- pg_attribute, not information_schema.columns: information_schema shows only the columns the running role holds a
  -- privilege on, pg_attribute shows every column the view has.
  select string_agg(a.attname::text, ', ' order by a.attname::text) into extra
    from pg_attribute a
   where a.attrelid = 'public.v_vp_members_list'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname::text not in ('id', 'roster_id', 'member_number', 'first_name', 'last_name', 'status', 'updated_at');
  if extra is not null then
    raise exception 'REFUSED: v_vp_members_list names more than the names columns (%). Hosts read it after this. Nothing was changed.', extra;
  end if;
  -- A names column COMPUTED from a contact or birth column would pass the name test, so the definition is read too.
  if pg_get_viewdef('public.v_vp_members_list'::regclass) ~* '\m(email|mobile|postcode|note|marketing_optin\w*|birth\w*|date_of_birth)\M' then
    raise exception 'REFUSED: v_vp_members_list''s definition reads a contact, consent, note or birth column. Hosts read it after this. Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'vp_venue_staff' and column_name = 'role') then
    raise exception 'REFUSED: vp_venue_staff.role is missing. Nothing was changed.';
  end if;
end
$pre$;

-- 1. The role-aware helper: the caller's venues where it is owner or manager. Nothing else.
create or replace function public.vp_owner_manager_venue_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select s.venue_id
    from public.vp_venue_staff s
   where s.auth_user_id = auth.uid()
     and s.role in ('owner', 'manager')
$fn$;

revoke all on function public.vp_owner_manager_venue_ids() from public, anon, authenticated;
grant execute on function public.vp_owner_manager_venue_ids() to authenticated;
grant execute on function public.vp_owner_manager_venue_ids() to service_role;

comment on function public.vp_owner_manager_venue_ids() is
  'Venues where the signed-in login is owner or manager (vp_venue_staff.role). Used by vp_members_owner_manager_select: a members list''s full rows (contacts, birth month) are the owner''s and managers'' only (migration 226).';

-- 2. The members list's full rows: owner and managers only. The old any-staff read goes.
drop policy if exists vp_members_host_select on public.vp_members;
drop policy if exists vp_members_owner_manager_select on public.vp_members;
create policy vp_members_owner_manager_select on public.vp_members
  for select to authenticated
  using (roster_id in (select r.id from public.vp_member_rosters r
                        where r.venue_id in (select public.vp_owner_manager_venue_ids())));

commit;

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs):
--   a) the policies on vp_members (expect ONE row: vp_members_owner_manager_select, SELECT, {authenticated}, a qual
--      naming vp_owner_manager_venue_ids and NOT vp_staff_venue_ids):
--   select policyname, cmd, roles, qual from pg_policies where schemaname = 'public' and tablename = 'vp_members';
--   b) the helper (expect prosecdef true, provolatile s, and the body testing role in ('owner', 'manager')):
--   select prosecdef, provolatile, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'vp_owner_manager_venue_ids';
--   c) who may run it (expect authenticated and service_role true, anon false):
--   select has_function_privilege('anon', 'public.vp_owner_manager_venue_ids()', 'execute') as anon,
--          has_function_privilege('authenticated', 'public.vp_owner_manager_venue_ids()', 'execute') as authenticated,
--          has_function_privilege('service_role', 'public.vp_owner_manager_venue_ids()', 'execute') as service_role;
--   d) the names view is unchanged (expect the seven: id, roster_id, member_number, first_name, last_name, status,
--      updated_at):
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'v_vp_members_list'
--    order by ordinal_position;
--   e) the staff helper this view still uses (read it; compare with REFERENCE-vp-staff-venue-ids-READ-ONLY.sql):
--   select pg_get_functiondef('public.vp_staff_venue_ids()'::regprocedure);
--   select role, count(*) from public.vp_venue_staff group by role order by role;
--
-- ROLLBACK (puts back exactly what RLS-BASELINE.json had before this branch; this RE-OPENS the host read of contacts):
--   begin;
--   drop policy if exists vp_members_owner_manager_select on public.vp_members;
--   drop policy if exists vp_members_host_select on public.vp_members;
--   create policy vp_members_host_select on public.vp_members for select to authenticated
--     using (roster_id in (select vp_member_rosters.id from public.vp_member_rosters
--                           where vp_member_rosters.venue_id in (select public.vp_staff_venue_ids())));
--   drop function if exists public.vp_owner_manager_venue_ids();
--   commit;
--   notify pgrst, 'reload schema';
--   No page needs rolling back: the console reads the names view first either way, and the table read is a fallback.
