-- =====================================================================
-- Migration 84: the clock the 90-day deletion promise never had
-- ---------------------------------------------------------------------
-- privacy.html says, in writing, to every venue and every player:
--
--   "When a venue's account is closed, its player list is deleted within
--    90 days, other than anything we have to keep for tax or legal
--    record-keeping."
--
-- Nothing anywhere deleted anything. Not a cron, not a sweep, not a hand
-- procedure. Found by audit 17 Sep 2026.
--
-- And it could not have been written, because there was no way to know WHEN a
-- venue closed. vp_venues records status and suspended_reason and not one
-- timestamp for the moment either changed. Ninety days from what?
--
-- So this adds the clock. The purge that reads it lives in the nightly cron on
-- venueplay-game, which already runs and is proven.
--
-- WHY NULLING AND NOT DELETING (this is what the Worker does, recorded here so
-- the two stay in step). The rows stay; the personal columns are emptied. A
-- vp_players row is also a METERED row: it is what the venue was billed on, and
-- deleting it would quietly rewrite their invoice history. The promise itself
-- carves this out with "other than anything we have to keep for tax or legal
-- record-keeping". So a purged player keeps their row, their session and their
-- join time, and loses their name, email, mobile, postcode and opt-in.
-- =====================================================================

alter table vp_venues add column if not exists closed_at timestamptz;

-- And the record that we kept the promise, which has to be its own column. Clearing closed_at
-- after a purge would destroy the only note of when the venue closed, and would leave a
-- suspended venue with closed_at null, which is precisely the state the backfill below reads as
-- "needs a clock": re-running this file would start the ninety days again.
alter table vp_venues add column if not exists player_data_purged_at timestamptz;

comment on column vp_venues.player_data_purged_at is
  'When the nightly retention sweep cleared this venue''s player contact details, 90 days after closed_at. Null means it has not been done. Set once and never cleared: it is the evidence the promise in privacy.html was kept.';

comment on column vp_venues.closed_at is
  'When this venue stopped being an active account (cancelled, ended or archived). Null while it is live. Starts the 90-day clock on deleting its player contact details, which is promised in privacy.html. Cleared when a venue comes back.';

-- The purge asks "closed before X" every night, on every venue, forever.
create index if not exists vp_venues_closed_at_idx on vp_venues (closed_at)
  where closed_at is not null;

-- ---------------------------------------------------------------------
-- BACKFILL, and it is deliberately NOT retrospective.
--
-- Five venues are already suspended and nothing recorded when. Two choices, and
-- both are wrong in one direction:
--
--   leave closed_at null  -> they are never purged, and we go on breaking the
--                            promise for exactly the venues it is about
--   set it to their real  -> we do not have it. Inventing one and dating it
--   closing date             months back would delete real data TONIGHT on a
--                            guess, with no way to undo it
--
-- So the clock starts NOW for them. They get their ninety days from today
-- rather than from a date nobody wrote down. Slower than the promise for these
-- five, and the only version that cannot destroy something on an assumption.
-- ---------------------------------------------------------------------
update vp_venues
   set closed_at = now()
 where closed_at is null
   and player_data_purged_at is null      -- already done: do not start a second clock
   and status = 'suspended'
   and suspended_reason in ('ended', 'cancelled', 'archived', 'archived_cancelling');

-- =====================================================================
-- PROVE IT. Read these three and they should say: the column exists, five
-- venues have a clock running, and no LIVE venue has one.
-- =====================================================================
--
-- select count(*) as venues_with_a_clock from vp_venues where closed_at is not null;
--
-- select name, status, suspended_reason, closed_at,
--        (closed_at + interval '90 days')::date as player_data_goes_on
--   from vp_venues where closed_at is not null order by closed_at;
--
-- -- MUST be zero. A live venue with a clock running is data about to be
-- -- deleted underneath a paying customer.
-- select count(*) as live_venues_wrongly_clocked
--   from vp_venues where closed_at is not null and status = 'active';
