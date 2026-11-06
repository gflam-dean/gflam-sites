-- VenuePlay migration 174: which consent words a player agreed to, kept with the opt-in.
--
-- NOT RUN. Safe to run more than once. Either order with the game Worker: until this runs, /join/list (the "Get a heads
-- up by email" sign-up on the phone with no game on, Dean 6 Nov 2026) stores the sign-up WITHOUT the version rather than
-- losing it; after it runs, the version is kept.
--
-- The phones already send consent_version with the "Send me offers from {venue}. I'm 18 or over." tick
-- (/app/vp-consent.js, VPConsent.VERSION), and nothing kept it. Two columns, nothing else:
--   vp_players.consent_version    the words a player ticked, on the opt-in a joined player gives (and /join/list updates)
--   vp_captures.consent_version   the same on a sign-up that is not tied to a player row
-- At most 20 characters. No new policy, grant or function: both tables stay Worker-only (service role), so
-- RLS-BASELINE.json does not change.

ALTER TABLE public.vp_players  ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE public.vp_captures ADD COLUMN IF NOT EXISTS consent_version text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_players_consent_version_len') THEN
    ALTER TABLE public.vp_players ADD CONSTRAINT vp_players_consent_version_len
      CHECK (consent_version IS NULL OR char_length(consent_version) BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vp_captures_consent_version_len') THEN
    ALTER TABLE public.vp_captures ADD CONSTRAINT vp_captures_consent_version_len
      CHECK (consent_version IS NULL OR char_length(consent_version) BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN public.vp_players.consent_version IS
  'The version of the offers + 18+ consent words (VPConsent.VERSION) the player ticked. Written by the game Worker only.';
COMMENT ON COLUMN public.vp_captures.consent_version IS
  'The version of the offers + 18+ consent words (VPConsent.VERSION) ticked on a sign-up with no player row (/join/list). Worker only.';

-- Check after running (read-only):
--   select table_name, column_name from information_schema.columns
--    where column_name = 'consent_version' and table_name in ('vp_players','vp_captures');
--
-- Rollback:
--   ALTER TABLE public.vp_players  DROP COLUMN IF EXISTS consent_version;
--   ALTER TABLE public.vp_captures DROP COLUMN IF EXISTS consent_version;
