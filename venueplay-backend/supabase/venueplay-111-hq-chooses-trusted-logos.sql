-- =====================================================================
-- Migration 111: HQ, not the venue, chooses whose logo is on our website
-- ---------------------------------------------------------------------
--   RUN on the live database 20 Oct 2026 23:45 (verified 26 Oct 2026, read
--   only: 'Migration 111' audit rows at that time, and only deepwater-hotel and
--   the-mini-bar have show_logo_on_site true). Safe to run again: the data step
--   runs only while the guard trigger does not exist yet (the first run), so a
--   re-run never undoes a venue HQ has switched on or off since.
--
--   RUN THIS BEFORE DEPLOYING THE BILLING WORKER. Today every venue has
--   show_logo_on_site = true (102's default). The new Worker drops the old
--   "paying" and "not a 1-player plan" rules, so on the old data it would put
--   nine venues on the homepage, friends' test venues included. Run in this
--   order and nobody appears who HQ did not choose:
--     1. this migration        only Deepwater Hotel and The Mini Bar stay on
--     2. the billing Worker    HQ's switch, the venue route answers 410
--   The old Worker on the new data is fine: it keeps its extra rules, so it
--   shows fewer venues, never more.
--
-- WHY. Dean, 20 Oct 2026: "I dont want a venue to be able to put it on our
-- website we should choose". Until now a venue ticked "Show our logo on the
-- VenuePlay website" itself (migration 102, default on), and HQ could only
-- hide one (hide_from_trusted, migration 54). Now there is one switch, HQ's:
-- HQ > Venues > Details > "Show logo on our website" (billing Worker
-- /admin/venue-gaming, owner and accounts admins only, audited as
-- venue_logo_on_site_on / _off).
--
-- WHAT CHANGES.
--   vp_venues.show_logo_on_site   default becomes false: a new venue is not on
--                                 the website until HQ chooses it.
--   the data                      true for Deepwater Hotel (deepwater-hotel)
--                                 and The Mini Bar (the-mini-bar), false for
--                                 every other venue: a venue's own tick no
--                                 longer counts. Tugun Bowls Club is left off
--                                 until it has a logo; HQ switches it on then.
--   vp_venues_logo_on_site_guard  a BEFORE INSERT OR UPDATE trigger, the same
--                                 shape as migration 107's. A venue's own login
--                                 (owner and manager may UPDATE vp_venues under
--                                 vp_venues_manager_update) cannot set it: the
--                                 old value is put back silently, and a row a
--                                 venue login inserts starts false. Only the
--                                 service role (the Workers), a platform admin
--                                 and the SQL editor may set it.
--   hide_from_trusted             left in place and no longer read by the
--                                 Worker (one switch, not two). Not dropped, so
--                                 the old view v_vp_trusted, which nothing reads
--                                 any more, still compiles.
--
-- NOT security definer, on purpose (as 107): it reads only the caller's role
-- and calls vp_is_platform_admin(), so RLS-BASELINE.json does not change.
--
-- CHECK AFTERWARDS (read-only):
--   select slug from public.vp_venues where show_logo_on_site order by slug;
--     -- deepwater-hotel, the-mini-bar
--   select column_default from information_schema.columns
--    where table_name = 'vp_venues' and column_name = 'show_logo_on_site';   -- false
--   select tgname from pg_trigger
--    where tgrelid = 'public.vp_venues'::regclass and tgname = 'vp_venues_logo_on_site_guard';
--
-- ROLLBACK:
--   drop trigger if exists vp_venues_logo_on_site_guard on public.vp_venues;
--   drop function if exists public.vp_venues_logo_on_site_guard();
--   alter table public.vp_venues alter column show_logo_on_site set default true;
--   (the old per-venue ticks are not restored; they are in vp_admin_audit
--    as logo_on_site rows if anyone needs them)
-- =====================================================================

begin;

alter table public.vp_venues
  alter column show_logo_on_site set default false;

comment on column public.vp_venues.show_logo_on_site is
  'Migration 111. true = HQ has chosen this venue''s logo for the Trusted by strip on venueplay.com.au. '
  'Set only from HQ (billing Worker /admin/venue-gaming, audited as venue_logo_on_site_on/off); '
  'vp_venues_logo_on_site_guard keeps a venue login off it. Default false.';

-- The data: two venues on, everyone else off, FIRST RUN ONLY. The guard trigger
-- below is created in the same transaction, so "no trigger yet" means this file
-- has never been run; once it has, HQ's choices are left exactly as they are.
-- One statement, so it can never leave a venue half-way. Audit rows say who
-- did it and why.
do $do$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.vp_venues'::regclass
                    and tgname = 'vp_venues_logo_on_site_guard') then
    with changed as (
      update public.vp_venues
         set show_logo_on_site = (slug in ('deepwater-hotel', 'the-mini-bar'))
       where show_logo_on_site is distinct from (slug in ('deepwater-hotel', 'the-mini-bar'))
      returning id, name, show_logo_on_site
    )
    insert into public.vp_admin_audit (actor_label, action, target, detail)
    select 'Migration 111',
           case when show_logo_on_site then 'venue_logo_on_site_on' else 'venue_logo_on_site_off' end,
           'venue:' || id,
           jsonb_build_object('name', name, 'from', not show_logo_on_site, 'to', show_logo_on_site,
                              'why', 'HQ chooses the website logos (Dean, 20 Oct 2026)')
      from changed;
  end if;
end
$do$;

create or replace function public.vp_venues_logo_on_site_guard()
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
    new.show_logo_on_site := false;
  else
    new.show_logo_on_site := old.show_logo_on_site;
  end if;
  return new;
end;
$$;

revoke all on function public.vp_venues_logo_on_site_guard() from public, anon, authenticated;

drop trigger if exists vp_venues_logo_on_site_guard on public.vp_venues;
create trigger vp_venues_logo_on_site_guard
  before insert or update of show_logo_on_site on public.vp_venues
  for each row execute function public.vp_venues_logo_on_site_guard();

commit;
