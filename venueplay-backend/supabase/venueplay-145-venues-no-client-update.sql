-- =====================================================================
-- Migration 145: a venue login can no longer write its own vp_venues row
-- ---------------------------------------------------------------------
--   NOT RUN. Security audit 3 Nov 2026, finding H1. Branch fix/security-3nov.
--   Number checked on every branch and every worktree on 3 Nov 2026: 144 is the help-alerts
--   migration, 145, 146 and 147 were free and are claimed by this branch.
--
--   ORDER: any order with both Workers and the site. Nothing a venue page does writes vp_venues
--   directly (checked below), so nothing a venue sees changes. Safe to run more than once.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and commit
--   RLS-BASELINE.json (one policy gone, the table UPDATE grants replaced by one column grant).
--
-- THE HOLE. Policy vp_venues_manager_update let any login with an owner or manager staff row
-- UPDATE its own venue row, and authenticated held UPDATE on every column. The publishable key
-- is in every page and supabase-js keeps the session in the browser, so a manager could send
--   PATCH /rest/v1/vp_venues?id=eq.<their venue>  {"max_players":500}
-- and get 500 seats on a 20-player plan with no overage, or {"status":"active"} to undo an HQ
-- suspension for non-payment (assertVenueActive reads only that column), or rewrite
-- pending_players, overage_streak*, last_trivia_at / last_musical_at (the weekly-nights rule),
-- broadcast_enforce, group_id or founding_id.
--
-- WHO WRITES vp_venues FROM A BROWSER TODAY (grep of every page and script under venueplay/,
-- 3 Nov 2026, for .from("vp_venues").update / upsert / insert / delete and /rest/v1/vp_venues):
--   venueplay/app/hq.html  "Groups" tick:  .update({ group_id }) by an HQ admin, allowed by the
--                          admin policies (vp_venues_admin_all / vp_venues_admin_write).
--   Nothing else. Every venue-side write (settings, permits, logos, players, cancel, terms tick)
--   goes through a Worker as the service role, which this migration does not touch.
-- So: the manager policy goes, UPDATE is taken off anon and authenticated, and authenticated
-- gets back UPDATE on group_id ONLY, which the admin policies still limit to HQ admins.
-- =====================================================================

-- ============ STEP 1 (READ ONLY, run first if you like) =============
-- What can a venue login update on vp_venues right now? Every column back = the hole is live.
--
-- select grantee, count(*) as columns_updatable
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'vp_venues'
--    and grantee in ('anon','authenticated') and privilege_type = 'UPDATE'
--  group by grantee;
--
-- select policyname, cmd, roles from pg_policies
--  where schemaname = 'public' and tablename = 'vp_venues' order by policyname;

begin;

drop policy if exists vp_venues_manager_update on public.vp_venues;

revoke update on public.vp_venues from anon;
revoke update on public.vp_venues from authenticated;
-- The one direct browser write: HQ's group tick. Still gated to HQ admins by the admin policies.
grant update (group_id) on public.vp_venues to authenticated;

-- SELF-CHECK: refuse to commit unless the hole is shut and the HQ write still has its column.
do $check$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vp_venues'
              and policyname = 'vp_venues_manager_update') then
    raise exception 'Migration 145 self-check: vp_venues_manager_update is still there';
  end if;
  if has_column_privilege('authenticated', 'public.vp_venues', 'max_players', 'update')
     or has_column_privilege('authenticated', 'public.vp_venues', 'status', 'update')
     or has_column_privilege('authenticated', 'public.vp_venues', 'suspended_reason', 'update')
     or has_column_privilege('authenticated', 'public.vp_venues', 'founding_id', 'update')
     or has_column_privilege('anon', 'public.vp_venues', 'max_players', 'update')
     or has_column_privilege('anon', 'public.vp_venues', 'status', 'update') then
    raise exception 'Migration 145 self-check: a venue login or the public key can still update billing columns on vp_venues';
  end if;
  if not has_column_privilege('authenticated', 'public.vp_venues', 'group_id', 'update') then
    raise exception 'Migration 145 self-check: HQ''s group tick (group_id) lost its grant';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vp_venues'
                  and policyname in ('vp_venues_admin_all', 'vp_venues_admin_write')) then
    raise exception 'Migration 145 self-check: no HQ admin policy on vp_venues, so the group tick would stop working';
  end if;
end;
$check$;

commit;

-- ============ READ BACK (READ ONLY, after running) ===================
-- Expect: authenticated 1 (group_id), anon nothing; and no vp_venues_manager_update.
--
-- select grantee, column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'vp_venues'
--    and grantee in ('anon','authenticated') and privilege_type = 'UPDATE'
--  order by grantee, column_name;
--
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'vp_venues' order by policyname;
--
-- In HQ: tick a test venue into a group and back (Groups panel). It must still save.

-- Rollback (puts the hole back; only if something breaks):
--   grant update on public.vp_venues to authenticated;
--   create policy vp_venues_manager_update on public.vp_venues for update to authenticated
--     using (exists (select 1 from vp_venue_staff s where s.venue_id = vp_venues.id
--                    and s.auth_user_id = auth.uid() and s.role = any (array['owner','manager'])))
--     with check (exists (select 1 from vp_venue_staff s where s.venue_id = vp_venues.id
--                    and s.auth_user_id = auth.uid() and s.role = any (array['owner','manager'])));
