-- =====================================================================
-- Migration 138: the Help answers still saying "VenuePlay" write the
--                name in lowercase: "Setting up the TV" (venue) and
--                "Who gives out the prizes?" (player)
-- ---------------------------------------------------------------------
--   NOT YET RUN on the live database (written 1 Nov 2026, for the release
--   after Sun 1 Nov). Run AFTER migration 131 (it changes the words 131
--   wrote). Safe to run any number of times, and in either order with the
--   Workers and the site: it changes words, not shape.
--
-- WHY. Dean, 1 Nov 2026: the name is written "venueplay", lowercase, in
-- all customer text (the new F4 logo). The 1 Nov release changed the
-- emails, pages and handouts; these two Help answers are database rows
-- (vp_help_faq, written by migrations 106 and 131), so they kept
-- "VenuePlay" until this migration. The Google Play listing's own
-- name is outside the repo and changes separately.
--
-- WHAT CHANGES. Two answers, one word each.
-- (1) venueplay, venue, "Setting up the TV" (written by 131). Its
-- first line reads "Got a TV with Google Play? Download the venueplay TV
-- app and put in your screen code. Otherwise open venueplay.com.au/tv in
-- the TV's web browser." Every other word 131 wrote stays exactly. The
-- same words are in venueplay/data/help-faq.json (the copy the Help panel
-- and /help fall back on when the Worker cannot be reached);
-- tools/help-seed-matches-faq.test.py holds the two together (106, then
-- 120, then 131, then this, as Postgres would) and
-- tools/tv-app-setup-line.test.py requires the line word for word.
-- (2) venueplay, patron, "Who gives out the prizes?" (seeded by 106 and
-- never changed since): "venueplay supplies the game software only".
--
-- ONLY IF EACH ANSWER IS STILL THE WORDS IT REPLACES (131's and 106's). If
-- Dean has edited one in HQ since, that update does nothing and his words
-- stay; change the word there by hand (HQ > Help desk > Help words). If
-- 131 has not been run yet, run 131 first, then this.
--
-- Not changed here: the help desk's saved replies (migration 126) still say
-- "VenuePlay"; they are HQ's reply macros and change with their own update.
--
-- No new table, policy or grant, so RLS-BASELINE.json does not change.
-- =====================================================================

update public.vp_help_faq
   set answer = 'Got a TV with Google Play? Download the venueplay TV app and put in your screen code. Otherwise open venueplay.com.au/tv in the TV''s web browser.
Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games.
Keep the TV page uncovered and full screen. If the browser window is hidden behind another window or tab, the browser slows the page down, the TV shows RECONNECTING and numbers arrive late. On a laptop, make the browser full screen with nothing over it. On a streaming stick, use a kiosk or full screen browser that opens straight to the TV link.
If the screen goes blank or says RECONNECTING, check nothing is covering the window, then reload the page on the TV.',
       updated_at = now(),
       updated_by = 'migration 138'
 where id = '67840db0-6bea-52b6-81aa-249e2cf977f8'
   and answer = 'Got a TV with Google Play? Download the VenuePlay TV app and put in your screen code. Otherwise open venueplay.com.au/tv in the TV''s web browser.
Open your venue''s TV link in the TV''s web browser (or a laptop or streaming stick plugged into the TV) and leave it running. Your TV link is on your Account page. It shows whatever game you start, and your ads between games.
Keep the TV page uncovered and full screen. If the browser window is hidden behind another window or tab, the browser slows the page down, the TV shows RECONNECTING and numbers arrive late. On a laptop, make the browser full screen with nothing over it. On a streaming stick, use a kiosk or full screen browser that opens straight to the TV link.
If the screen goes blank or says RECONNECTING, check nothing is covering the window, then reload the page on the TV.';

update public.vp_help_faq
   set answer = 'The venue. Every prize is offered and given out by the venue running the game. venueplay supplies the game software only, so any question about a prize goes to the host or the venue.',
       updated_at = now(),
       updated_by = 'migration 138'
 where id = '2717ff1f-f6ec-519a-b359-0dc272f36150'
   and answer = 'The venue. Every prize is offered and given out by the venue running the game. VenuePlay supplies the game software only, so any question about a prize goes to the host or the venue.';

-- Read them back (read only):
--   select id, answer, updated_by from public.vp_help_faq
--    where id in ('67840db0-6bea-52b6-81aa-249e2cf977f8', '2717ff1f-f6ec-519a-b359-0dc272f36150');
--   (both say "venueplay", lowercase, and updated_by migration 138)
--
-- Rollback (puts the old words back, each only if its answer is still this one's):
--   for each update above: update public.vp_help_faq set answer = <its and-answer text>,
--          updated_at = now(), updated_by = 'migration 138 rollback'
--    where id = <its id> and answer = <its set-answer text>;
