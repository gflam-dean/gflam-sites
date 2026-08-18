-- =====================================================================
-- Migration 44: paid-entry games off by default, and the facts needed to
-- work out which gaming category a venue is actually in
-- ---------------------------------------------------------------------
-- WHY
--
-- OLGR (QLD) wrote to us on 18 Aug 2026. Their position, in short:
--   * Trivia is a game of skill and is NOT regulated by them.
--   * Bingo, musical bingo, members draws and raffles fall under the
--     Charitable and Non-Profit Gaming Act 1999.
--   * A FOR-PROFIT venue (a pub or hotel) may only run a Category 4
--     promotional game, and ENTRY MUST BE FREE.
--   * A NON-PROFIT (a community club, RSL) may run Category 1, 2 or 3,
--     which turn on how much the tickets raise.
--   * As a Third Party Operator we are expected to ensure our clients
--     abide by their own category.
--
-- We supply software. The venue supplies the prize, sells any tickets and
-- keeps the proceeds. We are not the regulator and this is not built to
-- police anyone. What it does is make the safe thing the default, put the
-- numbers in front of the person running the night, and record that they
-- are the conductor.
--
-- THE DEFAULT IS FREE ENTRY, FOR EVERYONE.
-- Free entry is a Category 4 promotional game, which anyone may run with no
-- licence, so it is the one setting that is safe for every venue in every
-- state. paid_entry_enabled is off until Gflam turns it on for a venue that
-- has told us what it is.
-- =====================================================================

-- Off for everyone. Only HQ can turn this on, per venue.
alter table vp_venues
  add column if not exists paid_entry_enabled boolean not null default false;

comment on column vp_venues.paid_entry_enabled is
  'FALSE (default) = this venue may only run free-entry games, which is a Category 4 promotional game and needs no licence anywhere. TRUE = Gflam has confirmed this venue''s entity type and it may run paid-entry games under its own category. Set from HQ only, never by the venue.';

-- What the venue actually IS. Everything in the CNPG Act turns on this and we
-- have never recorded it: the marketing gate guesses from the venue name and
-- the contact email domain, which is fine for a marketing toggle and nowhere
-- near good enough for a gaming category.
alter table vp_venues
  add column if not exists entity_type text;

comment on column vp_venues.entity_type is
  'for_profit (pub, hotel, tavern: Category 4 free-entry promotional games only) or non_profit (community club, RSL, bowls club: may run Category 1/2/3 subject to their ticket sales). NULL = we have not asked yet, which means treat as for_profit and free entry only.';

alter table vp_venues
  add constraint vp_venues_entity_type_chk
  check (entity_type is null or entity_type in ('for_profit', 'non_profit'))
  not valid;

-- Which regulator applies. Gaming rules are state law, and OLGR's ruling is
-- QLD only. We currently derive a state from the founding account's postcode
-- at signup, which is not the same thing as where the VENUE is: a group can
-- have venues in more than one state.
alter table vp_venues
  add column if not exists state text;

comment on column vp_venues.state is
  'AU state/territory the VENUE is in (QLD, NSW, VIC, WA, SA, TAS, NT, ACT), which decides whose gaming rules apply. Not the same as the account''s postcode: a group can operate across state lines.';

-- Backfill what we can from the founding account's postcode. Anything we
-- cannot resolve stays NULL, which the app treats as "rules not confirmed"
-- and shows no category guidance at all, rather than guessing.
update vp_venues v
   set state = case
         when left(f.postcode, 1) = '4' then 'QLD'
         when left(f.postcode, 1) in ('2') and f.postcode >= '2600' and f.postcode <= '2618' then 'ACT'
         when left(f.postcode, 1) = '2' then 'NSW'
         when left(f.postcode, 1) = '3' then 'VIC'
         when left(f.postcode, 1) = '5' then 'SA'
         when left(f.postcode, 1) = '6' then 'WA'
         when left(f.postcode, 1) = '7' then 'TAS'
         when left(f.postcode, 1) = '0' then 'NT'
         else null
       end
  from venueplay_founding f
 where v.founding_id = f.id
   and v.state is null
   and coalesce(f.postcode, '') <> '';

-- The conductor's own declaration, recorded per game that is run for money.
-- This is the thing that answers OLGR's Third Party Operator point: the venue
-- states, at the time, that it is the conductor, that it supplies the prize
-- and keeps the proceeds, and which category it believes it is in.
create table if not exists vp_gaming_declarations (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references vp_venues(id) on delete cascade,
  game_id             uuid,
  format              text not null,                 -- bingo90 | musical | raffle | members
  entity_type         text,                          -- as recorded on the venue at the time
  state               text,
  paid_entry          boolean not null default false,
  expected_sales_cents  integer,                     -- what the venue expects the tickets to raise
  total_prize_cents     integer,                     -- what the venue is putting up
  category_claimed    text,                          -- e.g. 'QLD-CAT-2', 'QLD-CAT-4-PROMOTIONAL'
  declared_by         uuid,                          -- vp_venue_staff.id of whoever ticked it
  declared_at         timestamptz not null default now()
);
create index if not exists vp_gaming_decl_venue_idx on vp_gaming_declarations (venue_id, declared_at desc);
alter table vp_gaming_declarations enable row level security;
-- No policies: the Worker writes with the service key, nothing is readable by
-- the public key. Same posture as vp_captures.
