-- =====================================================================
-- Migration 69: the members draw remembers WHEN it was last drawn, not
--               just what day, so the Worker can refuse a second draw
--               while the first is still spinning on the wall
-- ---------------------------------------------------------------------
--   Safe to run before OR after pasting venueplay-game.js. The Worker
--   reads this column in its own try/catch and skips the guard if the
--   column is not there yet, so the order does not matter this time.
--
-- WHY. The raffle has had a server-side double-tap guard since the start.
-- The members draw never did: the console locks its own Draw button, but
-- two hosts on two consoles, or one request retried by a phone on bad
-- wifi, both reach the Worker with nothing in the way. The only stamp it
-- kept was last_drawn_date, a DATE, which can tell "drawn tonight" from
-- "not yet" and nothing finer.
--
-- With a timestamp the Worker can hold the button for the draw's own
-- spin length plus two seconds (Dean, 8 Sep 2026), which is the same rule
-- the raffle now follows. Nothing else reads this column.
-- =====================================================================

alter table vp_member_draws
  add column if not exists last_drawn_at timestamptz;

comment on column vp_member_draws.last_drawn_at is
  'When the draw was last run (the Worker refuses another inside draw_length_seconds + 2). last_drawn_date is the day, kept for the "drawn tonight" badge.';
