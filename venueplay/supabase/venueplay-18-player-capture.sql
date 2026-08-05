-- VenuePlay migration 18: capture optional player details at join.
-- Safe to run more than once.
--
-- When a venue turns on any of the collect_* settings, the join screen asks the player for
-- those details and they land here on the player row. The marketing opt-in is only ever true
-- if the player ticked it themselves (never pre-ticked); marketing_optin_at stamps the consent.
-- The owner's opt-in export reads these, strictly scoped to the owner's own venues.

ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS postcode text;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS marketing_optin boolean;
ALTER TABLE vp_players ADD COLUMN IF NOT EXISTS marketing_optin_at timestamptz;
