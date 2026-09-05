-- =====================================================================
-- Migration 65: push a STATE to a screen, not just a restart
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--
-- WHY 63 WAS NOT ENOUGH. Migration 63 gave us a reload that reaches a screen with
-- a dead websocket, and it works. But a reload only restarts a screen: it comes
-- back on the advertising, and then anything still broadcasting pulls it straight
-- back into a game. Dean's words: "we need to be able to push something to the
-- screen." A screen sitting on a finished bingo board could be restarted all day
-- and would keep returning to that board.
--
-- So the poll carries a COMMAND rather than only a timestamp:
--
--   ads     put the venue's advertising back on the wall, now, and hold it there
--           for a couple of minutes so a console that is still announcing an
--           abandoned game cannot immediately take the wall back. It expires on
--           its own, so a real game starting is never blocked for long.
--   reload  what migration 63 did. Kept, because a deploy needs it.
--
-- Same transport, and that is the point: the screen already calls
-- GET /venue?code=... every thirty seconds over ordinary HTTPS. No websocket, no
-- channel, no signing. It reaches a screen that cannot hear anything else.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS screen_command text,
  ADD COLUMN IF NOT EXISTS screen_command_at timestamptz;

COMMENT ON COLUMN public.vp_venues.screen_command IS
  'The last instruction HQ sent this venue''s screens: ''ads'' or ''reload''. Delivered on the GET /venue poll, never over a realtime broadcast, because a screen that has lost its socket is exactly the screen that needs instructing.';

COMMENT ON COLUMN public.vp_venues.screen_command_at IS
  'When screen_command was set. A screen acts on it only when this is NEWER than its own page load, so one press is one action and the stored value cannot make a screen act for ever.';
