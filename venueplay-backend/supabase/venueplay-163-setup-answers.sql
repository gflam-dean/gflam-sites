-- VenuePlay migration 163: what a new venue tells the setup wizard, kept on the venue.
--
-- Dean, 5 Nov 2026 (INBOX 44a, 46): the first sign-in guide is a setup wizard that ASKS first: how many TVs,
-- which nights the venue runs games, which games it plays (trivia, musical bingo, bingo, raffles, members
-- draws). Later sign-ins may ask ONE more short question. The Account page shows the answers ("About your
-- venue", Game settings tab) and the guide points at the right pages for the games chosen.
--
-- ONE column, nothing else: vp_venue_settings.setup_answers jsonb, an object, at most 2,000 characters:
--   { "tvs": "1".."4" ("4" means four or more), "nights": ["mon".."sun"], "games": ["trivia","musical","bingo",
--     "raffles","members"], "name_ok": true }
-- The page writes it with its own VP.saveSettings (an upsert on vp_venue_settings), which the existing owner and
-- manager insert and update policies (migration 77) already allow, so there is NO new policy, grant or function
-- and RLS-BASELINE.json does not change. The owner-only trigger (migration 77) leaves this column alone, so a
-- manager can save it too. The page keeps only the known keys with only the known values.
--
-- Either order with the site: before this runs the wizard still works and keeps every answer on the device it is
-- used on (localStorage), the save is refused by the database and the page says nothing; the Account page card
-- reads the column and shows nothing until it exists. NOT RUN. Rollback at the bottom.
-- Safe to run more than once.

ALTER TABLE public.vp_venue_settings
  ADD COLUMN IF NOT EXISTS setup_answers jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_venue_settings_setup_answers_shape') THEN
    ALTER TABLE public.vp_venue_settings
      ADD CONSTRAINT vp_venue_settings_setup_answers_shape
      CHECK (jsonb_typeof(setup_answers) = 'object' AND length(setup_answers::text) <= 2000);
  END IF;
END $$;

COMMENT ON COLUMN public.vp_venue_settings.setup_answers IS
  'What the venue told the setup wizard: tvs, nights, games, name_ok. Written by the page through VP.saveSettings (owner or manager), read by the guide and the Account page.';

-- Check after running (read-only):
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--    where table_name = 'vp_venue_settings' and column_name = 'setup_answers';
--
-- Rollback:
--   ALTER TABLE public.vp_venue_settings DROP CONSTRAINT IF EXISTS vp_venue_settings_setup_answers_shape;
--   ALTER TABLE public.vp_venue_settings DROP COLUMN IF EXISTS setup_answers;
