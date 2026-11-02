-- =====================================================================
-- Migration 148: the "Get photos from their socials" button on the
-- prospect review (decision 'photos' on vp_autopilot_reviews)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the
--   billing Worker is safe: before this runs, the table refuses decision
--   'photos', and the Worker's page says "not switched on yet" and records
--   nothing (the Yes / Edit / No buttons work exactly as before). After it
--   runs, the photos button records like the others.
--   No new table, column, policy or grant: RLS-BASELINE.json does not change.
--
-- WHY. Dean, 3 Nov 2026: when a prospect's TV slides come back with no real
-- photos (the slide maker falls back to drawn icons: a plate, a clock, a
-- guitar, a glass; Pause Bar), "escalate it to social media", with a button.
-- The review email and page carry a fourth signed link, "Get photos from
-- their socials". The Worker records the tap here, once per round, like Yes,
-- Edit and No. The Mac (~/venue-enrich/prospect-autopilot.py) fetches it,
-- HOLDS the reply (it never goes), writes a job for Claude to pick the
-- venue's own photos from their Facebook or Instagram, rebuilds the slides
-- and emails Dean the review again in a new round.
--
-- WHAT CHANGES. Only the check on `decision` (created inline by migration
-- 128, so Postgres named it vp_autopilot_reviews_decision_check): it now
-- also allows 'photos'. applied_result is unchanged (the Mac marks a photos
-- tap 'held').
-- =====================================================================

alter table public.vp_autopilot_reviews
  drop constraint if exists vp_autopilot_reviews_decision_check;
alter table public.vp_autopilot_reviews
  add constraint vp_autopilot_reviews_decision_check
  check (decision is null or decision in ('yes', 'no', 'edit', 'photos'));

-- Read back (expect the constraint with 'photos' in it):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'vp_autopilot_reviews_decision_check';

-- Rollback (only once no row has decision 'photos'; clear or re-decide those first):
--   alter table public.vp_autopilot_reviews drop constraint if exists vp_autopilot_reviews_decision_check;
--   alter table public.vp_autopilot_reviews add constraint vp_autopilot_reviews_decision_check
--     check (decision is null or decision in ('yes', 'no', 'edit'));
