-- VenuePlay migration 14: game-worker hardening (from the code review).
--
-- Three safeguards the game Worker now relies on:
--   1. One bingo/musical card per player per game. A DB-side guard was dropped earlier
--      (migration 09) which let a double-tap deal a player two cards (and the winner check
--      then looked at only one at random). Cards-per-player is forced to 1 today, so this is
--      safe to restore. NOTE: if the multi-card feature is ever built, revisit this.
--   2. One round number (seq) per session. Makes the round counter unique so two fast taps
--      on "new game" can't create two rounds with the same number; the Worker now surfaces
--      the clash as a clean "please try again" and the retry picks the next number.
--   3. vp_member_draws.last_resolved_at, so a double-tap on the members-draw resolve can be
--      detected and the jackpot is not advanced twice.
--
-- Deliberately NOT touched: vp_raffle_results / vp_music_plays round numbers, because a
-- single draw can legitimately write several rows sharing one round number (multi-winner);
-- their double-tap races want an atomic DB function, handled separately.
--
-- Safe to run more than once. If any table already holds duplicate rows from the old bug,
-- the matching CREATE UNIQUE INDEX will error - clean the duplicates first (there is no live
-- data pre-launch, so this should just succeed).

CREATE UNIQUE INDEX IF NOT EXISTS vp_cards_one_per_player_game
  ON vp_cards (game_id, player_id);

CREATE UNIQUE INDEX IF NOT EXISTS vp_games_session_seq
  ON vp_games (session_id, seq);

ALTER TABLE vp_member_draws ADD COLUMN IF NOT EXISTS last_resolved_at timestamptz;

-- Host-approved overage. When the room passes the plan cap, the host taps OK to accept the
-- extra players being billed; that sets overage_approved so games can start over cap AND the
-- overage is charged at close. No approval => no overage charge (a fake-join flood can't bill).
ALTER TABLE vp_sessions ADD COLUMN IF NOT EXISTS overage_approved     boolean NOT NULL DEFAULT false;
ALTER TABLE vp_sessions ADD COLUMN IF NOT EXISTS overage_approved_at  timestamptz;
