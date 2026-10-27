-- VenuePlay migration 13: once-a-week limit for Trivia and Musical Bingo.
--
-- Each venue may only run a NEW trivia night and a NEW musical bingo night once
-- per rolling 7 days each. Bingo, raffles and members draws stay unlimited.
-- The game Worker stamps these when a trivia/musical night starts and blocks a
-- new one within 7 days. Tracking by session id means extra rounds within the
-- SAME night never count against the limit.
--
-- Safe to run more than once.

ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS last_trivia_at            timestamptz;
ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS last_trivia_session_id    uuid;
ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS last_musical_at           timestamptz;
ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS last_musical_session_id   uuid;
