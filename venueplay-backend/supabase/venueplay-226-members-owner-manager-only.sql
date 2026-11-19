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
--   * RULING (main, INBOX 725, 19 Nov; settled, not an open decision): 226 is a SUNDAY migration pasted in SATURDAY
--     21 Nov's paste sitting, AFTER Friday is LIVE and BEFORE Sunday's push, after check 10 is green. Paste in DAYTIME
--     and at least 4 HOURS after Friday went live, so every host console opened before Friday's push has hit the 4 h
--     sign-out (INBOX 730). Both release tools agree with that order.
--   * If Friday slips, or ships without the 208 pages (725): 226 WAITS for the release that carries those pages. Facts
--     for that release (review 2 S1, 19 Nov): it CANNOT ride in the same push as the pages.
--     tools/check-migrations-live.py judges every migration FILE the push adds (not a list): this file creates
--     vp_owner_manager_venue_ids, which is not live until pasted, so release.py stops BEFORE the push while this file is in it. And after a push the full gate compares live with
--     RLS-BASELINE.json, which (on this branch) already names vp_members_owner_manager_select: pushed before the paste,
--     the locks line goes RED. So the only way is to SPLIT the branch: push the pages (members/host.html and its test
--     changes) WITHOUT this .sql file, without the suite parts and prove rows that read it, and without the
--     RLS-BASELINE.json change; check 10 green; paste 226; then push the rest. Or hold 226 whole to the next release. Which of the two
--     is Dean's call on the day Friday slips (main review S1); 725 itself is settled.
--   * GATE WINDOW (review 2 S2): from the Saturday paste until Sunday's push lands, main's committed RLS-BASELINE.json
--     (Friday's) still says vp_members_host_select, so ANY live gate run in that window is RED on the line "The
--     database locks match the baseline". That is EXPECTED. Do NOT roll 226 back to make it green; Sunday's push
--     carries the new baseline.
--   * PASTE IN DAYTIME (review 2 S3), never during a members draw night. The drop and create policy take a short
--     exclusive lock on vp_members; the paste sets lock_timeout 5s first, so if a read holds the table it fails
--     cleanly with nothing changed (paste again a minute later) instead of making every members read queue behind it.
--   * OPEN CONSOLE TABS (review 2 S5): a members console opened BEFORE Friday's push and still open after the paste
--     runs the old table-only code: empty list, the draw refuses. Pasting 4 h or more after Friday went live means the
--     4 h host sign-out has closed every such tab; if any host is still mid-session anyway, tell them: reload the members
--     console.
--   * A host opening the account page's members download gets "nobody" (that download is the owner's and managers').
--   * INTO THE SUNDAY TREE BY CHERRY-PICK ONLY, NEVER BY MERGE AT W1 (main review 2 S1, INBOX 734; trial 19 Nov):
--     Sunday's W1 merges the Sunday candidate fbfba3d96 into post-Friday main and runs sun-resolve.py, which knows
--     11 conflicted files. Merging (or fast-forwarding the candidate to) this branch there adds a 12th,
--     RLS-BASELINE.json, and sun-resolve.py REFUSES ("conflicted files outside the expected 11"). So: W1 to W3 exactly
--     as the RUNSHEET says (fbfba3d96, never this branch), commit; THEN cherry-pick this branch's commits in order and
--     apply the Friday-merge patch (recipe: builds/members-access-19nov.md, "THE MERGE RECIPE FOR MAIN").
--   PASTE ORDER: after 208 (and after 200; 213 may come before or after) AND after the 208 pages are live, Saturday 21
--   Nov daytime, 4 h or more after Friday went live (INBOX 725, 730). Dean pastes
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

-- A lock wait must not queue every members read behind this paste: give up after 5s, nothing changed (review 2 S3).
set local lock_timeout = '5s';

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
  if pg_get_viewdef('public.v_vp_members_list'::regclass) ~* '\m(email|mobile|postcode|note|marketing_optin\w*|birth\w*|date_of_birth|sex|suburb|state)\M' then
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
--   f) BEHAVIOUR, not just definitions (review 2 S4 + main review S3, INBOX 730: ONE block; NOT RUN anywhere yet). Reads as a real OWNER and a real HOST through
--      row security, exactly as their signed-in pages would, and WRITES NOTHING: the block runs as one statement and
--      always ends in its own raise, which rolls the whole statement back (set local role and the claims go with it).
--      Its result is the error text "READ-BACK f (nothing changed): ...". Find two ids first (read only). The HOST
--      must be a login that is NOT an owner or manager at ANY venue (main review 2 S5, INBOX 734): a person who owns
--      venue A and hosts at venue B rightly reads venue A's full rows, so as "the host" it would say WRONG for nothing.
--      This lookup lists only such hosts, and every venue's members count:
--        select s.auth_user_id, s.venue_id, s.role,
--               (select count(*) from public.vp_members m join public.vp_member_rosters r on r.id = m.roster_id
--                 where r.venue_id = s.venue_id) as members
--          from public.vp_venue_staff s
--         where s.auth_user_id is not null
--           and (s.role = 'owner'
--                or (s.role = 'host' and not exists (select 1 from public.vp_venue_staff o
--                                                     where o.auth_user_id = s.auth_user_id
--                                                       and o.role in ('owner', 'manager'))))
--         order by s.venue_id, s.role;
--      pick an owner and a host AT A VENUE WITH MEMBERS (members > 0), put their auth_user_id in the two lines below,
--      run it. (A test venue such as the Mini Bar is fine.) The block checks the host again itself. It prints a
--      VERDICT first:
--        OK                      owner: table = view = the full count; host: table 0, view = the names count.
--        WRONG                   a host reads the table, a host's view is short, or the owner lost rows: run the
--                                ROLLBACK below STRAIGHT AWAY, then tell main (hosts or owners would be locked out).
--        NOT A TEST              the chosen venue has no members, or the "host" is an owner or manager somewhere:
--                                pick another and run it again. Nothing to roll back.
--      Any other error (for example the ids were not filled in): nothing changed; fix and run again. After OK, open the
--      host console at that venue and see the members list.
--   do $rb$
--   declare
--     owner_id text := '<OWNER auth_user_id>';
--     host_id  text := '<HOST auth_user_id>';
--     owner_expected bigint; owner_view_expected bigint; host_expected bigint; host_owner_rows bigint;
--     owner_table bigint; owner_view bigint; host_table bigint; host_view bigint; verdict text;
--   begin
--     select count(*) into owner_expected from public.vp_members m join public.vp_member_rosters r on r.id = m.roster_id
--      where r.venue_id in (select s.venue_id from public.vp_venue_staff s
--                            where s.auth_user_id = owner_id::uuid and s.role in ('owner', 'manager'));
--     select count(*) into owner_view_expected from public.vp_members m join public.vp_member_rosters r on r.id = m.roster_id
--      where r.venue_id in (select s.venue_id from public.vp_venue_staff s where s.auth_user_id = owner_id::uuid);
--     select count(*) into host_expected from public.vp_members m join public.vp_member_rosters r on r.id = m.roster_id
--      where r.venue_id in (select s.venue_id from public.vp_venue_staff s where s.auth_user_id = host_id::uuid);
--     select count(*) into host_owner_rows from public.vp_venue_staff s
--      where s.auth_user_id = host_id::uuid and s.role in ('owner', 'manager');
--     perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
--     perform set_config('request.jwt.claim.sub', owner_id, true);
--     execute 'set local role authenticated';
--     execute 'select count(*) from public.vp_members' into owner_table;
--     execute 'select count(*) from public.v_vp_members_list' into owner_view;
--     perform set_config('request.jwt.claims', json_build_object('sub', host_id, 'role', 'authenticated')::text, true);
--     perform set_config('request.jwt.claim.sub', host_id, true);
--     execute 'select count(*) from public.vp_members' into host_table;
--     execute 'select count(*) from public.v_vp_members_list' into host_view;
--     verdict := case
--       when owner_expected = 0 or host_expected = 0 then 'NOT A TEST'
--       when host_owner_rows > 0 then 'NOT A TEST: that host is an owner or manager somewhere, pick another host'
--       when owner_table = owner_expected and owner_view = owner_view_expected and host_table = 0
--            and host_view = host_expected then 'OK'
--       else 'WRONG: run the ROLLBACK now' end;
--     raise exception 'READ-BACK f (nothing changed): %. owner_table=% (expect %) owner_view=% (expect %) host_table=% (expect 0) host_view=% (expect %)',
--       verdict, owner_table, owner_expected, owner_view, owner_view_expected, host_table, host_view, host_expected;
--   end
--   $rb$;
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
