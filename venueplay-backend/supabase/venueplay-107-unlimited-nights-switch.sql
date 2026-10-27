-- =====================================================================
-- Migration 107: a per-venue switch that lifts the once-a-week rule
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the Workers
--   is safe:
--     game Worker     asks for the column on its own and, if PostgREST refuses
--                     it (not run yet), falls back to the old read and the old
--                     rule. A night always starts.
--     billing Worker  only names the column when HQ flips the switch, and says
--                     "Run migration 107 first" if it is not there yet.
--     HQ page         reads the column in its own query, so a 400 leaves every
--                     switch showing "off" and the venue list untouched.
--
-- WHY. Trivia and musical bingo run once a week per venue (migration 13,
-- vp_venues.last_trivia_at / last_musical_at, enforced by the game Worker's
-- checkWeeklyFormatLimit). Dean, 19 Oct 2026: Deepwater Hotel (NSW) wants
-- more than one night a week, and there was no way to allow it short of
-- editing timestamps by hand. This is that way, one venue at a time.
--
-- WHAT CHANGES.
--   vp_venues.weekly_limit_off   boolean, not null, default false. When true
--                                the game Worker skips the once-a-week check
--                                for this venue (trivia AND musical bingo).
--   vp_venues_weekly_limit_guard a BEFORE INSERT OR UPDATE trigger. A venue's
--                                own login (owner and manager may UPDATE
--                                vp_venues under vp_venues_manager_update) can
--                                NOT switch it on: the old value is put back,
--                                silently, the same way migration 77/80 guard
--                                the owner-only settings. Only these may set it:
--                                  - the service role (the billing Worker's
--                                    /admin/venue-gaming, owner or accounts HQ
--                                    admins only, which writes the audit row
--                                    venue_unlimited_nights_on / _off)
--                                  - a platform admin (vp_is_platform_admin())
--                                  - the SQL editor (no request role at all)
--
-- NOT security definer, on purpose: it only reads the caller's own role and
-- calls vp_is_platform_admin(), which the RLS policies already call. So
-- RLS-BASELINE.json (which lists definer functions, grants and policies)
-- does not change. No new policy, no new grant.
--
-- CHECK AFTERWARDS (read-only):
--   select count(*) filter (where weekly_limit_off) as unlimited,
--          count(*) as venues from public.vp_venues;            -- 0 of N until HQ flips one
--   select tgname from pg_trigger
--    where tgrelid = 'public.vp_venues'::regclass and tgname = 'vp_venues_weekly_limit_guard';
--
-- TURN IT ON FOR ONE VENUE. Prefer HQ > Venues > Details > "Unlimited trivia
-- and musical bingo nights", which records who did it. From the SQL editor,
-- with an audit row (one statement):
--   with v as (update public.vp_venues set weekly_limit_off = true where slug = 'deepwater-hotel' returning id, name) insert into public.vp_admin_audit (actor_label, action, target, detail) select 'Dean (SQL editor)', 'venue_unlimited_nights_on', 'venue:' || id, jsonb_build_object('name', name, 'from', false, 'to', true) from v;
--
-- ROLLBACK:
--   drop trigger if exists vp_venues_weekly_limit_guard on public.vp_venues;
--   drop function if exists public.vp_venues_weekly_limit_guard();
--   alter table public.vp_venues drop column if exists weekly_limit_off;
--   (Deploy Workers first? Not needed: both read the column fail-safe.)
-- =====================================================================

begin;

alter table public.vp_venues
  add column if not exists weekly_limit_off boolean not null default false;

comment on column public.vp_venues.weekly_limit_off is
  'Migration 107. true = this venue may run trivia and musical bingo more than once a week '
  '(game Worker skips checkWeeklyFormatLimit). Set only from HQ (billing Worker /admin/venue-gaming, '
  'audited as venue_unlimited_nights_on/off); vp_venues_weekly_limit_guard keeps a venue login off it.';

create or replace function public.vp_venues_weekly_limit_guard()
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
  -- Anyone else (a venue's owner, manager or host login): the switch keeps its old value.
  if tg_op = 'INSERT' then
    new.weekly_limit_off := false;
  else
    new.weekly_limit_off := old.weekly_limit_off;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_weekly_limit_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_weekly_limit_guard on public.vp_venues;
create trigger vp_venues_weekly_limit_guard
  before insert or update of weekly_limit_off on public.vp_venues
  for each row execute function public.vp_venues_weekly_limit_guard();

commit;
