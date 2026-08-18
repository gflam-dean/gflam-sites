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

-- Which regulator applies: ALREADY SOLVED, do not add a column.
-- ---------------------------------------------------------------------
-- vp_venues already carries `postcode` and `au_state`, written at venue
-- creation by vpaProvisionOneVenue via vpaStateFromPostcode(), and migration 24
-- already reads that postcode to set the timezone. An earlier draft of this
-- migration added a separate `state` column and backfilled it from the FOUNDING
-- account's postcode, which is strictly worse: an account's postcode is the
-- billing address, and a group can run venues in several states.
--
-- Use au_state. Nothing to add here.
--
-- The real gap is upstream: HQ's Add venue form does not ask for a postcode
-- (it sends an empty string), so an HQ-created venue has no postcode and
-- therefore no au_state. That is a form fix, not a schema one. Any venue with a
-- null au_state is treated as "rules not confirmed": no category guidance, and
-- phone bingo tickets stay ON, because the paper-ticket rule must only fire
-- where we positively know the venue is in SA, the ACT or Tasmania.
--
-- Find the ones missing it:
--   select id, name, postcode, au_state from vp_venues where au_state is null;

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
