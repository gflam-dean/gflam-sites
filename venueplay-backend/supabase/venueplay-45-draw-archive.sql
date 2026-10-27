-- =====================================================================
-- Migration 45: let a venue remove a members draw it no longer runs
-- ---------------------------------------------------------------------
-- WHY
--
-- A club can add a second draw ("+ Add another draw") but has never been
-- able to remove one. Set one up by mistake, or run a Sunday draw that
-- stops after summer, and it sits in the picker forever. Found in the
-- pre-launch audit on 19 Aug 2026, alongside the raffle routine and draw
-- night that could be set but not unset.
--
-- WHY NOT JUST DELETE THE ROW
--
-- vp_member_draw_results holds who won, and when, and what they won. That
-- is the record a club reaches for when a member disputes a draw months
-- later, and deleting the draw would take it with them. So removing a draw
-- ARCHIVES it: gone from every picker and off the TV, history intact.
--
-- The TV needs no change. Archiving also clears draw_day and draw_time,
-- and v_vp_screen_draws already shows only draws that have a day set, so
-- an archived draw drops off the advertising loop on its own.
-- =====================================================================

alter table vp_member_draws
  add column if not exists archived_at timestamptz;

comment on column vp_member_draws.archived_at is
  'Set when a venue removes this draw. NULL = a live draw, shown in the pickers and on the TV. Non-null = removed: hidden everywhere, but its rows in vp_member_draw_results are kept so past winners can still be looked up. Nothing un-archives from the product; clear this column by hand if a venue asks for one back.';

-- Everything that lists a venue's draws filters on archived_at is null, so
-- this index is the one the product actually uses.
create index if not exists vp_member_draws_live_idx
  on vp_member_draws (venue_id) where archived_at is null;

-- Which draws would disappear if you archived them today (should be none yet):
--   select id, name, draw_day, archived_at from vp_member_draws where archived_at is not null;
