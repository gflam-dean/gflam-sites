-- =====================================================================
-- 160: THE 90-DAY CLOCK FOR PROSPECTS WHO LEFT (Dean, 5 Nov 2026, INBOX item 33). NOT RUN.
--
-- privacy.html promises a closed venue's player list is deleted within 90 days. The nightly
-- retention sweep (venueplay-game.js sweepRetention) clears a venue 90 days after vp_venues.closed_at.
-- Every paid way of leaving stamps closed_at. Two prospect paths did not:
--   - a prospect who pressed "Cancel, it's not for us" (suspended_reason 'cancelled', no closed_at)
--   - a prospect paused when the free month ran out with no card (suspended_reason 'free_month_ended')
-- so their players were kept for ever. The billing Worker on fix/account-review-8nov now stamps
-- closed_at on both, clears it when a card brings a paused prospect back, and the sweep includes
-- 'free_month_ended'. This file starts the clock for the ones ALREADY in those states, from the
-- moment they left (vp_prospects.cancelled_at or paused_at), never from today, and never for a
-- venue that is back on. Nothing is deleted by this file.
--
-- ORDER: after the billing Worker and the game Worker that carry the change (either order is
-- safe: before this runs, existing prospects simply keep no clock, as today).
-- NUMBER: 152 to 154 are on other branches and tonight's Friday/Sunday agents take 155 onwards,
-- so 160 to leave room. Renumber at merge if 160 is taken.
-- =====================================================================

-- What it would touch (read first):
--   select v.id, v.name, v.suspended_reason, v.closed_at, p.paused_at, p.cancelled_at
--     from vp_venues v join vp_prospects p on p.venue_id = v.id
--    where v.status = 'suspended' and v.closed_at is null
--      and v.suspended_reason in ('free_month_ended', 'cancelled')
--      and coalesce(p.cancelled_at, p.paused_at) is not null;

update vp_venues v
   set closed_at = coalesce(p.cancelled_at, p.paused_at)
  from vp_prospects p
 where p.venue_id = v.id
   and v.status = 'suspended'
   and v.closed_at is null
   and v.suspended_reason in ('free_month_ended', 'cancelled')
   and coalesce(p.cancelled_at, p.paused_at) is not null;

-- Read back: every left prospect now has a clock, and no active venue gained one.
--   select count(*) from vp_venues where status = 'active' and closed_at is not null;   -- expect 0
--   select v.name, v.closed_at from vp_venues v join vp_prospects p on p.venue_id = v.id
--    where v.status = 'suspended' and v.suspended_reason in ('free_month_ended','cancelled');
-- Rollback (only the rows this set, which all carry closed_at equal to the prospect's own time):
--   update vp_venues v set closed_at = null from vp_prospects p
--    where p.venue_id = v.id and v.closed_at = coalesce(p.cancelled_at, p.paused_at)
--      and v.suspended_reason in ('free_month_ended','cancelled') and v.player_data_purged_at is null;
