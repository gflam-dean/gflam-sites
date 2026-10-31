-- =====================================================================
-- Migration 131: the venue Help FAQ names the VenuePlay TV app for a TV
--                with Google Play
-- ---------------------------------------------------------------------
--   NOT YET RUN on the live database (written 31 Oct 2026). Run AFTER
--   migration 120 (it changes the words 120 wrote, and 120 changes the row
--   106 put there). Safe to run any number of times, and in either order
--   with the Workers and the site: it changes words, not shape.
--
-- WHY. Dean, 31 Oct 2026: "we need to add in all of our set up
-- instructions. If you have a TV with a Google play store you can download
-- our app... It's called VenuePlay TV." The Android TV / Google TV app is
-- live on Google Play (au.com.venueplay.tv) and pairs by the screen code.
-- Every setup guide now carries one line saying so: the setup guide's TV
-- step (vp-firstrun.js), the four welcome emails, and this Help answer.
--
-- WHAT CHANGES. One answer: VenuePlay, venue, "Setting up the TV". One new
-- first line; every word 120 wrote stays, after it. The same words are in
-- venueplay/data/help-faq.json (the copy the Help panel and /help fall back
-- on when the Worker cannot be reached); tools/help-seed-matches-faq.test.py
-- holds the two together (106, then 120, then this, as Postgres would) and
-- tools/tv-app-setup-line.test.py requires the line in all of the places.
--
-- ONLY IF THE ANSWER IS STILL 120's. If Dean has edited it in HQ since,
-- this does nothing and his words stay; add the line there by hand
-- (HQ > Help desk > Help words). If 120 has not been run yet, run 120
-- first, then this.
--
-- No new table, policy or grant, so RLS-BASELINE.json does not change.
-- =====================================================================

update public.vp_help_faq
   set answer = 'Got a TV with Google Play? Download the VenuePlay TV app and put in your screen code. Otherwise open venueplay.com.au/tv in the TV''s web browser.
Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games.
Keep the TV page uncovered and full screen. If the browser window is hidden behind another window or tab, the browser slows the page down, the TV shows RECONNECTING and numbers arrive late. On a laptop, make the browser full screen with nothing over it. On a streaming stick, use a kiosk or full screen browser that opens straight to the TV link.
If the screen goes blank or says RECONNECTING, check nothing is covering the window, then reload the page on the TV.',
       updated_at = now(),
       updated_by = 'migration 131'
 where id = '67840db0-6bea-52b6-81aa-249e2cf977f8'
   and answer = 'Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games.
Keep the TV page uncovered and full screen. If the browser window is hidden behind another window or tab, the browser slows the page down, the TV shows RECONNECTING and numbers arrive late. On a laptop, make the browser full screen with nothing over it. On a streaming stick, use a kiosk or full screen browser that opens straight to the TV link.
If the screen goes blank or says RECONNECTING, check nothing is covering the window, then reload the page on the TV.';

-- Read it back (read only):
--   select answer, updated_by from public.vp_help_faq
--    where id = '67840db0-6bea-52b6-81aa-249e2cf977f8';
--
-- Rollback (puts 120's words back, only if the answer is still this one's):
--   update public.vp_help_faq set answer = <the and-answer text above>, updated_at = now(),
--          updated_by = 'migration 131 rollback'
--    where id = '67840db0-6bea-52b6-81aa-249e2cf977f8' and answer = <the set-answer text above>;
