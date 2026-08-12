-- VenuePlay migration 36: clear the "already asked" memory, because it was never true.
--
-- Migration 26 built vp_asked_questions so a trivia question would not come round again at the
-- same venue for twelve months. The game Worker duly wrote a row for every question it CHOSE for
-- a round. It just never saved the chosen order onto the game, so the round fell through to the
-- legacy path and played the set in plain seq order instead.
--
-- The result is a table full of questions recorded as asked at a venue that the room was never
-- actually asked, each one now blocked from being asked for twelve months. Left alone it would
-- quietly starve the question bank through the whole first year of trading, and the symptom
-- (hosts running short of questions) would look nothing like the cause.
--
-- The Worker fix is one line, saving question_seqs onto the game config. This clears the bad
-- history that fix would otherwise inherit. Nothing of value is lost: every row in here predates
-- the randomiser actually working, so not one of them records a question a player really saw.
-- Worst case a genuinely-asked question can recur sooner than twelve months, which is a far
-- smaller problem than a bank that empties itself.
--
-- Safe to run more than once (after the first run there is simply nothing to delete).

DELETE FROM public.vp_asked_questions;

COMMENT ON TABLE public.vp_asked_questions IS
  'Per-venue "already asked" memory: a trivia question recycles 12 months after its last ask. Written by the game Worker (service role) from the seqs it chooses for a round, which are also saved to vp_games.config.question_seqs. Those two MUST stay in step: when they were not, this table recorded questions nobody had been asked and blocked them for a year (migration 36).';
