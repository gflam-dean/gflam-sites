-- VenuePlay migration 51: save a venue's raffle setup as a weekly template.
--
-- The raffle console reset to the built-in defaults (tickets 1..150, 180s to claim, etc.) on every
-- load, so a venue running the same raffle every week had to re-enter the range, times and settings
-- each time. The game Worker now writes the setup a host uses when they start a raffle to this column,
-- and the console pre-fills from it next time. The prize LIST was already saved per venue in
-- vp_raffle_prizes; this is the rest of the setup (range, claim time, jackpot, redraw, excluded runs).
--
-- Shape (jsonb): { range_min, range_max, time_to_present, winners, allow_redraw, jackpot_on,
--                  jackpot_amount_cents, leading_zeros, excluded_ranges:[[from,to],...], prizes:[...] }
-- NULL = never set, use the built-in defaults.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venue_settings
  ADD COLUMN IF NOT EXISTS raffle_template jsonb;

COMMENT ON COLUMN public.vp_venue_settings.raffle_template IS
  'The venue''s last raffle setup, saved by the game Worker on raffle start so the console pre-fills a weekly raffle. Range, claim time, winners, redraw, jackpot, excluded ticket runs and the prize list. NULL = use the built-in defaults.';
