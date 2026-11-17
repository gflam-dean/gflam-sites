-- =====================================================================
-- Migration 217: the browser can READ the HQ Team list (vp_platform_admins) but never write it
-- ---------------------------------------------------------------------
-- HQ admin routes review, 18 Nov 2026, finding F1 (HIGH, pre-existing).
--
-- WRITTEN, NOT RUN. Not run on TEST, not run on LIVE. Ships only on Dean's yes.
-- Branch fix/platform-admins-no-browser-write-18nov. Safe to run more than once.
-- NUMBER: 217 claimed in ~/venue-enrich/builds/migration-register.json (check-migration-numbers.py --claim, 18 Nov 2026).
-- The file as committed carries the VP-STAGING-GUARD block, which REFUSES on the live project: the live run is the
-- statements between the guard's END marker and the end of the file (as for 197 and 208).
--
-- WHAT WAS OPEN. Policy vp_platform_admins_admin_all (FOR ALL to authenticated, USING and WITH CHECK vp_is_admin())
-- plus INSERT/UPDATE/DELETE/TRUNCATE grants to authenticated let ANY HQ login (owner, accounts or staff) write any
-- column of any row of vp_platform_admins from the browser console with its own token, e.g.
--   VP.getClient().from("vp_platform_admins").update({role:"owner"}).eq("auth_user_id", <me>)
-- WITH CHECK still passes (they are still an admin afterwards). Every Worker role gate (vpaRequireAdmin in the API
-- Worker, the game Worker's owner/accounts lookups, vp_resolve_actor-style SQL functions) reads the role from this
-- same table, so a staff login could make itself owner and then reach owner/accounts-only routes (venue contact
-- mobiles, accounts, billing changes, Team). It could also insert an admin row for any auth user, or delete the
-- owner's row. anon held the same grants but had no policy, so anon could do nothing (RLS on, no anon policy).
--
-- WHAT THIS CHANGES (no column, no row, no function changes):
--   1. drop policy vp_platform_admins_admin_all.
--   2. create policy vp_platform_admins_admin_select: FOR SELECT to authenticated USING (vp_is_admin()).
--      Same rows readable as before, by the same people: an HQ admin reads every row (the Team tab lists them all,
--      hq.html loadAll and the refresh after Add); a non-admin reads nothing (vp-session.js reads its own row
--      and gets none, which is how it already learns "not HQ").
--   3. revoke insert, update, delete, truncate, references, trigger on vp_platform_admins from anon and
--      authenticated, and revoke select from anon (anon never read a row: no anon policy). authenticated keeps
--      SELECT only. service_role (both Workers) keeps everything; it is not touched.
--   vp_is_admin() and vp_is_platform_admin() are SECURITY DEFINER, so their own read of this table does not
--   depend on these grants or policies. Checked in RLS-BASELINE.json: security_definer_functions.
--
-- WHO WRITES THE TABLE AFTER THIS (all service_role, all owner-gated, all audited):
--   POST /admin/staff         add a login or change an existing one's role by re-adding it (owner; never your own)
--   POST /admin/staff-name    rename (any admin their own label, an owner anyone's; never the role)
--   POST /admin/staff-remove  remove a login from the Team list (owner; never yourself; never the last owner) NEW
--   venueplay-backend/tools/live-overage-test.py (service key, Dean's own run) and tools/staging/seed-test-data.sql.
--
-- ORDER (NOT rollback-safe, read this). Paste this ONLY AFTER the API Worker with /admin/staff-remove AND the hq.html
-- that calls it are both live. If this runs first, the OLD hq.html Team tab Remove button (a browser DELETE) fails
-- with "Could not remove: permission denied for table vp_platform_admins" and removes nobody. Nothing else in any
-- page writes this table (checked 18 Nov 2026 over venueplay/app, every vp-*.js, both Workers, supabase/*.sql and
-- tools). So: an OLDER build rolled back to after this has run loses only Team > Remove until it is re-released.
-- No rollback-safe line is written for that reason.
--
-- After it runs on LIVE: python3 venueplay-backend/tools/dump-rls-baseline.py --check should pass against this
-- branch's RLS-BASELINE.json, which already carries the post-migration state (one policy swapped, 13 grants gone).
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

drop policy if exists vp_platform_admins_admin_all on public.vp_platform_admins;
drop policy if exists vp_platform_admins_admin_select on public.vp_platform_admins;
create policy vp_platform_admins_admin_select on public.vp_platform_admins
  for select to authenticated
  using (public.vp_is_admin());

revoke insert, update, delete, truncate, references, trigger on public.vp_platform_admins from anon, authenticated;
revoke select on public.vp_platform_admins from anon;
grant select on public.vp_platform_admins to authenticated;

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs):
--   select policyname, cmd, array_to_string(roles, ',') from pg_policies
--    where schemaname = 'public' and tablename = 'vp_platform_admins';              -- vp_platform_admins_admin_select | SELECT | authenticated
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'vp_platform_admins' and grantee in ('anon', 'authenticated');
--                                                                                   -- authenticated SELECT, and nothing else
--
-- ROLLBACK (puts back exactly what live has today, RLS-BASELINE.json before this branch; this RE-OPENS F1):
--   drop policy if exists vp_platform_admins_admin_select on public.vp_platform_admins;
--   create policy vp_platform_admins_admin_all on public.vp_platform_admins for all to authenticated
--     using (public.vp_is_admin()) with check (public.vp_is_admin());
--   grant select, insert, update, delete, truncate, references, trigger on public.vp_platform_admins to anon, authenticated;
--   notify pgrst, 'reload schema';
