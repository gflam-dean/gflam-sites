-- =====================================================================
-- Migration 101: a members draw can carry a MAXIMUM jackpot, and a reserve
-- ---------------------------------------------------------------------
--   Safe to run any number of times. Run it BEFORE the game Worker that
--   reads these columns is deployed; that Worker also works without it
--   (it reads the two columns in a forgiving second trip and, when they
--   are missing, rolls the jackpot over exactly as it did before).
--
-- WHY. Anisimoff Legal, 1 Oct 2026 (ref 9380), point 10: "I strongly
-- recommend building into the platform a field that Customers can specify
-- the maximum jackpot amount before they proceed with the draws. Once a
-- jackpot is reached, the draws could continue until a winner is finally
-- selected." The same words again in the 8 Oct 2026 letter, point 6. The
-- jackpot was an unrestricted number and the software neither capped nor
-- warned. The threshold tables at the end of both letters are what the
-- host console shows beside this field (NSW free lottery $30,000, ACT
-- exempt lottery $2,500, and so on); the figure itself is the VENUE's
-- choice, because the venue is the conductor and we are not.
--
-- THE RESERVE. Dean's own proposal, put to the lawyer in the same point
-- and not objected to: once the jackpot sits at its maximum, each week's
-- increment is kept to one side instead of being lost, and seeds the next
-- jackpot after a win (never above the maximum; what does not fit stays in
-- reserve). The reserve is the venue's prize pool for this draw. If the
-- draw is closed the venue decides what happens to it, under its own terms
-- with its members; VenuePlay holds no money and never did.
--
-- WHAT CHANGES.
--   vp_member_draws.max_jackpot_cents  int, NULL = no maximum (today's behaviour)
--   vp_member_draws.reserve_cents      int, not null, default 0
-- Nothing else. No RLS change: both ride on vp_member_draws, whose policies
-- already scope the row to its venue, and every write goes through the game
-- Worker (POST /host/members/settings and /host/members/draw/resolve) with
-- the service role.
--
-- CHECK AFTERWARDS (read-only):
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'vp_member_draws'
--      and column_name in ('max_jackpot_cents', 'reserve_cents');
--   -> two rows: max_jackpot_cents integer, nullable; reserve_cents integer, default 0, not null
--
-- ROLLBACK:
--   alter table public.vp_member_draws drop column if exists max_jackpot_cents;
--   alter table public.vp_member_draws drop column if exists reserve_cents;
-- =====================================================================

alter table public.vp_member_draws
  add column if not exists max_jackpot_cents integer
    constraint vp_member_draws_max_jackpot_cents_check check (max_jackpot_cents is null or max_jackpot_cents >= 0);

alter table public.vp_member_draws
  add column if not exists reserve_cents integer not null default 0
    constraint vp_member_draws_reserve_cents_check check (reserve_cents >= 0);

comment on column public.vp_member_draws.max_jackpot_cents is
  'The most this draw''s jackpot may reach, in cents. NULL = no maximum. Set by the venue (owner or manager) on the members host console; the Worker refuses a current jackpot above it and stops a rollover at it. Anisimoff Legal 1 Oct 2026 point 10 and 8 Oct 2026 point 6: a customer-set maximum jackpot, enforced before the draws, with the draw continuing until won.';

comment on column public.vp_member_draws.reserve_cents is
  'Weekly increments that could not be added to the jackpot because it sat at max_jackpot_cents, in cents. Seeds the next jackpot after a claim (starting amount plus reserve, never above the maximum; the rest stays here). The venue''s prize pool for this draw: if the draw is closed the venue decides what happens to it under its own terms. VenuePlay holds no money.';
