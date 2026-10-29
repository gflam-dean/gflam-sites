-- =====================================================================
-- Migration 127: a prospect's free month, its card reminders, the pause
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Needs migration 125
--   (vp_prospects). Run it BEFORE deploying the billing Worker that
--   carries /account/prospect-start, /account/card-choice and
--   /prospect/cancel. Either order is safe: without these columns the
--   Worker answers as it did before (the free month starts when a card is
--   added, no reminders go, nothing is paused) and HQ is told.
--   No new table, no new grant: vp_prospects stays service role only, so
--   RLS-BASELINE.json does not change.
--
-- WHY. Dean, 29 Oct 2026: a prospect's free month starts the FIRST TIME
-- THEY SIGN IN, not when HQ sets them up. While there is no card they get
-- a reminder on day 3, then weekly (10, 17, 24), then each of the last
-- three days (28, 29, 30), 8am to 5pm Monday to Friday Brisbane. With no
-- card at the end, the account PAUSES (status suspended, reason
-- free_month_ended: games off, the TV keeps its ads) and the offer price
-- they were set up on goes: a card added after the pause is at the price
-- of that day. A card or a cancel stops it all.
--
--   first_signin_at     the first time anyone at the venue signed in
--   free_month_ends_at  11:59:59pm Brisbane on the 30th day after that
--   offer_rate          the per-player price open when they were set up
--                       (2.50 in an offer month), kept until they pause
--   card_choice / _at   'now' or 'later' at the first-run card step
--   reminders_sent      the reminder days already sent, e.g. [3,10]
--   paused_at           when the free month ran out with no card
--   cancelled_at        "Cancel, it's not for us"
-- =====================================================================

alter table public.vp_prospects add column if not exists first_signin_at    timestamptz;
alter table public.vp_prospects add column if not exists free_month_ends_at timestamptz;
alter table public.vp_prospects add column if not exists offer_rate         numeric(6,2)
  check (offer_rate is null or (offer_rate > 0 and offer_rate < 100));
alter table public.vp_prospects add column if not exists card_choice        text
  check (card_choice is null or card_choice in ('now', 'later'));
alter table public.vp_prospects add column if not exists card_choice_at     timestamptz;
alter table public.vp_prospects add column if not exists reminders_sent     jsonb not null default '[]'::jsonb;
alter table public.vp_prospects add column if not exists paused_at          timestamptz;
alter table public.vp_prospects add column if not exists cancelled_at       timestamptz;

create index if not exists vp_prospects_free_month_idx on public.vp_prospects (free_month_ends_at)
  where paused_at is null and cancelled_at is null;

-- Rollback:
--   alter table public.vp_prospects drop column if exists first_signin_at, drop column if exists free_month_ends_at,
--     drop column if exists offer_rate, drop column if exists card_choice, drop column if exists card_choice_at,
--     drop column if exists reminders_sent, drop column if exists paused_at, drop column if exists cancelled_at;
