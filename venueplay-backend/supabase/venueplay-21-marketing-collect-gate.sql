-- VenuePlay migration 21: only approved accounts may COLLECT marketing data.
-- Safe to run more than once. Requires migration 08 (collect_* columns) and 20 (approval flag).
--
-- New model (Dean 2026-08-05): we do NOT hold a venue's data for later. An unapproved account
-- (e.g. a trivia host running games at venues it doesn't own) can only ever collect FIRST and
-- LAST NAME for the game, and choose how names show. It can never turn on email / mobile /
-- postcode / marketing opt-in, so there is simply no marketing data to take. A real venue is
-- approved automatically by its name (Hotel, Tavern, RSL, Club, Pub, Bowls, etc.); anything else
-- stays off until an admin sets optin_release_approved = true (approve at sign-up, before they
-- collect anything).
--
-- This is a BEFORE trigger that only FORCES the four marketing flags off; it never raises an
-- error, so it can never block a settings save. Venues on a negotiated operator group
-- (founding_id NULL) are Gflam-created and are not gated here.

CREATE OR REPLACE FUNCTION vp_gate_marketing_collect() RETURNS trigger AS $$
DECLARE fid uuid; vname text; approved boolean;
BEGIN
  SELECT founding_id, name INTO fid, vname FROM vp_venues WHERE id = NEW.venue_id;
  IF fid IS NULL THEN
    RETURN NEW;   -- operator-group venue: not gated here
  END IF;
  SELECT optin_release_approved INTO approved FROM venueplay_founding WHERE id = fid;
  IF approved IS NOT TRUE AND COALESCE(vname, '') ~* '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|sports|surf|golf|services|inn|arms)' THEN
    approved := true;   -- obvious venue: auto-approved by name
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

DROP TRIGGER IF EXISTS vp_venue_settings_gate ON vp_venue_settings;
CREATE TRIGGER vp_venue_settings_gate
  BEFORE INSERT OR UPDATE ON vp_venue_settings
  FOR EACH ROW EXECUTE FUNCTION vp_gate_marketing_collect();
