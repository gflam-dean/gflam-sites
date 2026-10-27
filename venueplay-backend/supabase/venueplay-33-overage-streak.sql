-- =====================================================================
-- Migration 33: the busy-night streak that moves a venue up a plan
-- ---------------------------------------------------------------------
-- Dean's rule (12 Aug 2026): a venue that runs over its plan pays $2 a head
-- on the first two nights. On the THIRD CONSECUTIVE over-night they pay $1 a
-- head and their plan moves up, from their next invoice.
--
-- The new max is the SMALLEST of the three nights, not the biggest. A venue
-- capped at 10 that draws 12, 13, 15 goes to 12, because 12 is the crowd they
-- actually proved three times running. The 13 and the 15 were spikes and stay
-- as per-night overage. That is deliberately the conservative reading: we only
-- put a venue on a permanently bigger bill for players they reliably get.
--
-- Any night back inside their cap breaks the streak and it counts from zero.
-- A night with no metered players at all (a raffle or a members draw, which
-- mint no vp_players rows) is not a night either way and leaves the streak
-- untouched, or a venue that ran bingo, then a raffle, then bingo could never
-- build a streak.
--
-- Nothing recorded an over-night before this: the charge went straight to
-- Stripe and no row was written, so there was nothing to count from.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.vp_venues
  add column if not exists overage_streak integer not null default 0;

alter table public.vp_venues
  add column if not exists overage_streak_peaks jsonb not null default '[]'::jsonb;

comment on column public.vp_venues.overage_streak is
  'How many consecutive metered nights this venue has run over its plan cap. Reset to 0 by any night inside the cap. At 3 the plan moves up and this returns to 0.';

comment on column public.vp_venues.overage_streak_peaks is
  'The headcount of each night in the current streak, oldest first. The new plan max is the MINIMUM of the three, i.e. the crowd they proved every time.';

-- A venue already over its cap when this ships starts its streak from tonight,
-- which is the fair reading: we have no history to count from.
