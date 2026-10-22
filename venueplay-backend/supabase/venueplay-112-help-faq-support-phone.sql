-- =====================================================================
-- Migration 112: the venue Help FAQ names the support phone
-- ---------------------------------------------------------------------
--   RUN on the live database (verified 22 Oct 2026). Run AFTER migration 106 (it changes a row 106 put there).
--   Safe to run any number of times, and in either order with the Workers
--   and the site: it changes words, not shape.
--
-- WHY. Dean, 20 Oct 2026: VenuePlay has a support phone, 07 5228 3667 (a
-- Crazytel line with a menu: 1 sales, 2 a venue running a game, 3 players,
-- 4 accounts). A venue whose game is going wrong should be told to ring it.
-- The Help panel on the console and the account page reads its questions
-- and answers from vp_help_faq, which migration 106 seeded, so the words
-- live there and not in a file.
--
-- WHAT CHANGES. One answer: VenuePlay, venue, "Contacting us". The same
-- words are in venueplay/data/help-faq.json (the copy the panel falls back
-- on when the Worker cannot be reached), and
-- tools/help-seed-matches-faq.test.py holds the two together.
--
-- ONLY IF DEAN HAS NOT ALREADY CHANGED IT. The update matches the answer
-- 106 seeded, word for word. If it has been edited in HQ since, this does
-- nothing and the edited words stay; add the number there by hand.
--
-- The PLAYER answers are not touched: the phone is for venues, and the
-- menu sends players to voicemail. No new table, policy or grant, so
-- RLS-BASELINE.json does not change.
-- =====================================================================

update public.vp_help_faq
   set answer = 'If a game is on right now and something is going wrong, call 07 5228 3667 and press 2. For anything else, use the form below and we will reply by email (tick "Happening now" if it cannot wait), or email support@venueplay.com.au. For billing, email accounts@venueplay.com.au, or call and press 4.',
       updated_at = now(),
       updated_by = 'migration 112'
 where id = 'df7d1acb-f519-5a1a-8889-518c0d69cb87'
   and answer = 'Use the form below and we will reply by email. If a game night is going wrong right now, tick "Happening now" so it comes to us marked urgent. You can also email support@venueplay.com.au, or accounts@venueplay.com.au about billing.';

-- Read it back (read only):
--   select answer, updated_by from public.vp_help_faq
--    where id = 'df7d1acb-f519-5a1a-8889-518c0d69cb87';
