-- =====================================================================
-- Migration 116: number bingo hidden for SA and NT pubs, and the HQ switch
-- that turns it back on for one venue
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the Workers
--   is safe:
--     game Worker     asks for the column on its own and, if PostgREST refuses
--                     it (not run yet), reads the venue without it: an SA or NT
--                     pub then simply has number bingo off, which is the rule.
--     billing Worker  only names the column when HQ flips the switch, and says
--                     "Run migration 116 first" if it is not there yet.
--     console + HQ    read it off the venue row (select *) or their own query,
--                     so a missing column reads as "off".
--
-- WHY. Dean, 22 Oct 2026, on the SA/NT research (venue-enrich/state-rules/
-- SA-NT-WA-FINDINGS-2026-10-22.md):
--   SA  Lotteries Regulations 2021: bingo is for not-for-profit organisations
--       only (reg 3 and 5), on sheets from a licensed supplier.
--   NT  Gaming Control Act 1993 s 47(b), s 52 and Community Gaming Regs reg 4:
--       bingo only by approved associations.
-- So a pub or hotel in either place cannot run number bingo. Dean: HIDE it
-- entirely for SA and NT pubs (no tile, no route; staff would think a greyed
-- tile was broken), and let HQ switch it back on for a venue that proves its
-- bingo is run by a not-for-profit.
--
-- MUSICAL BINGO IS NOT BINGO and is untouched by this, in every state. So are
-- trivia, raffles and members draws. This is 90-ball number bingo only.
--
-- WHAT CHANGES.
--   vp_venues.number_bingo_on     boolean, not null, default false. Read ONLY
--                                 for an SA or NT venue that is not recorded
--                                 as a club (entity_type <> 'non_profit'):
--                                 true shows number bingo to that venue.
--                                 Everywhere else it changes nothing.
--   vp_venues_number_bingo_guard  a BEFORE INSERT OR UPDATE trigger, the same
--                                 shape as migration 107: a venue's own login
--                                 cannot switch it on; the old value is put
--                                 back, silently. Only these may set it:
--                                   - the service role (billing Worker
--                                     /admin/venue-gaming, owner or accounts HQ
--                                     admins only, which writes the audit row
--                                     venue_number_bingo_on / _off)
--                                   - a platform admin (vp_is_platform_admin())
--                                   - the SQL editor (no request role at all)
--
-- NOT security definer, on purpose (same as 107): it only reads the caller's
-- own role and calls vp_is_platform_admin(). RLS-BASELINE.json does not change.
-- No new policy, no new grant.
--
-- CHECK AFTERWARDS (read-only):
--   select count(*) filter (where number_bingo_on) as switched_on,
--          count(*) as venues from public.vp_venues;           -- 0 of N until HQ flips one
--   select tgname from pg_trigger
--    where tgrelid = 'public.vp_venues'::regclass and tgname = 'vp_venues_number_bingo_guard';
--
-- ROLLBACK:
--   drop trigger if exists vp_venues_number_bingo_guard on public.vp_venues;
--   drop function if exists public.vp_venues_number_bingo_guard();
--   alter table public.vp_venues drop column if exists number_bingo_on;
--   (Both Workers read the column fail-safe, so no deploy is needed to roll back.)
-- =====================================================================

begin;

alter table public.vp_venues
  add column if not exists number_bingo_on boolean not null default false;

comment on column public.vp_venues.number_bingo_on is
  'Migration 116. Only read for an SA or NT venue that is not recorded as a club (entity_type <> non_profit): '
  'true = HQ has seen that its number bingo is run by a not-for-profit, so the 90-ball bingo tile and routes are shown. '
  'Set only from HQ (billing Worker /admin/venue-gaming, audited as venue_number_bingo_on/off); '
  'vp_venues_number_bingo_guard keeps a venue login off it. Musical bingo is not bingo and never reads this.';

create or replace function public.vp_venues_number_bingo_guard()
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
    new.number_bingo_on := false;
  else
    new.number_bingo_on := old.number_bingo_on;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_number_bingo_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_number_bingo_guard on public.vp_venues;
create trigger vp_venues_number_bingo_guard
  before insert or update of number_bingo_on on public.vp_venues
  for each row execute function public.vp_venues_number_bingo_guard();

commit;
