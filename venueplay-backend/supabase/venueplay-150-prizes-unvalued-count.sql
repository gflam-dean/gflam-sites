-- =====================================================================
-- Migration 150: count the prizes that were given with no dollar value
-- NOT RUN. Written 3 Nov 2026 on fix/console-hq-5nov for Dean to run.
-- ---------------------------------------------------------------------
-- Dean, 3 Nov 2026: the account page said "$800 given away in prizes", which
-- left things out. A raffle prize typed with no value (a meat tray, a voucher
-- with no amount) never reached v_vp_prizes_given at all: its WHERE only takes
-- a raffle win with a value or a cash jackpot. So the venue gave it away and
-- the page could not even count it.
--
-- This adds ONE column at the end, unvalued_given_count: raffle wins that were
-- drawn (not void, not a no-show) with no value and no jackpot. They are
-- COUNTED and never priced. Every existing column is unchanged, row for row:
-- the first CTE is the view's own definition as it is live today (read back
-- with pg_get_viewdef on 3 Nov 2026), and the new rows carry is_valued = false
-- and a value of 0, and are left out of every existing count and sum.
--
-- The account page (venueplay/app/billing.html, prizeTallyLines) reads the new
-- column when it is there and says "not counted here" when it is not, so the
-- page can go up before or after this. Nothing else reads it.
--
-- Safe to run twice. create or replace view may only ADD columns at the end,
-- which is all this does. security_invoker is set again explicitly (migration
-- 85's rule: the authenticated grant is only safe with it), and the grants are
-- put back the way 85 left them.
-- =====================================================================

create or replace view public.v_vp_prizes_given
with (security_invoker = on) as
 with prizes as (
         select md.venue_id,
            coalesce(mdr.amount_cents, 0) as prize_value_cents,
            true as is_cash,
            true as is_valued
           from vp_member_draw_results mdr
             join vp_member_draws md on md.id = mdr.draw_id
          where mdr.outcome = 'claimed'::text
        union all
         select se.venue_id,
            coalesce(rr.prize_value_cents,
                case
                    when rg.jackpot_on then rg.jackpot_amount_cents
                    else 0
                end, 0) as prize_value_cents,
            coalesce(rr.prize_type = 'cash'::text or rr.prize_type is null and rg.jackpot_on, false) as is_cash,
            true as is_valued
           from vp_raffle_results rr
             join vp_games gm on gm.id = rr.game_id
             join vp_sessions se on se.id = gm.session_id
             join vp_raffle_games rg on rg.game_id = rr.game_id
          where rr.outcome <> 'no_show'::text and rr.status <> 'void'::text
            and (rr.prize_value_cents is not null or rg.jackpot_on and rg.jackpot_amount_cents is not null)
        union all
         -- NEW: a raffle win given with no value typed and no jackpot (a meat tray). Counted, never priced.
         select se.venue_id,
            0 as prize_value_cents,
            false as is_cash,
            false as is_valued
           from vp_raffle_results rr
             join vp_games gm on gm.id = rr.game_id
             join vp_sessions se on se.id = gm.session_id
             join vp_raffle_games rg on rg.game_id = rr.game_id
          where rr.outcome <> 'no_show'::text and rr.status <> 'void'::text
            and rr.prize_value_cents is null
            and not (rg.jackpot_on and rg.jackpot_amount_cents is not null)
        )
 select venue_id,
    count(*) filter (where is_valued) as prizes_given_count,
    coalesce(sum(prize_value_cents) filter (where is_valued), 0::bigint) as prizes_given_value_cents,
    count(*) filter (where is_valued and is_cash) as cash_given_count,
    coalesce(sum(prize_value_cents) filter (where is_valued and is_cash), 0::bigint) as cash_given_value_cents,
    count(*) filter (where not is_valued) as unvalued_given_count
   from prizes
  group by grouping sets ((venue_id), ());

alter view public.v_vp_prizes_given set (security_invoker = on);
grant select on public.v_vp_prizes_given to authenticated;
revoke all on public.v_vp_prizes_given from anon;

notify pgrst, 'reload schema';

-- =====================================================================
-- READ IT BACK (read only), after running:
--
-- 1. The new column is there, last:
--   select column_name from information_schema.columns
--    where table_name = 'v_vp_prizes_given' order by ordinal_position;
--   -> venue_id, prizes_given_count, prizes_given_value_cents, cash_given_count,
--      cash_given_value_cents, unvalued_given_count
--
-- 2. Still security_invoker, still authenticated only:
--   select reloptions from pg_class where relname = 'v_vp_prizes_given';      -> {security_invoker=on}
--   select grantee from information_schema.role_table_grants
--    where table_name = 'v_vp_prizes_given' and privilege_type = 'SELECT';   -> authenticated (no anon)
--
-- 3. The figures a venue already saw did not move (compare with a copy taken
--    BEFORE running; every existing column must match row for row):
--   select venue_id, prizes_given_count, prizes_given_value_cents,
--          cash_given_count, cash_given_value_cents, unvalued_given_count
--     from v_vp_prizes_given order by venue_id nulls last;
-- =====================================================================
