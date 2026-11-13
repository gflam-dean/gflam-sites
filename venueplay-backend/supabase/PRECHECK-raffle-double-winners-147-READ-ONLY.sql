-- =====================================================================
-- PRE-CHECK FOR MIGRATION 147 (READ ONLY: nothing here writes anything)
-- ---------------------------------------------------------------------
-- Security audit 3 Nov 2026, finding M4. Has any purchase raffle prize ever been recorded with
-- two winners (two rows with outcome 'drawn' for the same raffle and prize)?
--
-- Expect NO ROWS. If there are rows: migration 147 keeps the EARLIEST draw for that prize as the
-- winner and marks every later one 'redrawn' with the reason "Duplicate winner recorded by a
-- simultaneous draw", so the unique index can be built. Nothing is deleted; every row stays on the
-- draw record. If the venue actually gave the prize to a LATER person, fix that row by hand first
-- (or tell Claude which one), before running 147.
-- =====================================================================

select d.raffle_id,
       r.name                                   as raffle,
       v.name                                   as venue,
       d.prize_index,
       d.prize_text,
       d.id                                     as draw_id,
       d.winner_name,
       d.phone_last3,
       d.drawn_at,
       d.drawn_by_name,
       case when row_number() over (partition by d.raffle_id, d.prize_index
                                    order by d.drawn_at, d.id) = 1
            then 'KEPT as the winner' else 'would be marked redrawn' end as what_147_does
  from public.vp_purchase_raffle_draws d
  join public.vp_purchase_raffles r on r.id = d.raffle_id
  join public.vp_venues v on v.id = d.venue_id
 where d.outcome = 'drawn'
   and (d.raffle_id, d.prize_index) in (
         select raffle_id, prize_index
           from public.vp_purchase_raffle_draws
          where outcome = 'drawn'
          group by raffle_id, prize_index
         having count(*) > 1)
 order by d.raffle_id, d.prize_index, d.drawn_at, d.id;
