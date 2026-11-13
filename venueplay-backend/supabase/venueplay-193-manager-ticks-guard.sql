-- venueplay-193-manager-ticks-guard.sql
-- NOT RUN. NOT TO BE RUN BLIND. Security review 13 Nov 2026, part B, finding B9 (INBOX 370).
--
-- BEFORE RUNNING: main reads the LIVE database, read-only, and confirms all four below. If any one differs,
-- stop and re-read this file against what is live; do not run it.
--
--   1. the two policies are still the ones recorded in RLS-BASELINE.json (owner or manager, no ticks):
--        select policyname, cmd, qual, with_check from pg_policies
--         where schemaname = 'public' and tablename = 'vp_venue_settings' order by policyname;
--      expect vp_venue_settings_manager_insert (INSERT) and vp_venue_settings_manager_update (UPDATE),
--      both "s.role = ANY (ARRAY['owner','manager'])" on vp_venue_staff, plus the admin policy.
--   2. migration 77's trigger is live (this one sits beside it, it does not replace it):
--        select tgname from pg_trigger where tgrelid = 'public.vp_venue_settings'::regclass and not tgisinternal;
--      expect vp_venue_settings_owner_only (77) and vp_venue_settings_gate (21/28/43/82). No
--      vp_venue_settings_manager_ticks yet.
--   3. the five columns guarded below exist:
--        select column_name from information_schema.columns where table_schema = 'public'
--         and table_name = 'vp_venue_settings' and column_name in ('default_draw_length_seconds',
--         'raffle_time_limit_seconds', 'raffle_template', 'screen_rotation_seconds', 'auto_game_promos');
--      expect 5 rows.
--   4. vp_venue_staff.permissions is jsonb and a restricted manager reads {"draws_raffles": false, ...}:
--        select permissions from vp_venue_staff where role = 'manager' and permissions is not null limit 5;
--
-- WHAT IT FIXES. vp_venue_settings_manager_update lets any owner OR manager row update the venue's whole
-- settings row straight from the browser (VP.saveSettings upserts it with the person's own token, which is how
-- Game settings saves). Migration 77 already keeps the owner-only privacy columns for a non-owner. The two
-- manager ticks an owner can take away, "Edit draws and raffles" and "Edit advertising", are only checked in
-- the Worker, so a manager with those ticks OFF could take their session token and PATCH
-- /rest/v1/vp_venue_settings to change the draw and raffle timings, the raffle template, and the screen
-- rotation / automatic game promos. Not money or player data; a restriction the owner set that did not hold.
--
-- WHY A TRIGGER AND NOT A TIGHTER POLICY. The same reason migration 77 gives: a policy cannot compare the old
-- row with the new one, so "may change these columns and not those" cannot be a policy, and Game settings
-- (game_prefs, trivia_*, setup_answers) must keep saving for every manager and host who runs a night. Dropping
-- the manager policy (as H1 did for vp_venues) would break that save, because Game settings does not go
-- through the Worker. So: a BEFORE UPDATE trigger, like 77, that KEEPS rather than refuses. A restricted
-- manager's save still saves; the columns their owner took away keep the values they had.
--
-- WHO IS RESTRICTED. A vp_venue_staff row for this venue and this login with role 'manager' and the tick set
-- to false in permissions (the Worker's rule, vpbCan: null permissions = full access, a missing key = allowed,
-- only an explicit false takes it away). An owner row, a platform admin and the Worker (service role, no
-- auth.uid()) are never restricted. If the login has several rows at the venue, an owner row wins and any row
-- without the restriction wins (the most generous row, as the Worker reads it).
--
-- WHAT IS NOT GUARDED, on purpose: game_prefs (one JSON blob holding every game's night settings, written by
-- the console's game setup for everyone who runs a night; the raffle part of it is how a host runs a raffle,
-- not the account's draws and raffles settings), trivia_*, setup_answers. No page writes the five guarded
-- columns any more (raffle settings moved into game_prefs), so no honest save changes.
--
-- AFTER RUNNING: python3 venueplay-backend/tools/dump-rls-baseline.py and commit RLS-BASELINE.json (one new
-- SECURITY DEFINER function, vp_settings_manager_ticks_guard). No column change, so COLUMNS-BASELINE.json is
-- unchanged. Prove it: as a manager with "Edit draws and raffles" off, PATCH raffle_time_limit_seconds through
-- the REST API with that manager's token: it answers 200 and the value does not move; as the owner it moves.
--
-- Safe to run twice. Rollback at the bottom.

create or replace function public.vp_settings_manager_ticks_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_or_free boolean;
  no_draws boolean;
  no_ads boolean;
begin
  -- The Worker (service role) and a platform admin are not restricted.
  if auth.uid() is null or public.vp_is_platform_admin() then
    return new;
  end if;

  -- An owner row, or a manager row with full access (null permissions), wins outright.
  select exists (
    select 1 from public.vp_venue_staff s
     where s.venue_id = new.venue_id and s.auth_user_id = auth.uid()
       and (s.role = 'owner' or (s.role = 'manager' and s.permissions is null))
  ) into owner_or_free;
  if owner_or_free then
    return new;
  end if;

  -- Restricted only if EVERY manager row this login has here says false (the most generous row wins).
  select coalesce(bool_and(coalesce((s.permissions ->> 'draws_raffles') = 'false', false)), false),
         coalesce(bool_and(coalesce((s.permissions ->> 'advertising') = 'false', false)), false)
    into no_draws, no_ads
    from public.vp_venue_staff s
   where s.venue_id = new.venue_id and s.auth_user_id = auth.uid() and s.role = 'manager';

  if no_draws then
    new.default_draw_length_seconds := old.default_draw_length_seconds;
    new.raffle_time_limit_seconds   := old.raffle_time_limit_seconds;
    new.raffle_template             := old.raffle_template;
  end if;
  if no_ads then
    new.screen_rotation_seconds := old.screen_rotation_seconds;
    new.auto_game_promos        := old.auto_game_promos;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_settings_manager_ticks_guard() from public, anon, authenticated;

drop trigger if exists vp_venue_settings_manager_ticks on public.vp_venue_settings;
create trigger vp_venue_settings_manager_ticks
  before update on public.vp_venue_settings
  for each row execute function public.vp_settings_manager_ticks_guard();

-- READ BACK (read-only), after running:
--   select tgname from pg_trigger where tgrelid = 'public.vp_venue_settings'::regclass and not tgisinternal;
--   expect vp_venue_settings_manager_ticks beside vp_venue_settings_owner_only and vp_venue_settings_gate.
--
-- ROLLBACK (nothing else depends on it):
--   drop trigger if exists vp_venue_settings_manager_ticks on public.vp_venue_settings;
--   drop function if exists public.vp_settings_manager_ticks_guard();
