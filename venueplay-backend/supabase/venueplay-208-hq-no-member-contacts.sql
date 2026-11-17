-- =====================================================================
-- Migration 208: an HQ admin's own login no longer reads a members list's email or mobile (Dean's open question 10)
-- ---------------------------------------------------------------------
-- Question 10 (16 Nov 2026): "Block HQ admin database reads of members' email/mobile?" Suggested answer yes: player and
-- member data is tier one. A club's members list belongs to that club (privacy draft section 2: "held for that club
-- alone"), so HQ staff see counts and names where the product needs them, never the member's email or mobile.
--
-- WRITTEN, RUN ON TEST ONLY (rkfaftxgzpsmmrzudlqy, twice). NOT RUN ON LIVE. Ships only on Dean's yes.
-- Branch feature/hq-no-member-contacts-q10. Safe to run more than once.
-- NUMBER: 195 to 207 are all taken on other branches or worktrees (checked every branch and worktree 17 Nov 2026 22:10
-- Brisbane), so 208.
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements between the guard's END marker and the end of the file (as for 197).
--
-- HOW AN HQ ADMIN READ THEM BEFORE. Not through the Workers: no Worker route returns a member's email or mobile (the API
-- Worker only counts members; the game Worker's /host/members/* routes return ids, numbers and names). The opening was
-- the database itself: policy vp_members_admin_all (FOR ALL, USING vp_is_platform_admin()) let any HQ admin login read
-- every column of every club's members list straight from the browser, and HQ's "View as" runs the venue's pages on the
-- admin's own login. With migration 200 (members upload) those columns hold email, mobile and postcode.
--
-- WHAT THIS CHANGES (nothing is dropped from any table; no column, no row, no grant to a venue's own staff changes):
--   1. drop policy vp_members_admin_all. vp_members_host_select stays exactly as it is, so a venue's OWN staff read
--      their own list (every column, their own venues only) the way they always have.
--   2. new view v_vp_members_list: id, roster_id, member_number, first_name, last_name, status, updated_at for the
--      rows of rosters at the caller's own venues (vp_staff_venue_ids) or, for an HQ admin, every venue. NO email, NO
--      mobile, NO postcode, NO consent, NO note. Owner rights (like v_vp_player_optins), security_barrier on, select to
--      authenticated only; anon has nothing.
--   The members console and the account page read the table first and, when it answers with nobody (which is what an
--   HQ admin's View as now gets), read this view, so HQ still sees the count and the names.
--
-- WHAT HQ LOSES (all of it on purpose, or unused):
--   - View as > a club's members list download (the account page, "members-list.csv") comes back "There is nobody on
--     your members list." for an HQ admin: the download reads the table, and the table no longer answers HQ. The club's
--     own login downloads as before.
--   - HQ admin logins can no longer insert, update or delete vp_members rows directly from the browser. Nothing does:
--     every members write goes through the game Worker (service role). Checked 17 Nov 2026 over venueplay/ and tools/.
--   - An HQ admin who is ALSO staff at a venue (a vp_venue_staff row on their own login) still reads that venue's list in
--     full, as that venue's staff. That is the venue's own grant, not HQ's.
--
-- ORDER: either order is safe. Before this runs the pages' table read answers HQ as before (and the view is never
-- asked). After it runs with old pages, View as shows the members console and the account page with no members (no
-- error, nothing leaks) until the new pages ship. Needs vp_members and vp_member_rosters (migration 76); does not need
-- migration 200 (the view names none of 200's columns).
--
-- After it runs on LIVE: python3 venueplay-backend/tools/dump-rls-baseline.py (one policy gone, one view and its grant
-- added). This branch's RLS-BASELINE.json already carries that post-migration state.
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

drop policy if exists vp_members_admin_all on public.vp_members;

create or replace view public.v_vp_members_list with (security_barrier = true) as
  select m.id, m.roster_id, m.member_number, m.first_name, m.last_name, m.status, m.updated_at
    from public.vp_members m
    join public.vp_member_rosters r on r.id = m.roster_id
   where r.venue_id in (select public.vp_staff_venue_ids())
      or public.vp_is_platform_admin();

revoke all on public.v_vp_members_list from public, anon, authenticated;
grant select on public.v_vp_members_list to authenticated;
grant select on public.v_vp_members_list to service_role;

comment on view public.v_vp_members_list is
  'A members list WITHOUT contact details: number, names, status. A venue''s own staff see their own venues; an HQ admin sees every venue. Never email, mobile, postcode or consent (Dean''s open question 10, migration 208).';

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs):
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'vp_members' and policyname = 'vp_members_admin_all';   -- 0
--   select policyname from pg_policies where schemaname = 'public' and tablename = 'vp_members';                                      -- vp_members_host_select only
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'v_vp_members_list';
--     -- id, roster_id, member_number, first_name, last_name, status, updated_at (no email, no mobile)
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'v_vp_members_list' and grantee in ('anon', 'authenticated');                    -- authenticated SELECT only
--
-- ROLLBACK (puts back exactly what live has today, RLS-BASELINE.json before this branch):
--   create policy vp_members_admin_all on public.vp_members for all to public
--     using (public.vp_is_platform_admin()) with check (public.vp_is_platform_admin());
--   drop view if exists public.v_vp_members_list;
--   notify pgrst, 'reload schema';
