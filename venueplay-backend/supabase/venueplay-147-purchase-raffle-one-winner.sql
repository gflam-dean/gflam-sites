-- =====================================================================
-- Migration 147: one winner per purchase raffle prize, held by the database
-- ---------------------------------------------------------------------
--   NOT RUN. Security audit 3 Nov 2026, finding M4. Branch fix/security-3nov.
--   Number checked on every branch and every worktree on 3 Nov 2026 (144 = help alerts).
--   Needs migration 115 (the purchase raffle tables).
--
--   RUN FIRST: PRECHECK-raffle-double-winners-147-READ-ONLY.sql. Expect no rows.
--
--   ORDER: any order with the game Worker. Without 147 the Worker behaves as today (the race is
--   still possible). With 147 and the old Worker, a second simultaneous draw is refused by the
--   database and the old Worker answers a generic 409 "That was already starting"; with the new
--   Worker it says "That prize has just been drawn on another screen". Recommended: run 147, then
--   deploy the game Worker from this branch. Safe to run more than once.
--   After running: dump-rls-baseline.py is not needed (an index, no policy or grant).
--
-- THE FAULT. handlePraffleDraw reads the draws, picks the first prize with no 'drawn' row, then
-- inserts. The 3 second hold is checked before the insert, not with it. Two consoles (pickup) or
-- a double tap both read "no draws yet", both pick prize 0 and both insert, so the draw record,
-- the legal record of a lottery, shows two winners for one prize. tools/test-praffle-one-winner.js
-- forces that race and shows it.
--
-- THE FIX. A partial unique index on (raffle_id, prize_index) where outcome = 'drawn'. A redraw
-- sets the old row to 'redrawn', which leaves the index, so the prize can be drawn again.
-- =====================================================================

begin;

-- Existing duplicates (expect none): keep the earliest draw per prize, mark the rest redrawn with
-- the reason, and leave an audit row each. Nothing is deleted.
with dupes as (
  select d.id, d.raffle_id, d.venue_id, d.prize_index, d.winner_name,
         row_number() over (partition by d.raffle_id, d.prize_index order by d.drawn_at, d.id) as n
    from public.vp_purchase_raffle_draws d
   where d.outcome = 'drawn'
),
fixed as (
  update public.vp_purchase_raffle_draws t
     set outcome = 'redrawn',
         redraw_reason = 'Duplicate winner recorded by a simultaneous draw; the earlier draw for this prize stands (migration 147, 3 Nov 2026).',
         redrawn_at = now(),
         redrawn_by = 'migration-147'
    from dupes
   where t.id = dupes.id and dupes.n > 1
  returning t.id, t.raffle_id, t.venue_id, t.prize_index, t.winner_name
)
insert into public.vp_admin_audit (actor_admin, actor_label, action, target, detail)
select null, 'migration-147', 'purchase_raffle_duplicate_redrawn', 'venue:' || f.venue_id,
       jsonb_build_object('raffle_id', f.raffle_id, 'draw_id', f.id, 'prize_index', f.prize_index, 'was', f.winner_name)
  from fixed f;

create unique index if not exists vp_purchase_raffle_draws_one_winner
  on public.vp_purchase_raffle_draws (raffle_id, prize_index)
  where outcome = 'drawn';

-- SELF-CHECK
do $check$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and tablename = 'vp_purchase_raffle_draws' and indexname = 'vp_purchase_raffle_draws_one_winner') then
    raise exception 'Migration 147 self-check: the one-winner index is missing';
  end if;
  if exists (select 1 from public.vp_purchase_raffle_draws where outcome = 'drawn'
              group by raffle_id, prize_index having count(*) > 1) then
    raise exception 'Migration 147 self-check: a prize still has two drawn winners';
  end if;
end;
$check$;

commit;

-- READ BACK (READ ONLY): the index exists and is partial.
--   select indexdef from pg_indexes where indexname = 'vp_purchase_raffle_draws_one_winner';
--   expect: CREATE UNIQUE INDEX ... (raffle_id, prize_index) WHERE (outcome = 'drawn'::text)

-- Rollback:
--   drop index if exists public.vp_purchase_raffle_draws_one_winner;
