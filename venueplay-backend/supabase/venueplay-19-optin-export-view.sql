-- VenuePlay migration 19: a view for the owner's opt-in export.
-- Safe to run more than once.
--
-- Joins opted-in players to their session's venue so the export can be filtered by venue_id.
-- This view is NOT granted to anon/authenticated: only the account Worker (service key) reads
-- it, and the Worker filters strictly to the caller's OWN venues. So an owner can never pull
-- another venue's or another account's contacts. Only opted-in players appear.

CREATE OR REPLACE VIEW v_vp_player_optins AS
SELECT
  s.venue_id            AS venue_id,
  p.first_name          AS first_name,
  p.last_name           AS last_name,
  p.email               AS email,
  p.mobile              AS mobile,
  p.postcode            AS postcode,
  p.marketing_optin_at  AS opted_in_at
FROM vp_players p
JOIN vp_sessions s ON s.id = p.session_id
WHERE p.marketing_optin = true;
