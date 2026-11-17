-- canary-venue-on-test.sql: Test Alpha on the TEST database, ready for the canary night (tools/canary-night.py, 421 gap 2).
-- TEST ONLY (the guard below refuses anywhere else). Run with:
--     python3 tools/staging/run-on-test.py run tools/staging/canary-venue-on-test.sql
-- What it does: switches on "unlimited nights" (weekly_limit_off, HQ's switch, migration 107) for test-alpha, so a canary
-- after every staging deploy is not stopped by the once-a-week trivia / musical bingo rule. Nothing else. Repeat-safe.
-- On LIVE the same switch is HQ's (Venues, Test Alpha, Gaming, unlimited nights) and is part of Dean's yes for the canary.
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
update public.vp_venues set weekly_limit_off = true where slug = 'test-alpha' and name like 'Test %';
do $check$
begin
  if not exists (select 1 from public.vp_venues where slug = 'test-alpha' and weekly_limit_off is true) then
    raise exception 'test-alpha still has the once-a-week rule. Rolled back.';
  end if;
  raise notice 'CANARY VENUE READY: test-alpha has unlimited nights (TEST only).';
end
$check$;
commit;
