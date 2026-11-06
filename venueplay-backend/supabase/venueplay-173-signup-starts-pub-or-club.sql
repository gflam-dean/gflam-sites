-- =====================================================================
-- Migration 173: pub or club on a no-card sign-up (vp_signup_starts.entity_type)
-- ---------------------------------------------------------------------
-- Dean, 6 Nov 2026 (reverses "do not ask pub or club at the start"): the
-- no-card start asks pub or club with the venue details, so a club has
-- bingo, raffles and members draws open without HQ. The answer goes on the
-- VENUE as entity_type (the column the VPPermits cards and the gaming rules
-- already read) when the account is made. This column keeps it on the
-- sign-up row too, for a sign-up HQ approves later (a mobile or email
-- already on venueplay is held for HQ).
--
-- ONE nullable column, nothing else. 170 and 171 are unchanged. Before this
-- runs the start still works: the page sends the answer again with the
-- code, and an HQ approval with no answer makes a pub (the stricter rules),
-- which HQ can change.
--
-- NUMBER: 172 is the try-it demo's (fix/try-demo-10nov), so 173. Branch
-- fix/signup-core-10nov. NOT RUN. Run AFTER 170.
-- =====================================================================

alter table public.vp_signup_starts add column if not exists entity_type text
  check (entity_type is null or entity_type in ('for_profit', 'non_profit'));

comment on column public.vp_signup_starts.entity_type is
  'Pub (for_profit) or club (non_profit), as chosen on the no-card start. Migration 173.';

-- Read back (read-only):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'vp_signup_starts' and column_name = 'entity_type';
--   expects one row: text, YES.

-- Rollback:
--   alter table public.vp_signup_starts drop column if exists entity_type;
