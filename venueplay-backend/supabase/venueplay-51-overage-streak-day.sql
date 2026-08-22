-- =====================================================================
-- Migration 51: a big night is a NIGHT, even when it is three games
-- ---------------------------------------------------------------------
--   ****  RUN THIS *AFTER* PASTING venueplay-game.js, NOT BEFORE.  ****
--
-- Broadcast bingo is now metered per GAME (Dean, 22 Aug): a venue that runs
-- bingo and then trivia on the same night has drawn two crowds and pays on both,
-- where a daily rule would quietly bill them for the larger one only.
--
-- That is right for the CHARGE and wrong for the STREAK. The three-big-nights
-- rule moves a venue onto a bigger plan after three consecutive over-cap nights,
-- and it advances once per charge. Per-game charging would let a venue that runs
-- three bingo sessions on one busy Saturday hit all three in an afternoon and be
-- moved onto a bigger plan permanently, off the back of a single day.
--
-- So the charge stays per game and the STREAK counts distinct nights. This column
-- remembers which night last advanced it. A second game the same night is charged
-- in full and leaves the streak where it is.
--
-- A night runs 2am to 2am Brisbane, which is Dean's own boundary: a bingo session
-- that finishes at 12:30am belongs to the night it started, not to the next day.
-- Brisbane has no daylight saving, so this is a fixed UTC+10 with no seasonal
-- edge to get wrong.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS overage_streak_day text;

COMMENT ON COLUMN public.vp_venues.overage_streak_day IS
  'The 2am-to-2am Brisbane night (YYYY-MM-DD) that last advanced overage_streak. A second over-cap game on the SAME night is charged in full but does not advance the streak, so three games on one Saturday cannot trigger the three-big-nights plan uplift.';
