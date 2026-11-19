-- =====================================================================
-- Migration 218: 17 tables the browser never writes become SELECT-only for HQ logins (and for every browser login)
-- ---------------------------------------------------------------------
-- Review R2/R3 of the platform-admins fix (217), 18 Nov 2026. Map: ~/venue-enrich/builds/admin-forall-policies-map-18nov.md
-- Notes: ~/venue-enrich/builds/admin-forall-lockdown-18nov.md
--
-- WRITTEN, NOT RUN. Not run on TEST, not run on LIVE. Ships only on Dean's yes.
-- Branch fix/admin-forall-lockdown-18nov (stacked on the 217 review fixes, 77489811). Safe to run more than once.
-- NUMBER: 218 claimed in ~/venue-enrich/builds/migration-register.json (check-migration-numbers.py --claim, 18 Nov 2026).
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements between the guard's END marker and the end of the file (as for 208 and 217).
--
-- WHAT WAS OPEN. Each table below has a FOR ALL policy for any HQ admin (vp_is_admin() or vp_is_platform_admin()) plus
-- INSERT/UPDATE/DELETE/TRUNCATE grants to authenticated (and anon). So ANY HQ login, staff included, could from the
-- browser console with its own token: add or delete a discount (real money off invoices), rewrite usage and group
-- invoices, edit or delete audit rows and forge new ones (the Worker ACTS on some audit rows: the one-hour undo, payment
-- disputes, the VIC permit check), rewrite draw results, prizes and raffle schedules (the QLD draw record), edit a
-- venue's members list header or opt-in export records, and edit any venue's TV screens, slides, playlists and questions.
-- Four of the tables (playlists, playlist songs, question sets, questions) also had a FOR ALL host_write policy, so a
-- venue's own host login could write its own venue's rows from the console too.
--
-- WHY THESE 17 AND NOTHING ELSE (checked in code, 18 Nov 2026):
--   * No browser page writes any of them: every .from("<table>") in venueplay/**/*.html and every vp-*.js / app js
--     (vendor excluded) is a select; the two non-literal .from(rel) calls (billing.html, members/host.html) are selects;
--     no write call in any page sits outside a .from( chain; no page posts to /rest/v1/<table>; the only browser .rpc()
--     is venueplay_spots_taken (SECURITY DEFINER, so grants do not touch it). The same scan of origin/main, the live
--     build efc35a34, every release/ and rehearsal/ branch and main at weekly points back to 15 Oct finds no browser
--     write to any of the 17 (the last one, onboard.html inserting vp_screens, went on 15 Oct, 99c26a8b).
--   * Both Workers write them with the service key only (every /rest/v1 header in venueplay-api-FULL.js,
--     venueplay-game.js and venueplay-room.js is SUPABASE_SERVICE_KEY); service_role is not touched here.
--   * No SQL function or trigger in the repo writes them under the caller's rights: vp_members_draw and vp_bingo_ball
--     (76/90) and vp_park_flagged (32) are SECURITY DEFINER and service_role only; 40, 111, 147, 169 are one-off
--     statements. The TV apps (~/venueplay-tv-apps) only load tv.html. Tools that write them use the service key.
--   * LEFT OUT ON PURPOSE (a browser writes them today; each needs a Worker route first): vp_venue_staff (onboard.html),
--     vp_venue_groups (hq.html x3), vp_venues (hq.html group move), vp_venue_settings (vp-session.js saveSettings).
--     This file does not touch them.
--
-- WHAT THIS CHANGES (no column, no row, no function changes), per table:
--   1. drop the FOR ALL admin policy (<t>_admin_all); on the four content tables also drop <t>_host_write (FOR ALL).
--   2. create <t>_admin_select: FOR SELECT, the SAME roles and the SAME predicate as the dropped admin policy (copied
--      from RLS-BASELINE.json), so HQ reads exactly what it read before (HQ's lists, audit, discounts, usage).
--      The host_write drop removes no read: each table's host_select already covers every row host_write covered
--      (question sets and playlists: own venue OR library; songs and questions: rows of those sets/playlists).
--      vp_discounts and vp_billing_usage keep their existing admin_read (vp_is_platform_admin()) as well.
--   3. revoke insert, update, delete, truncate, references, trigger from public, anon and authenticated.
--      SELECT stays where it was (anon and authenticated, as RLS-BASELINE.json has it); RLS still decides the rows.
--   vp_admin_audit: no INSERT policy at all. Only the Worker (service_role) writes audit rows (vpaAudit, and HQ's own
--   marks go through POST /admin/audit, allowlisted by VPA_HQ_AUDIT_ACTIONS).
--
-- ORDER (read this). PASTE THIS FIRST, read it back, THEN release the branch that carries the new RLS-BASELINE.json.
--   1. Optional pre-check (read only, LIVE SQL editor), expect 0 rows: no function that is NOT security definer writes
--      any of the 17 tables (the repo cannot see live-only functions):
--        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--         where n.nspname = 'public' and not p.prosecdef
--           and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(vp_admin_audit|vp_billing_usage|vp_discounts|vp_group_invoice_lines|vp_group_invoices|vp_member_draw_results|vp_member_draws|vp_member_rosters|vp_optin_exports|vp_playlist_songs|vp_playlists|vp_question_sets|vp_questions|vp_raffle_prizes|vp_raffle_schedules|vp_screen_slides|vp_screens)\M';
--   2. Dean pastes this file (the statements after the guard's END marker) into the live SQL editor and runs the
--      READ-BACK queries at the end.
--   3. Then the release goes out the normal way. release.py step 5 (dump-rls-baseline.py --check) compares live with
--      the branch's RLS-BASELINE.json, which already carries the post-218 state: it is RED if 218 is not live yet.
--   Safe for the build that is live now and for every build since 15 Oct: none of them writes these tables from a
--   browser, so pasting first breaks nothing a venue or HQ can tap. No Worker change ships with it.
-- rollback-safe: any build since 15 Oct 2026 keeps working after this runs. No browser page in those builds writes these 17 tables (scanned per build), the Workers use the service key, and every SELECT path is kept with the same predicate.
--
-- After it runs on LIVE: python3 venueplay-backend/tools/dump-rls-baseline.py --check should pass against this
-- branch's RLS-BASELINE.json (21 policies swapped for 17, 204 grant lines gone, SELECT kept).
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

-- vp_admin_audit (was vp_admin_audit_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_admin_audit_admin_all on public.vp_admin_audit;
drop policy if exists vp_admin_audit_admin_select on public.vp_admin_audit;
create policy vp_admin_audit_admin_select on public.vp_admin_audit
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_admin_audit from public, anon, authenticated;

-- vp_billing_usage (was vp_billing_usage_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_billing_usage_admin_all on public.vp_billing_usage;
drop policy if exists vp_billing_usage_admin_select on public.vp_billing_usage;
create policy vp_billing_usage_admin_select on public.vp_billing_usage
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_billing_usage from public, anon, authenticated;

-- vp_discounts (was vp_discounts_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_discounts_admin_all on public.vp_discounts;
drop policy if exists vp_discounts_admin_select on public.vp_discounts;
create policy vp_discounts_admin_select on public.vp_discounts
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_discounts from public, anon, authenticated;

-- vp_group_invoice_lines (was vp_group_invoice_lines_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_group_invoice_lines_admin_all on public.vp_group_invoice_lines;
drop policy if exists vp_group_invoice_lines_admin_select on public.vp_group_invoice_lines;
create policy vp_group_invoice_lines_admin_select on public.vp_group_invoice_lines
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_group_invoice_lines from public, anon, authenticated;

-- vp_group_invoices (was vp_group_invoices_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_group_invoices_admin_all on public.vp_group_invoices;
drop policy if exists vp_group_invoices_admin_select on public.vp_group_invoices;
create policy vp_group_invoices_admin_select on public.vp_group_invoices
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_group_invoices from public, anon, authenticated;

-- vp_member_draw_results (was vp_member_draw_results_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_member_draw_results_admin_all on public.vp_member_draw_results;
drop policy if exists vp_member_draw_results_admin_select on public.vp_member_draw_results;
create policy vp_member_draw_results_admin_select on public.vp_member_draw_results
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_member_draw_results from public, anon, authenticated;

-- vp_member_draws (was vp_member_draws_admin_all: FOR ALL to public, vp_is_platform_admin())
drop policy if exists vp_member_draws_admin_all on public.vp_member_draws;
drop policy if exists vp_member_draws_admin_select on public.vp_member_draws;
create policy vp_member_draws_admin_select on public.vp_member_draws
  for select to public
  using (public.vp_is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_member_draws from public, anon, authenticated;

-- vp_member_rosters (was vp_member_rosters_admin_all: FOR ALL to public, vp_is_platform_admin())
drop policy if exists vp_member_rosters_admin_all on public.vp_member_rosters;
drop policy if exists vp_member_rosters_admin_select on public.vp_member_rosters;
create policy vp_member_rosters_admin_select on public.vp_member_rosters
  for select to public
  using (public.vp_is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_member_rosters from public, anon, authenticated;

-- vp_optin_exports (was vp_optin_exports_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_optin_exports_admin_all on public.vp_optin_exports;
drop policy if exists vp_optin_exports_admin_select on public.vp_optin_exports;
create policy vp_optin_exports_admin_select on public.vp_optin_exports
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_optin_exports from public, anon, authenticated;

-- vp_playlist_songs (was vp_playlist_songs_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_playlist_songs_admin_all on public.vp_playlist_songs;
drop policy if exists vp_playlist_songs_host_write on public.vp_playlist_songs;
drop policy if exists vp_playlist_songs_admin_select on public.vp_playlist_songs;
create policy vp_playlist_songs_admin_select on public.vp_playlist_songs
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_playlist_songs from public, anon, authenticated;

-- vp_playlists (was vp_playlists_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_playlists_admin_all on public.vp_playlists;
drop policy if exists vp_playlists_host_write on public.vp_playlists;
drop policy if exists vp_playlists_admin_select on public.vp_playlists;
create policy vp_playlists_admin_select on public.vp_playlists
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_playlists from public, anon, authenticated;

-- vp_question_sets (was vp_question_sets_admin_all: FOR ALL to public, vp_is_platform_admin())
drop policy if exists vp_question_sets_admin_all on public.vp_question_sets;
drop policy if exists vp_question_sets_host_write on public.vp_question_sets;
drop policy if exists vp_question_sets_admin_select on public.vp_question_sets;
create policy vp_question_sets_admin_select on public.vp_question_sets
  for select to public
  using (public.vp_is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_question_sets from public, anon, authenticated;

-- vp_questions (was vp_questions_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_questions_admin_all on public.vp_questions;
drop policy if exists vp_questions_host_write on public.vp_questions;
drop policy if exists vp_questions_admin_select on public.vp_questions;
create policy vp_questions_admin_select on public.vp_questions
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_questions from public, anon, authenticated;

-- vp_raffle_prizes (was vp_raffle_prizes_admin_all: FOR ALL to public, vp_is_platform_admin())
drop policy if exists vp_raffle_prizes_admin_all on public.vp_raffle_prizes;
drop policy if exists vp_raffle_prizes_admin_select on public.vp_raffle_prizes;
create policy vp_raffle_prizes_admin_select on public.vp_raffle_prizes
  for select to public
  using (public.vp_is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_raffle_prizes from public, anon, authenticated;

-- vp_raffle_schedules (was vp_raffle_schedules_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_raffle_schedules_admin_all on public.vp_raffle_schedules;
drop policy if exists vp_raffle_schedules_admin_select on public.vp_raffle_schedules;
create policy vp_raffle_schedules_admin_select on public.vp_raffle_schedules
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_raffle_schedules from public, anon, authenticated;

-- vp_screen_slides (was vp_screen_slides_admin_all: FOR ALL to authenticated, vp_is_admin())
drop policy if exists vp_screen_slides_admin_all on public.vp_screen_slides;
drop policy if exists vp_screen_slides_admin_select on public.vp_screen_slides;
create policy vp_screen_slides_admin_select on public.vp_screen_slides
  for select to authenticated
  using (public.vp_is_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_screen_slides from public, anon, authenticated;

-- vp_screens (was vp_screens_admin_all: FOR ALL to public, vp_is_platform_admin())
drop policy if exists vp_screens_admin_all on public.vp_screens;
drop policy if exists vp_screens_admin_select on public.vp_screens;
create policy vp_screens_admin_select on public.vp_screens
  for select to public
  using (public.vp_is_platform_admin());
revoke insert, update, delete, truncate, references, trigger on public.vp_screens from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs). T = the 17 tables:
--   ('vp_admin_audit','vp_billing_usage','vp_discounts','vp_group_invoice_lines','vp_group_invoices','vp_member_draw_results',
--    'vp_member_draws','vp_member_rosters','vp_optin_exports','vp_playlist_songs','vp_playlists','vp_question_sets',
--    'vp_questions','vp_raffle_prizes','vp_raffle_schedules','vp_screen_slides','vp_screens')
--   a) no FOR ALL policy left on any of them (expect 0 rows):
--   select tablename, policyname from pg_policies where schemaname = 'public' and cmd = 'ALL' and tablename in (T);
--   b) one admin SELECT policy on each (expect 17 rows, cmd SELECT):
--   select tablename, policyname, cmd, array_to_string(roles, ','), qual from pg_policies
--    where schemaname = 'public' and policyname like '%\_admin\_select' and tablename in (T) order by 1;
--   c) no write grant left to anon or authenticated (expect 0 rows):
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in (T) and grantee in ('anon', 'authenticated', 'PUBLIC')
--      and privilege_type <> 'SELECT';
--   d) SELECT still granted (expect 34 rows: anon and authenticated on each):
--   select table_name, grantee from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in (T) and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
--   e) the four left-out tables are unchanged (expect vp_venue_staff_admin_all, vp_venue_groups_admin_all,
--      vp_venues_admin_all, vp_venue_settings_admin_all, all cmd ALL):
--   select tablename, policyname, cmd from pg_policies where schemaname = 'public' and policyname like '%\_admin\_all'
--      and tablename in ('vp_venue_staff', 'vp_venue_groups', 'vp_venues', 'vp_venue_settings');
--
-- ROLLBACK (puts back exactly what live has today, RLS-BASELINE.json before this branch; this RE-OPENS the writes):
--   for each table T with its old roles R and predicate P (listed in the comment above its block):
--     drop policy if exists T_admin_select on public.T;
--     create policy T_admin_all on public.T for all to R using (public.P) with check (public.P);
--     grant insert, update, delete, truncate, references, trigger on public.T to anon, authenticated;
--   and on the four content tables re-create T_host_write exactly as RLS-BASELINE.json had it (git show 77489811:
--   venueplay-backend/supabase/RLS-BASELINE.json), then notify pgrst, 'reload schema'.
--   Nothing needs rolling back for an older build: none writes these tables from a browser.
