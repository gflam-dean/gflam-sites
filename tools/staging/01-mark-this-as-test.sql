-- 01-mark-this-as-test.sql
-- =====================================================================================
-- RUN ONLY ON THE OLD PROJECT gpoolavkghnxedzrmtmc, NEVER LIVE.
-- THE LIVE PROJECT IS ijkzgmdtwtgfkedqspxm. IF THAT IS IN YOUR BROWSER'S ADDRESS BAR, STOP.
-- =====================================================================================
--
-- WHAT IT DOES. Creates ONE small table, vp_staging.vp_staging_marker, holding the old
-- project's ref. Every other script in tools/staging/ that changes anything (wipe, schema,
-- seed) refuses to run unless this marker is there. It lives in its own schema
-- (vp_staging), so wiping and rebuilding "public" never removes it, and the schema check
-- never sees it.
--
-- THE HUMAN STEP. Before running it, the person running it:
--   1. opens the Supabase dashboard, picks the project called "Gflam" (Singapore),
--   2. checks the browser address bar contains gpoolavkghnxedzrmtmc,
--   3. opens SQL Editor, New query, pastes this file,
--   4. replaces CHANGE-ME below with their own name (e.g. 'main 12 Nov'),
--   5. presses Run.
-- If CHANGE-ME is still there, it refuses.
--
-- THE SECOND LOCK (does not depend on anyone reading the address bar). It refuses if this
-- database looks alive: if any real person (anyone not on the fake test addresses
-- @example.invalid or phones 61400000xxx) has signed in since 1 Oct 2026, or if any venue
-- or session row was created since 1 Oct 2026. The old project has been idle since about
-- 10 Sep; live has real sign-ins every day, so on live this refuses.
--
-- Safe to run twice (the second run changes nothing).
-- =====================================================================================

begin;

do $mark$
declare
  who text := 'CHANGE-ME';          -- <<< put your name here before pressing Run
  n bigint;
begin
  if who = 'CHANGE-ME' or btrim(who) = '' then
    raise exception 'REFUSED: put your name in place of CHANGE-ME first (after checking the address bar says gpoolavkghnxedzrmtmc). Nothing was changed.';
  end if;

  select count(*) into n from auth.users
   where greatest(coalesce(last_sign_in_at, 'epoch'::timestamptz), coalesce(created_at, 'epoch'::timestamptz)) >= '2026-10-01'
     and not (coalesce(email, '') like '%@example.invalid' or coalesce(phone, '') like '61400000%');
  if n > 0 then
    raise exception 'REFUSED: % real sign-in(s) since 1 Oct 2026. This looks like the LIVE project. Nothing was changed.', n;
  end if;

  if to_regclass('public.vp_venues') is not null then
    execute $q$select count(*) from public.vp_venues where created_at >= '2026-10-01' and slug not like 'test-%'$q$ into n;
    if n > 0 then
      raise exception 'REFUSED: % venue(s) created since 1 Oct 2026. This looks like the LIVE project. Nothing was changed.', n;
    end if;
  end if;

  if to_regclass('public.vp_sessions') is not null then
    execute $q$select count(*) from public.vp_sessions where created_at >= '2026-10-01'$q$ into n;
    if n > 0 and to_regclass('vp_staging.vp_staging_marker') is null then
      raise exception 'REFUSED: % game session(s) since 1 Oct 2026 and no marker yet. This looks like the LIVE project. Nothing was changed.', n;
    end if;
  end if;

  create schema if not exists vp_staging;
  create table if not exists vp_staging.vp_staging_marker (
    project_ref  text primary key check (project_ref = 'gpoolavkghnxedzrmtmc'),
    confirmed_by text not null,
    confirmed_at timestamptz not null default now(),
    note         text not null default 'venueplay TEST database. Fake data only. Never live.'
  );
  insert into vp_staging.vp_staging_marker (project_ref, confirmed_by)
  values ('gpoolavkghnxedzrmtmc', who)
  on conflict (project_ref) do nothing;

  -- Not reachable from the website or the Workers' public keys.
  revoke all on schema vp_staging from public;
  execute 'revoke all on schema vp_staging from anon, authenticated';
  revoke all on all tables in schema vp_staging from public;
  execute 'revoke all on all tables in schema vp_staging from anon, authenticated';

  raise notice 'MARKED: this project is now the venueplay TEST database (gpoolavkghnxedzrmtmc), confirmed by %', who;
end
$mark$;

commit;
