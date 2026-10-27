-- VenuePlay migration 50: remember a venue's trivia round settings.
--
-- The trivia console used to reset to the built-in defaults (30s per question, 100 base points,
-- speed bonus on) on every load, so a host who liked a slower round or different points had to set
-- it again every single night. The game Worker now writes the settings a host uses when they start
-- a trivia game to these columns, and the console pre-fills from them next time.
--
-- NULL means "never set, use the built-in default". The questions themselves are already saved as a
-- per-venue set, and asked questions are remembered in vp_asked_questions; this is only the round
-- settings.
--
-- Safe to run more than once.

ALTER TABLE public.vp_venue_settings
  ADD COLUMN IF NOT EXISTS trivia_time_limit_s int,
  ADD COLUMN IF NOT EXISTS trivia_base_points  int,
  ADD COLUMN IF NOT EXISTS trivia_speed_bonus  boolean;

COMMENT ON COLUMN public.vp_venue_settings.trivia_time_limit_s IS
  'Seconds per question the venue last used (3..300). NULL = use the built-in default (30). Written by the game Worker on trivia game start; the console pre-fills from it.';
COMMENT ON COLUMN public.vp_venue_settings.trivia_base_points IS
  'Base points per correct answer the venue last used (0..100000). NULL = built-in default (100).';
COMMENT ON COLUMN public.vp_venue_settings.trivia_speed_bonus IS
  'Whether the speed bonus was on the last time the venue ran trivia. NULL = built-in default (on).';
