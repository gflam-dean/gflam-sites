-- wipe-test-db.sql
-- =====================================================================================
-- DESTRUCTIVE. RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc, NEVER LIVE.
-- THE LIVE PROJECT IS ijkzgmdtwtgfkedqspxm. IF THAT IS IN YOUR BROWSER'S ADDRESS BAR, STOP.
-- =====================================================================================
--
-- WHAT IT REMOVES, from the old Singapore project only:
--   * the whole "public" schema: every table, view, function, trigger, policy and ROW
--     (the real Sep 2026 venues, players, members lists, sign-ups, PartyPlay buyers,
--     touring contacts: personal data that must go), then an empty "public" with
--     Supabase's standard grants, ready for build-test-schema.sh;
--   * every auth user and everything hanging off them (identities, sessions, refresh
--     tokens, MFA rows), plus the auth audit log, flow state and one-time tokens;
--   * every scheduled job in pg_cron, if that extension is on;
--   * every secret in Supabase Vault, if any (they would be copies of old live-era keys).
--
-- WHAT IT DOES NOT REMOVE (on purpose):
--   * vp_staging.vp_staging_marker (the TEST lock itself);
--   * files in Storage. Supabase blocks deleting storage files with SQL, so the buckets are
--     emptied FIRST, in the dashboard (Storage, each bucket, "Empty bucket"). This script
--     REFUSES while any storage file is still there, so the order cannot be skipped.
--
-- BEFORE YOU RUN IT:
--   1. Main's backup exists: ~/Dropbox/GFLAM/VenuePlay/Backups/Old-database-backup-12Nov2026
--      (109 tables). Storage FILES are not in it: decide first (README question 6).
--   2. 01-mark-this-as-test.sql has been run on this project.
--   3. Every Storage bucket on this project is empty.
--
-- HOW: psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f tools/staging/wipe-test-db.sql
--      or paste into the SQL Editor of the Gflam (Singapore) project and Run.
-- It is one transaction: if any step fails, nothing at all is removed.
-- =====================================================================================

begin;

-- VP-STAGING-GUARD-BEGIN
do $guard$
declare n bigint;
begin
  if to_regclass('vp_staging.vp_staging_marker') is null then
    raise exception 'REFUSED: no TEST marker here. This is not the venueplay TEST project (gpoolavkghnxedzrmtmc), or 01-mark-this-as-test.sql was not run. Nothing was changed.';
  end if;
  execute 'select count(*) from vp_staging.vp_staging_marker where project_ref = ''gpoolavkghnxedzrmtmc''' into n;
  if n <> 1 then
    raise exception 'REFUSED: the TEST marker does not name gpoolavkghnxedzrmtmc. Nothing was changed.';
  end if;
  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '61400000%');
  if n > 0 then
    raise exception 'REFUSED: % real person(s) signed in here since 1 Oct 2026. The TEST project only ever has fake users. Is this LIVE? Nothing was changed.', n;
  end if;
end
$guard$;
-- VP-STAGING-GUARD-END

-- Storage must already be empty (see above).
do $storage$
declare n bigint;
begin
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects' into n;
    if n > 0 then
      raise exception 'REFUSED: % file(s) still in Storage. Empty every bucket in the dashboard first (Storage, bucket, Empty bucket), then run this again. Nothing was changed.', n;
    end if;
  end if;
end
$storage$;

-- Say what is about to go, so the output is a record.
do $report$
declare r record; n bigint;
begin
  select count(*) into n from auth.users;
  raise notice 'about to remove: % auth user(s)', n;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' order by 1 loop
    execute format('select count(*) from public.%I', r.relname) into n;
    if n > 0 then raise notice 'about to remove: public.% (% rows)', r.relname, n; end if;
  end loop;
  -- Anything in a schema we did not create and do not wipe: named so a person decides.
  for r in select distinct s.nspname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where c.relkind = 'r'
             and s.nspname not in ('public', 'auth', 'storage', 'vp_staging', 'realtime', 'supabase_functions',
                                   'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'pgsodium',
                                   'pgsodium_masks', 'vault', 'net', 'cron', 'pgbouncer', '_realtime', '_analytics',
                                   'information_schema', 'pg_catalog', 'pg_toast')
  loop
    raise notice 'NOT WIPED, A PERSON MUST LOOK: schema % has tables', r.nspname;
  end loop;
end
$report$;

-- Scheduled jobs and stored secrets: old live-era copies, never wanted on TEST.
do $jobs$
declare n bigint;
begin
  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job' into n;
    execute 'select cron.unschedule(jobid) from cron.job';
    raise notice 'removed % pg_cron job(s)', n;
  end if;
  if to_regclass('vault.secrets') is not null then
    execute 'select count(*) from vault.secrets' into n;
    execute 'delete from vault.secrets';
    raise notice 'removed % Vault secret(s)', n;
  end if;
end
$jobs$;

-- Auth: every user goes (identities, sessions, refresh tokens and MFA rows cascade from users).
delete from auth.users;
do $authx$
begin
  if to_regclass('auth.audit_log_entries') is not null then execute 'delete from auth.audit_log_entries'; end if;
  if to_regclass('auth.flow_state')        is not null then execute 'delete from auth.flow_state'; end if;
  if to_regclass('auth.one_time_tokens')   is not null then execute 'delete from auth.one_time_tokens'; end if;
  if to_regclass('auth.saml_relay_states') is not null then execute 'delete from auth.saml_relay_states'; end if;
end
$authx$;

-- public: gone, then back empty with Supabase's standard grants.
-- (CASCADE also drops anything elsewhere that leaned on public, e.g. a storage policy calling a
-- public function; build-test-schema.sh puts live's storage policies back.)
drop schema public cascade;
create schema public;
comment on schema public is 'standard public schema';
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges for role postgres in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- Prove it, inside the same transaction: if any of this is not true, nothing is removed.
do $check$
declare n bigint;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public';
  if n <> 0 then raise exception 'WIPE NOT CLEAN: % object(s) still in public. Rolled back.', n; end if;
  select count(*) into n from auth.users;
  if n <> 0 then raise exception 'WIPE NOT CLEAN: % auth user(s) left. Rolled back.', n; end if;
  execute 'select count(*) from vp_staging.vp_staging_marker' into n;
  if n <> 1 then raise exception 'WIPE NOT CLEAN: the TEST marker went missing. Rolled back.'; end if;
  raise notice 'WIPE DONE: public is empty, no auth users, TEST marker kept. Next: build-test-schema.sh.';
end
$check$;

commit;
