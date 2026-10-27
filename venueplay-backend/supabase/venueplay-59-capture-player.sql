-- =====================================================================
-- Migration 59: a capture is tied to a real player
-- ---------------------------------------------------------------------
--   ****  RUN THIS *AFTER* PASTING venueplay-game.js, NOT BEFORE.  ****
--
-- Broadcast bingo now opens a server session like every other format, its TV
-- shows that session's join code rather than the venue's permanent one, and the
-- phone joins through /join and holds a player token. So a capture can finally
-- say WHO it came from instead of only which venue it claimed to be at.
--
-- WHY IT MATTERS. /capture used to authorise on a code derived from the venue's
-- PUBLIC slug, which never changes and is printed on the table talkers. Anyone
-- who knew a venue existed could post a marketing opt-in, with a consent
-- timestamp, for a person who never consented. That is the venue's Spam Act
-- problem, and no amount of rate limiting fixes a missing identity.
--
-- A session join code is different: it exists only while that game runs and it is
-- only on the venue's own screen. Holding a player token minted against it is
-- evidence of having actually been in the room.
--
-- Captures that arrive with no token are still STORED, never dropped, but marked
-- during_game = false so they stay out of the export the venue actually mails.
-- Losing a real punter's details to be strict is its own kind of wrong.
--
-- Safe to run more than once.

ALTER TABLE public.vp_captures
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES public.vp_players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vp_captures_player_idx
  ON public.vp_captures (player_id) WHERE player_id IS NOT NULL;

COMMENT ON COLUMN public.vp_captures.player_id IS
  'The vp_players row this capture came from, when the phone held a token minted by /join against a live session code. NULL means the capture arrived without one, which is what a forged capture looks like; those are stored but marked during_game = false and left out of v_vp_player_optins.';
