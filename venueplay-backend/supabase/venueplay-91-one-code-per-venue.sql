-- 91: ONE CODE PER VENUE. Dean, 25 Sep 2026: "You can make all the venues the same code."
--
-- A venue has had two six-character codes since migration 68: join_code (what the wall shows,
-- changed by the Change code button) and the hash of its slug (the channel the TV, the console and
-- the phones actually meet on; see fnvVenueCode in the game Worker and venueCode in vp-session.js).
-- Migration 68 backfilled join_code for the venues that existed then and nothing ever filled it
-- again, so on 25 Sep 2026:
--   * 4 venues showed a code that was not their channel (Test Alpha/Bravo/Charlie, The Mini Bar):
--     the bingo wall read one code and the trivia and musical walls another (audit 25 Sep);
--   * every venue created since 17 Sep (4 of them) had NO join_code at all.
--
-- This makes the shown code the channel code for every venue, and gives every new venue one on
-- insert, whichever path creates it (onboarding, Add a venue, HQ). The channel does not move, so
-- no TV, console or phone re-subscribes. The replaced codes stop resolving (venueByCode tries
-- join_code, then the hash); none of the four is on a real venue's printed signage (Dean).
--
-- The code is vp_legacy_venue_code(slug) from migration 68, which is fnvVenueCode exactly. (A second
-- copy, vp_venue_code, was written and run first on 25 Sep; it agreed on all 26 venues and 5,000 random
-- slugs and was then dropped, because two copies of one answer is how this codebase breaks.) The check
-- below aborts if it disagrees with any venue whose two codes already matched.
drop function if exists public.vp_venue_code(text);

do $$
declare bad int; clash int;
begin
  select count(*) into bad from public.vp_venues
   where join_code is not null and join_code <> public.vp_legacy_venue_code(slug)
     and id not in (select id from public.vp_venues where slug in ('test-alpha','test-bravo','test-charlie','the-mini-bar'));
  if bad > 0 then raise exception 'vp_legacy_venue_code disagrees with % venue(s) whose codes already matched: not the Worker''s hash', bad; end if;
  select count(*) into clash from (select public.vp_legacy_venue_code(slug) c from public.vp_venues group by 1 having count(*) > 1) t;
  if clash > 0 then raise exception '% code(s) would be shared by two venues', clash; end if;
end $$;

update public.vp_venues set join_code = public.vp_legacy_venue_code(slug)
 where join_code is distinct from public.vp_legacy_venue_code(slug);

create or replace function public.vp_venues_fill_code()
returns trigger language plpgsql set search_path = public as $$
begin
  /* Never fail a sign-up over a code. Two slugs CAN hash to the same six characters (migration
     68's worry, about 0.75% somewhere across 3,000 venues), and join_code is unique, so a clash
     here would turn a new venue's insert into an error. Leave it null instead: every reader
     already falls back to the hash (venueJoinCode), exactly as these venues behaved before 91. */
  if new.join_code is null and new.slug is not null then
    if not exists (select 1 from public.vp_venues v where v.join_code = public.vp_legacy_venue_code(new.slug)
                    and v.id is distinct from new.id) then
      new.join_code := public.vp_legacy_venue_code(new.slug);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.vp_venues_fill_code() from public, anon, authenticated;
drop trigger if exists vp_venues_fill_code on public.vp_venues;
create trigger vp_venues_fill_code before insert or update of slug, join_code on public.vp_venues
  for each row execute function public.vp_venues_fill_code();

-- Rollback: drop trigger vp_venues_fill_code on public.vp_venues; drop function public.vp_venues_fill_code();
--   the code function is migration 68's and stays. The four old codes were 62GTYQ (test-alpha), TMJ2TP (test-bravo),
--   NCEM9A (test-charlie), 2Y3F9Q (the-mini-bar); the four codeless venues were null.
