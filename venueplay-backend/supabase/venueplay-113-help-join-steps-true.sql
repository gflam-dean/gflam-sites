-- =====================================================================
-- Migration 113: the venue Help steps say what the product does
-- ---------------------------------------------------------------------
--   NOT RUN. Run AFTER migration 106 (it changes rows 106 put there).
--   Safe to run any number of times, and in either order with the Workers
--   and the site: it changes words and order, not shape.
--
-- WHY. Dean, 21 Oct 2026, reviewing the venue Help panel: the steps for
-- "Players cannot join" were in the wrong order, and one said to "check
-- your player limit", as if the limit could stop people joining. It cannot.
-- The game Worker's /join has no plan cap at all; the cap is only asked
-- about when the host STARTS a game, and the console then shows the extra
-- players and the price and the host taps Start game to approve them
-- (handleHostGame's overage gate, the ovgModal in every console).
-- tools/test-help-triage-truth.js runs the real /join over the cap to prove
-- that, and checks the button these words name is the button on screen.
--
-- WHAT CHANGES (VenuePlay, venue, "Players cannot join"):
--   step 1  the way in first: the QR code on the TV or venueplay.com.au/play
--   step 2  the code they typed matches the TV (words unchanged)
--   step 3  the plan never stops anyone joining; approve extras at Start game
-- Steps 1 and 2 are PINNED so the automatic reorder (by fix rate) can never
-- put a later step above "have they got the link". Step 3 is then the only
-- unpinned step, and one step alone never moves.
-- And one answer, VenuePlay venue FAQ "Billing and players", which began
-- "Your plan sets how many players can join a night": same correction. The
-- same words are in venueplay/data/help-faq.json, and
-- tools/help-seed-matches-faq.test.py holds the two together.
--
-- ONLY IF DEAN HAS NOT ALREADY CHANGED THEM. Every update matches the words
-- 106 seeded, exactly (or, for a re-run, the words this file writes). A row
-- edited in HQ since is left alone; change it there by hand.
--
-- No new table, policy or grant, so RLS-BASELINE.json does not change.
-- =====================================================================

update public.vp_help_steps
   set body = 'Make sure players have the way in: scan the QR code on the TV with the phone camera, or go to venueplay.com.au/play. If the page was already open, pull down to refresh it.',
       position = 10, pinned = true, updated_at = now(), updated_by = 'migration 113'
 where id = '275e462c-49e8-518f-9439-da36205d9f48'
   and issue_id = '927e1377-e4c3-5065-9b7b-03d937321928'
   and body in ('Ask the player to pull down to refresh, or scan the QR code on the TV again.',
                'Make sure players have the way in: scan the QR code on the TV with the phone camera, or go to venueplay.com.au/play. If the page was already open, pull down to refresh it.');

update public.vp_help_steps
   set position = 20, pinned = true, updated_at = now(), updated_by = 'migration 113'
 where id = 'b9f053a2-01b2-5afb-ae83-e6eb1d58a679'
   and issue_id = '927e1377-e4c3-5065-9b7b-03d937321928'
   and body = 'Check the code they typed matches the code on the TV.';

update public.vp_help_steps
   set body = 'Your plan never stops anyone joining. If the console shows extra players when you start the game, tap Start game to approve them.',
       position = 30, updated_at = now(), updated_by = 'migration 113'
 where id = '7c5fd089-5b6d-506d-a7be-538a82ea75f5'
   and issue_id = '927e1377-e4c3-5065-9b7b-03d937321928'
   and body in ('Check your player limit on the Account page. On a bigger night the console asks the host to approve extra players.',
                'Your plan never stops anyone joining. If the console shows extra players when you start the game, tap Start game to approve them.');

update public.vp_help_faq
   set answer = 'Your plan includes a number of players a night, and it never stops anyone joining. If a night runs bigger, the console shows the extra players when your host starts the game, and each extra player is $2 for that night once your host taps Start game to approve. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.',
       updated_at = now(),
       updated_by = 'migration 113'
 where id = 'd3a64ff4-0b24-5073-be9a-32f85519ec1b'
   and answer = 'Your plan sets how many players can join a night. If a night runs bigger, each extra player is $2 for that night, and your host confirms it on screen before the game starts. Your Account page shows your plan, your next payment and your invoices. For anything about a bill, email accounts@venueplay.com.au.';

-- ---------------------------------------------------------------------
-- 21 Oct 2026, Dean's second look. "The TV is not showing the game":
--   step 2 names the venue's ACTUAL TV link. The words hold {tv_link}, and the Help panel fills it
--          in for a signed-in venue as "your venue's TV link, venueplay.com.au/tv?<slug>" (the
--          address the Account page shows); anywhere else, "your venue's TV link (it is on your
--          Account page)". If HQ edits this step, keep {tv_link} in it.
--   step 3 says what "online" means.
-- And there is no "Happening now" tick any more: the Worker marks a console request urgent itself
-- when a game or lobby is open at the venue. So "Contacting us" stops telling people to tick it.
-- It has TWO guarded versions: 106's words (this branch), and migration 112's words, for when
-- feature/support-phone has been run first. Whichever the row holds is the one that changes.
-- ---------------------------------------------------------------------

update public.vp_help_steps
   set body = 'Check the TV is showing {tv_link}.', updated_at = now(), updated_by = 'migration 113'
 where id = '15d9bd36-27a0-5ccd-849b-eb65b1a19f44'
   and issue_id = '857c3542-d097-54c2-afba-9cdbd1f5a193'
   and body = 'Check the TV is using your venue''s TV link from your Account page.';

update public.vp_help_steps
   set body = 'Check the TV is connected to the internet: try opening another website on it.', updated_at = now(), updated_by = 'migration 113'
 where id = 'fc72fa44-ff4e-5ecd-ab95-3dc774cab025'
   and issue_id = '857c3542-d097-54c2-afba-9cdbd1f5a193'
   and body = 'Check the TV is online: open any other website on it.';

update public.vp_help_faq
   set answer = 'Use the form below and we will reply by email. Sent from your console while a game is on at your venue, it comes to us marked urgent. You can also email support@venueplay.com.au, or accounts@venueplay.com.au about billing.',
       updated_at = now(),
       updated_by = 'migration 113'
 where id = 'df7d1acb-f519-5a1a-8889-518c0d69cb87'
   and answer = 'Use the form below and we will reply by email. If a game night is going wrong right now, tick "Happening now" so it comes to us marked urgent. You can also email support@venueplay.com.au, or accounts@venueplay.com.au about billing.';

update public.vp_help_faq
   set answer = 'If a game is on right now and something is going wrong, call 07 5228 3667 and press 2. For anything else, use the form below and we will reply by email (sent from your console while a game is on, it comes to us marked urgent), or email support@venueplay.com.au. For billing, email accounts@venueplay.com.au, or call and press 4.',
       updated_at = now(),
       updated_by = 'migration 113'
 where id = 'df7d1acb-f519-5a1a-8889-518c0d69cb87'
   and answer = 'If a game is on right now and something is going wrong, call 07 5228 3667 and press 2. For anything else, use the form below and we will reply by email (tick "Happening now" if it cannot wait), or email support@venueplay.com.au. For billing, email accounts@venueplay.com.au, or call and press 4.';

-- Read it back (read only):
--   select position, pinned, body from public.vp_help_steps
--    where issue_id = '927e1377-e4c3-5065-9b7b-03d937321928' order by position;
--   select answer, updated_by from public.vp_help_faq where id in ('d3a64ff4-0b24-5073-be9a-32f85519ec1b', 'df7d1acb-f519-5a1a-8889-518c0d69cb87');
--   select position, body from public.vp_help_steps where issue_id = '857c3542-d097-54c2-afba-9cdbd1f5a193' order by position;
