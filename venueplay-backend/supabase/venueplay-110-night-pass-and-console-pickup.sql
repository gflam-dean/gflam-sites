-- =====================================================================
-- Migration 110: a one-night pass from HQ, and picking up a running game
--                from another device
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the Workers
--   is safe:
--     game Worker     asks for the new columns on their own and, if PostgREST
--                     refuses them (not run yet), falls back to the old reads.
--                     No pass then, and a pickup is not recorded (it still
--                     works, the way a reload on the same tablet always has).
--                     A night always starts.
--     billing Worker  only names the pass columns when HQ grants or cancels a
--                     pass, and says "Run migration 110 first" if they are not
--                     there yet. Nothing is written.
--     HQ page         reads the pass columns in their own query, so a 400 shows
--                     "not available until migration 110 is run" and nothing else.
--
-- Needs migration 107 first? No. Independent columns. (107 is on main already.)
--
-- WHY. Dean, 20 Oct 2026: "it would be shit to not be able to fix something to
-- let a venue play a night on a night".
--
--  1. ONE-NIGHT PASS. Trivia and musical bingo run once a week per venue
--     (migration 13, checkWeeklyFormatLimit). The only way past it was the
--     permanent switch (107). This lets HQ give ONE more night inside 24 hours,
--     after which it is gone on its own.
--       vp_venues.night_pass_format      'trivia' | 'musical_bingo' | 'either'
--       vp_venues.night_pass_until       when the pass lapses (granted + 24 h)
--       vp_venues.night_pass_granted_at  when HQ granted it
--       vp_venues.night_pass_granted_by  which HQ admin (their label)
--       vp_venues.night_pass_used_at     when a night used it (null = not yet)
--       vp_venues.night_pass_used_format which format used it
--       vp_venues.night_pass_used_session the session (night) that used it
--     The game Worker uses it ONLY when the weekly rule would have said no, and
--     marks it used (compare-and-set on used_at is null) after the game row
--     exists. Using it does not move last_trivia_at / last_musical_at, so the
--     venue's next ordinary night is due when it always was.
--     Every grant, cancel and use is a vp_admin_audit row
--     (venue_night_pass_granted / _cancelled / _used).
--     vp_venues_night_pass_guard: a venue's own login (owner and manager may
--     UPDATE vp_venues) can NOT set or clear any of these. The old values are put
--     back, silently, the same way 107 guards weekly_limit_off. Only the service
--     role (both Workers), a platform admin and the SQL editor may.
--
--  2. PICK UP A RUNNING GAME FROM ANOTHER DEVICE.
--       vp_games.console_id        the console that last picked this game up
--       vp_games.console_taken_at  when
--     Written by the game Worker's /host/running/take (staff at the venue only).
--     A console still open on the game asks /host/running, sees another holder,
--     and stands down, so two consoles never run one quiz. vp_games has no
--     venue write policy, so no guard is needed.
--
-- NOT security definer, no new policy, no new grant: RLS-BASELINE.json does not
-- change.
--
-- CHECK AFTERWARDS (read-only):
--   select count(*) filter (where night_pass_until is not null) as passes_ever,
--          count(*) as venues from public.vp_venues;                 -- 0 of N until HQ grants one
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'vp_games' and column_name like 'console_%';  -- 2 rows
--   select tgname from pg_trigger
--    where tgrelid = 'public.vp_venues'::regclass and tgname = 'vp_venues_night_pass_guard';
--
-- GRANT ONE BY HAND (prefer HQ > Venues > Details > "Let them run one more
-- night", which records who did it). From the SQL editor, with an audit row:
--   with v as (update public.vp_venues set night_pass_format = 'either', night_pass_until = now() + interval '24 hours', night_pass_granted_at = now(), night_pass_granted_by = 'Dean (SQL editor)', night_pass_used_at = null, night_pass_used_format = null, night_pass_used_session = null where slug = 'deepwater-hotel' returning id, name) insert into public.vp_admin_audit (actor_label, action, target, detail) select 'Dean (SQL editor)', 'venue_night_pass_granted', 'venue:' || id, jsonb_build_object('name', name, 'format', 'either', 'hours', 24) from v;
--
-- ROLLBACK:
--   drop trigger if exists vp_venues_night_pass_guard on public.vp_venues;
--   drop function if exists public.vp_venues_night_pass_guard();
--   alter table public.vp_venues drop column if exists night_pass_format, drop column if exists night_pass_until, drop column if exists night_pass_granted_at, drop column if exists night_pass_granted_by, drop column if exists night_pass_used_at, drop column if exists night_pass_used_format, drop column if exists night_pass_used_session;
--   alter table public.vp_games drop column if exists console_id, drop column if exists console_taken_at;
--   (Deploy Workers first? Not needed: both read the columns fail-safe.)
-- =====================================================================

begin;

alter table public.vp_venues
  add column if not exists night_pass_format text,
  add column if not exists night_pass_until timestamptz,
  add column if not exists night_pass_granted_at timestamptz,
  add column if not exists night_pass_granted_by text,
  add column if not exists night_pass_used_at timestamptz,
  add column if not exists night_pass_used_format text,
  add column if not exists night_pass_used_session uuid;

alter table public.vp_venues drop constraint if exists vp_venues_night_pass_format_chk;
alter table public.vp_venues add constraint vp_venues_night_pass_format_chk
  check (night_pass_format is null or night_pass_format in ('trivia', 'musical_bingo', 'either'));

alter table public.vp_venues drop constraint if exists vp_venues_night_pass_used_format_chk;
alter table public.vp_venues add constraint vp_venues_night_pass_used_format_chk
  check (night_pass_used_format is null or night_pass_used_format in ('trivia', 'musical_bingo'));

comment on column public.vp_venues.night_pass_until is
  'Migration 110. A one-night pass from HQ: this venue may start ONE more trivia or musical bingo night '
  '(night_pass_format) before this time, even inside its week. Used up by the game Worker (night_pass_used_*). '
  'Set only from HQ (billing Worker /admin/night-pass, audited); vp_venues_night_pass_guard keeps a venue login off it.';

create or replace function public.vp_venues_night_pass_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The service role (the Workers) and the SQL editor carry no anon/authenticated role;
  -- a platform admin is HQ. All three may set it.
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') or public.vp_is_platform_admin() then
    return new;
  end if;
  -- Anyone else (a venue's owner, manager or host login): every pass column keeps its old value.
  if tg_op = 'INSERT' then
    new.night_pass_format := null;
    new.night_pass_until := null;
    new.night_pass_granted_at := null;
    new.night_pass_granted_by := null;
    new.night_pass_used_at := null;
    new.night_pass_used_format := null;
    new.night_pass_used_session := null;
  else
    new.night_pass_format := old.night_pass_format;
    new.night_pass_until := old.night_pass_until;
    new.night_pass_granted_at := old.night_pass_granted_at;
    new.night_pass_granted_by := old.night_pass_granted_by;
    new.night_pass_used_at := old.night_pass_used_at;
    new.night_pass_used_format := old.night_pass_used_format;
    new.night_pass_used_session := old.night_pass_used_session;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_night_pass_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_night_pass_guard on public.vp_venues;
create trigger vp_venues_night_pass_guard
  before insert or update of night_pass_format, night_pass_until, night_pass_granted_at, night_pass_granted_by,
                             night_pass_used_at, night_pass_used_format, night_pass_used_session
  on public.vp_venues
  for each row execute function public.vp_venues_night_pass_guard();

alter table public.vp_games
  add column if not exists console_id text,
  add column if not exists console_taken_at timestamptz;

comment on column public.vp_games.console_id is
  'Migration 110. The console that last picked this running game up from another device '
  '(game Worker /host/running/take, staff only). Any other console open on the game stands down.';

commit;
