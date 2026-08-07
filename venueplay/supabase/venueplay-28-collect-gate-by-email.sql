-- VenuePlay migration 28: gate marketing collection on the ACCOUNT EMAIL, not the venue name.
-- Supersedes migration 21's name-based auto-approve. Safe to run more than once.
--
-- WHY: the venue name is self-typed and gameable (anyone can type "Fake Tavern" and auto-unlock
-- collection). Dean's rule: a real venue is recognised by its CONTACT EMAIL looking like a venue
-- (info@theroyalhotel..., bookings@sandsrsl...). Anything else - a trivia host on gmail, a personal
-- brand like "Hoads Haus of Fun" - stays collect-OFF (name/team-name only, no player data) until an
-- admin sets optin_release_approved = true. A signup with a non-venue email is also flagged to Dean
-- by email at signup (worker venueplay-api-FULL.js). This only REPLACES the trigger function; the
-- trigger from migration 21 keeps calling it. See memory venueplay-optin-gate.

CREATE OR REPLACE FUNCTION vp_gate_marketing_collect() RETURNS trigger AS $$
DECLARE fid uuid; cemail text; approved boolean;
BEGIN
  SELECT founding_id INTO fid FROM vp_venues WHERE id = NEW.venue_id;
  IF fid IS NULL THEN
    RETURN NEW;   -- operator-group venue (Gflam-created): not gated here
  END IF;
  SELECT optin_release_approved, contact_email INTO approved, cemail FROM venueplay_founding WHERE id = fid;
  -- Auto-approve only when the CONTACT EMAIL looks like a venue (substring; domains concatenate,
  -- e.g. sandsrsl.com). Otherwise it stays locked until an admin approves.
  IF approved IS NOT TRUE
     AND COALESCE(cemail, '') ~* '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality)' THEN
    approved := true;
  END IF;
  IF approved IS NOT TRUE THEN
    NEW.collect_email := false;
    NEW.collect_mobile := false;
    NEW.collect_postcode := false;
    NEW.collect_marketing_optin := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-assert the trigger in case migration 21 was never run on this database.
DROP TRIGGER IF EXISTS vp_venue_settings_gate ON vp_venue_settings;
CREATE TRIGGER vp_venue_settings_gate
  BEFORE INSERT OR UPDATE ON vp_venue_settings
  FOR EACH ROW EXECUTE FUNCTION vp_gate_marketing_collect();
