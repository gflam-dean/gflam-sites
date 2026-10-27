-- =====================================================================
-- Migration 63: a screen reload that does not need the websocket
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--   The Worker reads and writes this column; running it first means the new
--   Worker never queries a column that is not there.
--
-- WHY. Every remote reload we have ever built travels on a Supabase realtime
-- broadcast, and that is exactly the thing that breaks. A venue screen whose
-- socket drops looks perfectly healthy - the advertising is built and timed
-- locally and keeps rotating - while being unable to hear the host OR the reload
-- command that would fix it. So the fix for a broken channel was being sent down
-- the broken channel. Dean has physically reset screens more than once because of
-- this, and was told each time it was the last time.
--
-- The screen already asks GET /venue?code=... every thirty seconds over ordinary
-- HTTPS, entirely independent of the websocket. So the reload becomes something
-- the screen PULLS on that request rather than something we hope it hears:
--
--   HQ sets screen_reload_at = now()
--   the screen's next 30s poll sees a timestamp newer than its own page load
--   it reloads itself
--
-- Worst case is thirty seconds instead of instant, and it works with a dead
-- socket, a channel that errored out, and broadcast signing enforced - none of
-- which the broadcast path survives. The broadcast still fires too, because when
-- it works it is immediate; this is the floor under it, not a replacement.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS screen_reload_at timestamptz;

COMMENT ON COLUMN public.vp_venues.screen_reload_at IS
  'When an admin last asked this venue''s screens to reload. A screen compares it to its own page-load time on the GET /venue poll it already makes every 30 seconds, and reloads if this is newer. Deliberately NOT delivered by realtime broadcast: a screen that has lost its socket is precisely the screen that needs reloading, and cannot be told over the socket it has lost.';

-- Nobody needs history here; it is a doorbell, not a log. The audit row written by
-- the Worker is the record of who pressed it.
