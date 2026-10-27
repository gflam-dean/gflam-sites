-- =====================================================================
-- Migration 120: the venue Help FAQ tells venues to keep the TV window
--                uncovered and full screen
-- ---------------------------------------------------------------------
--   NOT YET RUN on the live database (written 27 Oct 2026). Run AFTER
--   migration 106 (it changes a row 106 put there). Safe to run any number
--   of times, and in either order with the Workers and the site: it
--   changes words, not shape.
--
-- WHY. 23 Oct 2026, The Mini Bar: the TV showed RECONNECTING and the balls
-- lagged. The TV page was sitting in a Chrome window covered by the
-- console. A covered or background tab is throttled by the browser, the
-- realtime heartbeat stops, the socket closes, and the page cannot
-- reconnect until the window is uncovered. The fix in vp-channel.js helps,
-- but the setup advice is the real cure: the TV page is kept on its own,
-- full screen, kiosk on a stick, never behind another window.
--
-- WHAT CHANGES. One answer: VenuePlay, venue, "Setting up the TV". The
-- same words are in venueplay/data/help-faq.json (the copy the Help panel
-- and /help fall back on when the Worker cannot be reached);
-- tools/help-seed-matches-faq.test.py holds the two together and
-- tools/tv-window-uncovered.test.py reads this file and the JSON and
-- requires both to say uncovered, full screen, kiosk, RECONNECTING.
--
-- ONLY IF DEAN HAS NOT ALREADY CHANGED IT. The update matches the answer
-- 106 seeded, word for word. If it has been edited in HQ since, this does
-- nothing and the edited words stay; add the window advice there by hand
-- (HQ > Help desk > Help words).
--
-- No new table, policy or grant, so RLS-BASELINE.json does not change.
-- =====================================================================

update public.vp_help_faq
   set answer = 'Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games.
Keep the TV page uncovered and full screen. If the browser window is hidden behind another window or tab, the browser slows the page down, the TV shows RECONNECTING and numbers arrive late. On a laptop, make the browser full screen with nothing over it. On a streaming stick, use a kiosk or full screen browser that opens straight to the TV link.
If the screen goes blank or says RECONNECTING, check nothing is covering the window, then reload the page on the TV.',
       updated_at = now(),
       updated_by = 'migration 120'
 where id = '67840db0-6bea-52b6-81aa-249e2cf977f8'
   and answer = 'Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games. If the screen goes blank, reload the page on the TV.';

-- Read it back (read only):
--   select answer, updated_by from public.vp_help_faq
--    where id = '67840db0-6bea-52b6-81aa-249e2cf977f8';
