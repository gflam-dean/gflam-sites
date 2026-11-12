-- guard.sql: THE TEST-ONLY LOCK. build-test-schema.sh puts this first in every file it writes;
-- wipe-test-db.sql and seed-test-data.sql carry the same block. Kept here once so the copies can
-- be checked against it (check-schema-matches-live.test.py does that).
--
-- It refuses, and so stops everything after it, unless:
--   (1) vp_staging.vp_staging_marker exists and names gpoolavkghnxedzrmtmc (01-mark-this-as-test.sql), and
--   (2) no real person (anyone not @example.invalid / 61400000xxx) has signed in since 1 Oct 2026.
-- On LIVE (ijkzgmdtwtgfkedqspxm) both fail: there is no marker and real people sign in every day.
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
