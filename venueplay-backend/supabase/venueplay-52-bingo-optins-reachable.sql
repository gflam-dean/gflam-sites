-- =====================================================================
-- Migration 52: the venue can finally see the opt-ins from a bingo night
-- ---------------------------------------------------------------------
--   ****  RUN THIS *AFTER* PASTING venueplay-game.js, NOT BEFORE.  ****
--
-- WHAT WAS WRONG. vp_captures had two writes and no reads. Anywhere. Every name,
-- email and mobile a player handed over on a broadcast bingo night landed in it
-- and stopped there: the venue's "download your opt-ins" reads v_vp_player_optins,
-- which is built from vp_players, and broadcast bingo mints no player rows. So the
-- format the venues run most was the one format whose opt-ins they could never get.
--
-- It is also the wrong side of the Privacy Act to sit on. We asked a punter for
-- their details and their consent, stored both, and gave the venue no way to use
-- them, see them, or honour a request to delete them.
--
-- WHAT THIS DOES. Adds captures to the export view, so a bingo opt-in comes out of
-- the same button as every other one, and adds the flag that keeps forged rows out.
--
-- ON during_game. /capture cannot authenticate the phone. It authorises on a venue
-- code derived from the venue's PUBLIC slug, so anyone who knows a venue exists can
-- post a capture at it, including a marketing_optin with a consent timestamp for a
-- person who never consented. That is the venue's Spam Act problem, not ours, and
-- it stayed open because nothing can fix it from the phone's side.
--
-- What the Worker CAN now check is whether that venue actually had a game running
-- when the capture arrived: the console posts a report row the moment a game starts.
-- A capture that lands during a live game is marked true; one that arrives out of
-- nowhere at 4am is marked false and stays out of the export. It does not make
-- forgery impossible, it makes it need timing, and it keeps whatever slips through
-- out of the list the venue actually mails.
--
-- Rows written before this migration have during_game NULL, which the view treats
-- as exportable: they predate the check and throwing away real opt-ins to be tidy
-- would be its own kind of wrong.
--
-- Safe to run more than once.

ALTER TABLE public.vp_captures
  ADD COLUMN IF NOT EXISTS during_game boolean;

COMMENT ON COLUMN public.vp_captures.during_game IS
  'True when this capture arrived while the venue had a game report open (the console posts one at game start). False means it arrived with no game running, which is what a forged capture looks like, and the export view leaves those out. NULL is a row from before the check existed and is still exported.';

CREATE INDEX IF NOT EXISTS vp_captures_optin_idx
  ON public.vp_captures (venue_id, marketing_optin_at DESC)
  WHERE marketing_optin = true;

-- Same seven columns, same order, same types: the Worker's select is unchanged.
CREATE OR REPLACE VIEW v_vp_player_optins AS
SELECT
  s.venue_id            AS venue_id,
  p.first_name          AS first_name,
  p.last_name           AS last_name,
  p.email               AS email,
  p.mobile              AS mobile,
  p.postcode            AS postcode,
  p.marketing_optin_at  AS opted_in_at
FROM vp_players p
JOIN vp_sessions s ON s.id = p.session_id
WHERE p.marketing_optin = true

UNION ALL

-- Broadcast bingo. No session and no player row, so these arrive through /capture.
SELECT
  c.venue_id            AS venue_id,
  c.first_name          AS first_name,
  c.last_name           AS last_name,
  c.email               AS email,
  c.mobile              AS mobile,
  c.postcode            AS postcode,
  c.marketing_optin_at  AS opted_in_at
FROM vp_captures c
WHERE c.marketing_optin = true
  AND c.during_game IS DISTINCT FROM false;   -- keeps NULL (pre-check) rows, drops the forgeries

COMMENT ON VIEW v_vp_player_optins IS
  'Every marketing opt-in a venue may export, from BOTH paths: vp_players for the server-backed formats (trivia, musical bingo, raffles) and vp_captures for broadcast bingo. Worker-only, service role. The Worker de-duplicates on email/mobile when it builds the CSV, so a regular who plays both formats appears once.';
