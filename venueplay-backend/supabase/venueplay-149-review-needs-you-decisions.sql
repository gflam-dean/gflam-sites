-- =====================================================================
-- Migration 149: Stop / Draft / Ignore on a reply that needs Dean
-- (decisions 'stop', 'draft', 'ignore' on vp_autopilot_reviews)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the
--   billing Worker is safe: before this runs, the table refuses the three
--   new decisions, the Worker's page says "not switched on yet" and records
--   nothing, and Yes / Edit / No work exactly as before. After it runs, the
--   three buttons record like the others.
--   No new table, column, policy or grant: RLS-BASELINE.json does not change.
--
-- WHY. Dean, 3 Nov 2026, on the plain "Instantly: 1 reply need you" email
-- about a wine company's help desk auto-reply: "Has no options that help."
-- A reply the Mac cannot sort now comes to Dean as its own email with three
-- signed links (a row of class 'needs you', folder needsyou-...):
-- "Stop them (not a venue)", "Draft me a reply", "Ignore". The Worker records
-- the tap here, once per round. The Mac (~/venue-enrich/prospect-autopilot.py)
-- applies it: Stop writes a job for Fable (only Fable touches the Instantly
-- campaigns), Draft prepares a reply and sends Dean the usual Yes / Edit / No
-- review, Ignore marks it handled.
--
-- WHAT CHANGES. Only the check on `decision` (created inline by migration
-- 128, so Postgres named it vp_autopilot_reviews_decision_check). It keeps
-- 'photos' (migration 148, branch feature/social-photos-3nov) so the two can
-- run in either order. BUT running 148 AFTER this one would drop the three new
-- values again: run 148 first, then 149 (or run 149 again after 148).
-- applied_result is unchanged (the Mac marks Stop and Ignore 'rejected',
-- Draft 'queued').
-- =====================================================================

alter table public.vp_autopilot_reviews
  drop constraint if exists vp_autopilot_reviews_decision_check;
alter table public.vp_autopilot_reviews
  add constraint vp_autopilot_reviews_decision_check
  check (decision is null or decision in ('yes', 'no', 'edit', 'photos', 'stop', 'draft', 'ignore'));

-- Read back (expect the constraint with 'stop', 'draft' and 'ignore' in it):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'vp_autopilot_reviews_decision_check';

-- Rollback (only once no row has decision stop, draft or ignore; clear or re-decide those first):
--   alter table public.vp_autopilot_reviews drop constraint if exists vp_autopilot_reviews_decision_check;
--   alter table public.vp_autopilot_reviews add constraint vp_autopilot_reviews_decision_check
--     check (decision is null or decision in ('yes', 'no', 'edit', 'photos'));
