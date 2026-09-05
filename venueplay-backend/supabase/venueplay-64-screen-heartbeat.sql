-- =====================================================================
-- Migration 64: show HQ whether a screen is actually listening
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--   Same reason as 63: the Worker reads and writes this column.
--
-- WHY. A venue screen that has lost its realtime socket is visually identical to
-- a working one. The advertising is built and timed locally, so it keeps rotating
-- perfectly while the screen cannot hear the host OR anything from HQ. On 5 Sep
-- that cost most of an afternoon: three separate faults each independently
-- blocked the reload button, and every diagnosis had to start by guessing whether
-- a screen was even receiving.
--
-- HQ shows "Live now" and "Active", which describe the VENUE's session, not the
-- screen. Nothing anywhere said "this screen last spoke to us four hours ago".
--
-- The screen already calls GET /venue?code=... every thirty seconds over ordinary
-- HTTPS to check its venue still exists. That is a heartbeat we were throwing
-- away. The Worker now stamps this column on that request, and HQ turns it into a
-- badge per venue, so a dead screen is obvious instead of being something you
-- discover by pressing a button that appears to do nothing.
--
-- HONEST LIMIT: /venue is an anonymous endpoint, so anyone who knows a venue code
-- could poll it and make a dead screen look alive. That is worth knowing and not
-- worth defending against - the failure mode is an ops indicator reading
-- optimistic, and the alternative is authenticating the one request that has to
-- work when everything else is broken.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS screen_seen_at timestamptz;

COMMENT ON COLUMN public.vp_venues.screen_seen_at IS
  'When a screen at this venue last polled GET /venue. Written by the game Worker on that request, at most once every 25 seconds per venue. HQ reads it to show whether a screen is listening at all - a screen with a dead websocket looks completely healthy from the room, because its advertising is timed locally. Anonymous endpoint, so treat it as "something at this venue is polling", not proof of a specific device.';

CREATE INDEX IF NOT EXISTS vp_venues_screen_seen_at_idx
  ON public.vp_venues (screen_seen_at DESC NULLS LAST);
