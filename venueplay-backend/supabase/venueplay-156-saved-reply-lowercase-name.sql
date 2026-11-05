-- =====================================================================
-- Migration 156: the help desk saved reply "Player: a prize question"
--                writes the name in lowercase: "venueplay supplies the
--                game software only"
-- ---------------------------------------------------------------------
--   NOT YET RUN on the live database (written 5 Nov 2026, for the 6 Nov
--   release). Run AFTER migration 126 (it changes the words 126 seeded).
--   Safe to run any number of times, and in either order with the Workers
--   and the site: it changes words, not shape.
--
-- WHY. Dean, 1 Nov and 4 Nov 2026: the name is written "venueplay",
-- lowercase, in all customer text. fix/site-polish-6nov changed the
-- built-in starter set (SEED in venueplay/app/vp-helpdesk-hq.js, the copy
-- HQ falls back on before the table exists), and tools/test-help-desk.js
-- now requires every starter reply to be lowercase. The live rows were
-- seeded by 126 and keep "VenuePlay" until this runs, which is what HQ
-- shows while they do. tools/test-help-saved-replies.js holds the page and
-- the migrations together (126, then this, as Postgres would).
--
-- WHAT CHANGES. One saved reply, one word: seed_key 'player-prize'.
-- ONLY IF IT IS STILL THE WORDS 126 SEEDED. If Dean has edited it in HQ
-- since, this does nothing and his words stay; change the word there by
-- hand (HQ > Help desk > Saved replies).
--
-- No new table, policy or grant, so RLS-BASELINE.json does not change.
-- Read-back: select seed_key, updated_by, body from
--   public.vp_help_saved_replies where seed_key = 'player-prize';
--   (updated_by 'migration 156' and "venueplay supplies" in the body.)
-- Rollback: the same update with the two bodies swapped.
-- =====================================================================

update public.vp_help_saved_replies
   set body = E'Hi {first_name},\n\nThanks for your message. Prizes are offered and given out by the venue running the game, and they\'re always claimed from the host on the night. venueplay supplies the game software only, so the best people to help with a prize are the host or the manager at {venue}.\n\nCheers,',
       updated_at = now(),
       updated_by = 'migration 156'
 where seed_key = E'player-prize'
   and body = E'Hi {first_name},\n\nThanks for your message. Prizes are offered and given out by the venue running the game, and they\'re always claimed from the host on the night. VenuePlay supplies the game software only, so the best people to help with a prize are the host or the manager at {venue}.\n\nCheers,';
