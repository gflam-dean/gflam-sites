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
-- WHAT THIS CHANGES (no column, no row changes; one new service_role-only function):
--   1. drop policy vp_platform_admins_admin_all.
--   2. create policy vp_platform_admins_admin_select: FOR SELECT to authenticated USING (vp_is_admin()).
--      Same rows readable as before, by the same people: an HQ admin reads every row (the Team tab lists them all,
--      hq.html loadAll and the refresh after Add); a non-admin reads nothing (vp-session.js reads its own row
--      and gets none, which is how it already learns "not HQ").
--   3. revoke insert, update, delete, truncate, references, trigger on vp_platform_admins from public, anon and
--      authenticated, and revoke select from public and anon (anon never read a row: no anon policy). authenticated
--      keeps SELECT only. service_role (both Workers) keeps everything; it is not touched.
--   4. NEW function vp_hq_team_change(p_actor, p_target, p_action, p_role, p_label) returns jsonb, SECURITY DEFINER,
--      search_path pinned, EXECUTE for service_role only (revoked from public, anon, authenticated). The API Worker's
--      /admin/staff-remove and /admin/staff call it, so the owner check and the write happen in ONE transaction:
--      it locks every owner row (select ... for update, in one order), refuses unless the actor is still an owner,
--      refuses the actor's own row, refuses anything that would leave zero owners (remove or demote), then deletes or
--      upserts and returns { ok, was_role, label } or { ok:false, reason }. Two owners removing (or demoting) each
--      other at the same moment run one after the other: the second finds it is no longer an owner and is refused,
--      so HQ always keeps an owner. (Review R4, 18 Nov 2026.)
--   vp_is_admin() and vp_is_platform_admin() are SECURITY DEFINER, so their own read of this table does not
--   depend on these grants or policies. Checked in RLS-BASELINE.json: security_definer_functions.
--
-- WHO WRITES THE TABLE AFTER THIS (all service_role, all owner-gated, all audited):
--   POST /admin/staff         add a login or change an existing one's role by re-adding it (owner; never your own;
--                             through vp_hq_team_change)
--   POST /admin/staff-name    rename (any admin their own label, an owner anyone's; never the role)
--   POST /admin/staff-remove  remove a login from the Team list (owner; never yourself; never the last owner;
--                             through vp_hq_team_change) NEW
--   venueplay-backend/tools/live-overage-test.py (service key, Dean's own run) and tools/staging/seed-test-data.sql.
--
-- ORDER (read this). PASTE THIS FIRST, read it back, THEN release. (Review R1, 18 Nov 2026.)
--   1. Dean pastes this file (the statements after the guard's END marker) into the live SQL editor, and runs the
--      READ-BACK queries at the end.
--   2. Then the release (API Worker with /admin/staff-remove + hq.html) goes out the normal way.
--   Why this order: the branch's RLS-BASELINE.json already carries the post-217 state, and release.py step 5
--   (release-check.py, dump-rls-baseline.py --check against live) is RED if 217 is not live yet, so a release before
--   the paste stops red and may be rolled back for nothing. Release step 0 (check-migrations-live.py) also looks for
--   /rpc/vp_hq_team_change in the live schema, so it stops a release that comes first. The new Worker also needs the
--   function: without it, Team Remove and Add answer "could not check the Team list just now" and change nothing.
--   The cost of pasting first: until the release lands, the OLD hq.html Team tab Remove button (a browser DELETE)
--   fails with "Could not remove: permission denied for table vp_platform_admins" and removes nobody. Add and Edit
--   name keep working (the old Worker writes with the service key). Nothing else in any page writes this table
--   (checked 18 Nov 2026 over venueplay/app, every vp-*.js, both Workers, supabase/*.sql and tools).
--   NOT rollback-safe: an OLDER build rolled back to after this has run loses only Team > Remove until it is
--   re-released. No rollback-safe line is written for that reason.
--
-- After it runs on LIVE: python3 venueplay-backend/tools/dump-rls-baseline.py --check should pass against this
-- branch's RLS-BASELINE.json, which already carries the post-migration state (one policy swapped, 13 grants gone,
-- vp_hq_team_change listed as a definer function that anon and authenticated cannot execute).
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

revoke insert, update, delete, truncate, references, trigger on public.vp_platform_admins from public, anon, authenticated;
revoke select on public.vp_platform_admins from public, anon;
grant select on public.vp_platform_admins to authenticated;

-- The Team list's one writer (review R4): check and write in one transaction, owner rows locked.
create or replace function public.vp_hq_team_change(p_actor uuid, p_target uuid, p_action text, p_role text default null, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_owners uuid[];
  v_row public.vp_platform_admins%rowtype;
  v_had boolean;
begin
  if p_actor is null or p_target is null then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  if p_action is null or p_action not in ('remove', 'set') then return jsonb_build_object('ok', false, 'reason', 'bad_action'); end if;
  if p_action = 'set' and (p_role is null or p_role not in ('owner', 'accounts', 'staff')) then
    return jsonb_build_object('ok', false, 'reason', 'bad_role');
  end if;
  if p_actor = p_target then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  -- Lock every owner row, always in the same order, so two owners acting at once queue here instead of
  -- both passing the check. A row deleted by the transaction we waited for is skipped when we wake up.
  select coalesce(array_agg(o.auth_user_id), '{}'::uuid[]) into v_owners
    from (select a.auth_user_id from public.vp_platform_admins a
           where a.role::text = 'owner' order by a.auth_user_id for update) o;
  if not (p_actor = any(v_owners)) then return jsonb_build_object('ok', false, 'reason', 'not_owner'); end if;
  select * into v_row from public.vp_platform_admins where auth_user_id = p_target for update;
  v_had := found;
  if p_action = 'remove' then
    if not v_had then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if v_row.role::text = 'owner' and cardinality(array_remove(v_owners, p_target)) < 1 then
      return jsonb_build_object('ok', false, 'reason', 'last_owner');
    end if;
    delete from public.vp_platform_admins where auth_user_id = p_target;
    return jsonb_build_object('ok', true, 'was_role', v_row.role::text, 'label', v_row.label);
  end if;
  if v_had and v_row.role::text = 'owner' and p_role <> 'owner' and cardinality(array_remove(v_owners, p_target)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'last_owner');
  end if;
  insert into public.vp_platform_admins (auth_user_id, role, label)
  select r.auth_user_id, r.role, r.label
    from jsonb_populate_record(null::public.vp_platform_admins,
           jsonb_build_object('auth_user_id', p_target, 'role', p_role, 'label', p_label)) r
  on conflict (auth_user_id) do update set role = excluded.role, label = excluded.label;
  return jsonb_build_object('ok', true, 'was_role', case when v_had then v_row.role::text end, 'label', p_label);
end;
$fn$;
revoke all on function public.vp_hq_team_change(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.vp_hq_team_change(uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';

-- READ-BACK (read only, after it runs):
--   select policyname, cmd, array_to_string(roles, ',') from pg_policies
--    where schemaname = 'public' and tablename = 'vp_platform_admins';              -- vp_platform_admins_admin_select | SELECT | authenticated
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'vp_platform_admins' and grantee in ('anon', 'authenticated');
--                                                                                   -- authenticated SELECT, and nothing else
--   select has_function_privilege('anon', 'public.vp_hq_team_change(uuid,uuid,text,text,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.vp_hq_team_change(uuid,uuid,text,text,text)', 'execute'),
--          has_function_privilege('service_role', 'public.vp_hq_team_change(uuid,uuid,text,text,text)', 'execute');
--                                                                                   -- false | false | true
--
-- ROLLBACK (puts back exactly what live has today, RLS-BASELINE.json before this branch; this RE-OPENS F1):
--   drop policy if exists vp_platform_admins_admin_select on public.vp_platform_admins;
--   create policy vp_platform_admins_admin_all on public.vp_platform_admins for all to authenticated
--     using (public.vp_is_admin()) with check (public.vp_is_admin());
--   grant select, insert, update, delete, truncate, references, trigger on public.vp_platform_admins to anon, authenticated;
--   (leave vp_hq_team_change in place: the Worker that calls it needs it; it is service_role only.)
--   notify pgrst, 'reload schema';
