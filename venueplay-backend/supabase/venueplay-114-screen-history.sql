-- =====================================================================
-- Migration 114: a venue's screen settings can never again change or vanish without a record
-- ---------------------------------------------------------------------
-- Why (21 Oct 2026). Dean uploaded Tugun Bowls Club's logo and its ad slides. Today there is no
-- vp_venue_screen row for tugun-bowls in either database, no storage object under its id and no
-- audit entry, so nobody can say what happened. The Worker's audit rows were best effort (a
-- failed insert was swallowed), a change made in the Supabase dashboard was never recorded at
-- all, and deleting a venue row takes its screen row with it (ON DELETE CASCADE) silently.
--
-- 1. vp_venue_screen_history: one row for EVERY insert, update and delete of vp_venue_screen,
--    written by a trigger inside the same transaction as the change. A change that cannot be
--    recorded does not happen. It holds the whole row before and after (addresses of images,
--    never image data), when, and who:
--      actor    what the billing Worker said in its X-VP-Actor header (the login, whether it was
--               a venue login or HQ View as or an HQ restore, the route)
--      via      actor.via, or 'direct' when nothing came through the Worker (the dashboard, the
--               SQL editor, a script, a cascade from deleting the venue)
--      db_session_user / db_role / jwt_role   what Postgres itself knows about the caller
--    APPEND-ONLY: no grant lets anybody insert, update or delete it (the trigger writes as the
--    table owner), and a guard trigger refuses UPDATE, DELETE and TRUNCATE for everyone, the
--    service key included. Venue logins (anon, authenticated) can neither read nor write it.
--    No foreign key to vp_venues, on purpose: deleting a venue must not delete its history.
-- 2. A baseline row per existing screen row, so every venue's current state is a restorable
--    version from the moment this runs.
-- 3. vp_screen_history_check(): the nightly check the billing Worker calls. Any screen row that
--    differs from its last recorded version (the trigger was disabled, or bypassed) is written
--    as 'drift'; any venue whose last recorded version has no row now and no recorded delete is
--    written as 'vanished'. Returns the counts, which the Worker audits when not zero.
-- Every version is kept (no pruning). A venue changes its screen a few times a month and a row
-- is a few hundred bytes.
--
-- SELF-TEST. The end of this file proves it on the live database before it commits: it deletes
-- a real screen row and changes another directly, checks each was recorded with via 'direct',
-- checks the history refuses a delete, then rolls all of that back. If any part fails, the whole
-- migration is rolled back and Postgres says which part.
--
-- Order: run this BEFORE the billing Worker of branch feature/screen-history (the Worker's HQ
-- Screen history view reads this table and says "run migration 114" until it exists; screen
-- saves work either way). After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
-- commit RLS-BASELINE.json if it differs from the entries this branch already wrote by hand.
-- Safe to run twice. Rollback at the bottom.
-- =====================================================================

begin;

create table if not exists public.vp_venue_screen_history (
  id              bigint generated always as identity primary key,
  venue_id        uuid not null,
  slug            text,
  op              text not null check (op in ('insert', 'update', 'delete', 'baseline', 'drift', 'vanished')),
  old_row         jsonb,
  new_row         jsonb,
  changed_at      timestamptz not null default now(),
  actor           jsonb,
  via             text not null default 'direct',
  db_session_user text,
  db_role         text,
  jwt_role        text
);
create index if not exists vp_venue_screen_history_venue on public.vp_venue_screen_history (venue_id, id desc);

alter table public.vp_venue_screen_history enable row level security;
revoke all on public.vp_venue_screen_history from public, anon, authenticated, service_role;
grant select on public.vp_venue_screen_history to service_role;

-- APPEND-ONLY, for everyone. Only the table owner could drop this trigger, and doing that is
-- itself a schema change a person has to mean.
create or replace function public.vp_venue_screen_history_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  raise exception 'vp_venue_screen_history is append-only: % refused', tg_op
    using errcode = 'insufficient_privilege';
end;
$fn$;
revoke all on function public.vp_venue_screen_history_append_only() from public, anon, authenticated;

drop trigger if exists vp_venue_screen_history_no_change on public.vp_venue_screen_history;
create trigger vp_venue_screen_history_no_change
  before update or delete on public.vp_venue_screen_history
  for each row execute function public.vp_venue_screen_history_append_only();
drop trigger if exists vp_venue_screen_history_no_truncate on public.vp_venue_screen_history;
create trigger vp_venue_screen_history_no_truncate
  before truncate on public.vp_venue_screen_history
  for each statement execute function public.vp_venue_screen_history_append_only();

-- THE RECORDER. Security definer so it can write a table nobody else may write. AFTER, so it
-- records what was actually stored. An update that moved nothing but updated_at is not a change
-- and is not recorded.
create or replace function public.vp_venue_screen_capture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  hdrs   text;
  raw    text;
  act    jsonb;
  claims text;
  jrole  text;
  o      jsonb;
  n      jsonb;
begin
  -- Who, as the Worker told us. Never allowed to stop the write: an unreadable header is
  -- recorded as unreadable.
  begin
    hdrs := nullif(current_setting('request.headers', true), '');
    raw := case when hdrs is null then null else (hdrs::jsonb ->> 'x-vp-actor') end;
    act := case when raw is null then null else left(raw, 2000)::jsonb end;
    if act is not null and jsonb_typeof(act) <> 'object' then
      act := jsonb_build_object('unreadable', left(raw, 300));
    end if;
  exception when others then
    act := jsonb_build_object('unreadable', left(coalesce(raw, ''), 300));
  end;
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '');
    jrole := case when claims is null then null else (claims::jsonb ->> 'role') end;
  exception when others then
    jrole := null;
  end;

  if tg_op = 'DELETE' then
    o := to_jsonb(old);
    n := null;
  elsif tg_op = 'INSERT' then
    o := null;
    n := to_jsonb(new);
  else
    o := to_jsonb(old);
    n := to_jsonb(new);
    if (o - 'updated_at') = (n - 'updated_at') then
      return null;
    end if;
  end if;

  insert into public.vp_venue_screen_history
    (venue_id, slug, op, old_row, new_row, actor, via, db_session_user, db_role, jwt_role)
  values
    ((coalesce(n, o) ->> 'venue_id')::uuid, coalesce(n, o) ->> 'slug', lower(tg_op), o, n, act,
     coalesce(nullif(left(act ->> 'via', 40), ''), 'direct'),
     session_user, nullif(current_setting('role', true), 'none'), jrole);
  return null;
end;
$fn$;
revoke all on function public.vp_venue_screen_capture() from public, anon, authenticated;

drop trigger if exists vp_venue_screen_capture on public.vp_venue_screen;
create trigger vp_venue_screen_capture
  after insert or update or delete on public.vp_venue_screen
  for each row execute function public.vp_venue_screen_capture();

-- THE BASELINE: every screen as it stands now, once per venue.
insert into public.vp_venue_screen_history (venue_id, slug, op, old_row, new_row, actor, via, db_session_user, db_role)
select s.venue_id, s.slug, 'baseline', null, to_jsonb(s), jsonb_build_object('label', 'migration 114'), 'migration',
       session_user, nullif(current_setting('role', true), 'none')
  from public.vp_venue_screen s
 where not exists (select 1 from public.vp_venue_screen_history h where h.venue_id = s.venue_id and h.op = 'baseline');

-- THE NIGHTLY CHECK. Anything the trigger did not see becomes visible here within a day.
create or replace function public.vp_screen_history_check()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  checked int;
  drifted int;
  gone    int;
begin
  select count(*) into checked from public.vp_venue_screen;

  with latest as (
    select distinct on (h.venue_id) h.venue_id, h.new_row
      from public.vp_venue_screen_history h
     order by h.venue_id, h.id desc
  ), moved as (
    insert into public.vp_venue_screen_history (venue_id, slug, op, old_row, new_row, actor, via, db_session_user, db_role)
    select s.venue_id, s.slug, 'drift', l.new_row, to_jsonb(s),
           jsonb_build_object('label', 'nightly check'), 'nightly-check', session_user, nullif(current_setting('role', true), 'none')
      from public.vp_venue_screen s
      left join latest l on l.venue_id = s.venue_id
     where l.new_row is null or (l.new_row - 'updated_at') <> (to_jsonb(s) - 'updated_at')
    returning 1
  )
  select count(*) into drifted from moved;

  with latest as (
    select distinct on (h.venue_id) h.venue_id, h.slug, h.new_row
      from public.vp_venue_screen_history h
     order by h.venue_id, h.id desc
  ), lost as (
    insert into public.vp_venue_screen_history (venue_id, slug, op, old_row, new_row, actor, via, db_session_user, db_role)
    select l.venue_id, l.slug, 'vanished', l.new_row, null,
           jsonb_build_object('label', 'nightly check'), 'nightly-check', session_user, nullif(current_setting('role', true), 'none')
      from latest l
     where l.new_row is not null
       and not exists (select 1 from public.vp_venue_screen s where s.venue_id = l.venue_id)
    returning 1
  )
  select count(*) into gone from lost;

  return jsonb_build_object('checked', checked, 'drift', drifted, 'vanished', gone);
end;
$fn$;
revoke all on function public.vp_screen_history_check() from public, anon, authenticated;
grant execute on function public.vp_screen_history_check() to service_role;

-- SELF-TEST on the real database. Everything inside the inner block is rolled back by the
-- deliberate exception at its end; only a failure escapes, and that aborts the migration.
do $selftest$
declare
  v        uuid;
  w        uuid;
  mark     bigint;
  n        int;
  refused  boolean := false;
begin
  if has_table_privilege('anon', 'public.vp_venue_screen_history', 'select')
     or has_table_privilege('authenticated', 'public.vp_venue_screen_history', 'select')
     or has_table_privilege('anon', 'public.vp_venue_screen_history', 'insert')
     or has_table_privilege('authenticated', 'public.vp_venue_screen_history', 'insert')
     or has_table_privilege('service_role', 'public.vp_venue_screen_history', 'insert')
     or has_table_privilege('service_role', 'public.vp_venue_screen_history', 'delete') then
    raise exception 'Migration 114 self-test: a venue login or the service key can still write or read the history';
  end if;

  select venue_id into v from public.vp_venue_screen order by updated_at desc limit 1;
  if v is null then
    raise notice 'Migration 114 self-test: no screen rows yet, the capture test is skipped';
    return;
  end if;
  select venue_id into w from public.vp_venue_screen where venue_id <> v order by updated_at desc limit 1;

  begin
    select coalesce(max(id), 0) into mark from public.vp_venue_screen_history;

    delete from public.vp_venue_screen where venue_id = v;
    select count(*) into n from public.vp_venue_screen_history
     where id > mark and venue_id = v and op = 'delete' and via = 'direct' and old_row is not null and new_row is null;
    if n <> 1 then raise exception 'selftest: a direct delete was not recorded'; end if;

    if w is not null then
      update public.vp_venue_screen set raffle = jsonb_build_object('label', 'self-test', 'day', '', 'time', '') where venue_id = w;
      select count(*) into n from public.vp_venue_screen_history
       where id > mark and venue_id = w and op = 'update' and (new_row -> 'raffle' ->> 'label') = 'self-test';
      if n <> 1 then raise exception 'selftest: a direct update was not recorded'; end if;
      update public.vp_venue_screen set updated_at = now() + interval '1 second' where venue_id = w;
      select count(*) into n from public.vp_venue_screen_history where id > mark and venue_id = w;
      if n <> 1 then raise exception 'selftest: a clock-only update was recorded as a change'; end if;
    end if;

    begin
      delete from public.vp_venue_screen_history where id > mark;
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then raise exception 'selftest: the history let a row be deleted'; end if;

    if ((public.vp_screen_history_check()) ->> 'vanished')::int < 0 then
      raise exception 'selftest: the nightly check did not answer';
    end if;

    raise exception 'selftest-passed';
  exception when others then
    if sqlerrm <> 'selftest-passed' then
      raise exception 'Migration 114 self-test failed, nothing was changed: %', sqlerrm;
    end if;
  end;
  raise notice 'Migration 114 self-test passed: a direct delete and a direct update were both recorded, the history refused a delete';
end;
$selftest$;

commit;

-- Read back (read-only):
--   select op, via, count(*) from public.vp_venue_screen_history group by 1, 2 order by 1, 2;
--     -- one 'baseline' per screen row, nothing else yet
--   select (select count(*) from public.vp_venue_screen) as screens,
--          (select count(distinct venue_id) from public.vp_venue_screen_history where op = 'baseline') as baselined;
--     -- the two numbers match
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.vp_venue_screen'::regclass and not tgisinternal;
--     -- vp_venue_screen_capture | O
--   set local role authenticated; select count(*) from public.vp_venue_screen_history;   -- permission denied

-- ROLLBACK (this throws away the history, which is the record this exists to keep; only if it is
-- genuinely broken):
--   drop trigger if exists vp_venue_screen_capture on public.vp_venue_screen;
--   drop function if exists public.vp_venue_screen_capture();
--   drop function if exists public.vp_screen_history_check();
--   drop table if exists public.vp_venue_screen_history;
--   drop function if exists public.vp_venue_screen_history_append_only();
