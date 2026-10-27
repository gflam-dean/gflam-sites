-- =====================================================================
-- Migration 83: a venue added to a paying account gets its first month free
-- ---------------------------------------------------------------------
-- Dean, 17 September 2026: "If I sign up as a group and then I add another
-- venue but I'm now paying because my trial was over that venue should still
-- get a month free right?"
--
-- It did not. A venue added while the account was still inside its own free
-- month rode that month for nothing, because vpbAdjustPlayerBilling returns
-- null while the Stripe subscription is 'trialing'. But a venue added by a
-- PAYING account was charged a full month the instant the owner clicked Add,
-- and on an annual account pro rata to the renewal date. So the single most
-- valuable thing a group can do, put us in the rest of their pubs, cost them
-- money on the day they decided to do it.
--
-- The Worker now hands that month straight back as a customer balance credit.
-- These two columns are the record of it: they are what stops the same venue
-- being credited twice, and what lets HQ see what has been given away.
--
-- WHY A CREDIT AND NOT A TRIAL. trial_end belongs to the SUBSCRIPTION, and one
-- subscription covers every venue on the account. Trialling the new venue would
-- stop billing the venues already being paid for. A credit is per-account money
-- the next invoice consumes, which is exactly one venue-month of value.
--
-- Safe to run more than once, and it touches no existing data.
-- =====================================================================

alter table vp_venues add column if not exists free_month_at    timestamptz;
alter table vp_venues add column if not exists free_month_cents integer;

comment on column vp_venues.free_month_at is
  'When this venue was granted its first month free as a Stripe customer balance credit (added to a paying account). Null means never granted. Set by vpbAddVenue.';
comment on column vp_venues.free_month_cents is
  'The size of that credit in cents, players x their per-player rate. Recorded so HQ can see what has been given away.';

-- Find them: what has been credited, and to whom.
-- select v.name, v.free_month_at, (v.free_month_cents / 100.0) as dollars, f.venue_name as account
--   from vp_venues v join venueplay_founding f on f.id = v.founding_id
--  where v.free_month_at is not null
--  order by v.free_month_at desc;
