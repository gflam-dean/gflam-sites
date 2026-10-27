-- =====================================================================
-- Migration 66: which page is that screen actually running?
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--
-- WHY. On 5 Sep The Mini Bar's screen reported healthy in HQ - it was polling us
-- every thirty seconds, so the heartbeat said "Screen ok" - and it still would not
-- obey a reload. Both facts were true: it WAS alive, and it was running a page
-- from before the reload code existed, so it had nothing to obey with.
--
-- From HQ those two states looked identical, and the only way to tell them apart
-- was to walk into the pub. That is the same blindness the heartbeat was meant to
-- cure, one level down: we could finally see that a screen was talking to us, but
-- not whether it was current.
--
-- The screen now sends its build on the request it already makes, so "Screen ok"
-- can mean "and it is current". A screen that sends nothing is recorded as
-- 'pre-5-sep': by its silence, an old one that needs a physical reload.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS screen_version text;

COMMENT ON COLUMN public.vp_venues.screen_version IS
  'The tv.html build a screen at this venue last reported, sent as ?v= on its GET /venue poll. ''pre-5-sep'' means the screen sent no version at all, so it is running a page older than this feature and cannot act on a remote reload - it needs a physical reload once. Anything else is the build string from tv.html.';
