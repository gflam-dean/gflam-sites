-- venueplay-74-members-draw-pending.sql
-- Run this BEFORE deploying the game Worker build that goes with it.
--
-- WHY: the Worker stamps last_drawn_date at DRAW time, but wrote no record until the
-- host resolved the draw. So a draw whose reply was lost on bad wifi left nothing
-- behind at all: the date said "drawn tonight", the console said "already drawn", and
-- no row anywhere said who had been drawn. The jackpot sat neither paid nor rolled over.
--
-- Adding a third outcome lets the row be written the moment the winner is picked and
-- finished at resolve, so one draw is one row. 'drawn' means UNRESOLVED: every report
-- must filter it out or label it. v_vp_prizes_given already totals only 'claimed' rows,
-- so the "prizes given away" figure is unaffected by this.
--
-- Safe to run twice. The Worker forgives its absence (the insert is refused, caught, and
-- the draw behaves exactly as it did before), so the order of the two is not critical,
-- but this first is the tidy way round.

alter table public.vp_member_draw_results
  drop constraint if exists vp_member_draw_results_outcome_check;

alter table public.vp_member_draw_results
  add constraint vp_member_draw_results_outcome_check
  check (outcome in ('claimed','jackpot_rolled','drawn'));

-- The pending lookup runs on every draw. drawn_at is this table's timestamp column;
-- it has NO created_at, and PostgREST rejects the whole select when a name is unknown.
create index if not exists vp_member_draw_results_open_idx
  on public.vp_member_draw_results (draw_id, drawn_at desc)
  where outcome = 'drawn';
