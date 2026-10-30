-- =====================================================================
-- Migration 130: the prospect review's Edit page gets a Postcode box and a
-- Pub / Club choice, and the review pages show the recommendation
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries it. Either order is safe: a Worker without
--   these columns falls back to the review pages and decisions it had
--   before (no boxes on the Edit page), and the Mac reads an Edit with no
--   box values as "nothing changed but the reply", as it always did.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json if anything moved (it should not: the table's
--   locks from migration 128 are unchanged, no grants are added here).
--
-- WHY. Dean, 30 Oct 2026, after the Sarah end-to-end test: the yellow boxes
-- in the review email told him to type "--postcode NNNN" and "--club", which
-- he cannot do from his phone. The Edit page now has a Postcode box, a Pub /
-- Club choice and a Login email box, filled from what the autopilot found;
-- the Mac applies them through the same path as its --postcode, --club and
-- --email flags. The review pages also show the autopilot's recommendation
-- ("Send the standard reply" or "Edit first") and its plain-words warnings.
--
-- WHAT IS STORED.
--   details             what the Mac sent with the review: postcode, state,
--                        entity_type, login_email, recommend, recommend_why,
--                        warnings (a list of sentences). An object, capped.
--   edited_postcode     Dean's Postcode box, 4 digits
--   edited_entity_type  Dean's Pub / Club choice
--   edited_login_email  Dean's Login email box
-- Cleared with the decision when a held yes opens a new round.
-- =====================================================================

alter table public.vp_autopilot_reviews
  add column if not exists details jsonb
    check (details is null or (jsonb_typeof(details) = 'object' and char_length(details::text) <= 20000)),
  add column if not exists edited_postcode text
    check (edited_postcode is null or edited_postcode ~ '^[0-9]{4}$'),
  add column if not exists edited_entity_type text
    check (edited_entity_type is null or edited_entity_type in ('for_profit', 'non_profit')),
  add column if not exists edited_login_email text
    check (edited_login_email is null or (char_length(edited_login_email) <= 200 and edited_login_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'));

-- Rollback:
--   alter table public.vp_autopilot_reviews
--     drop column if exists details, drop column if exists edited_postcode,
--     drop column if exists edited_entity_type, drop column if exists edited_login_email;
