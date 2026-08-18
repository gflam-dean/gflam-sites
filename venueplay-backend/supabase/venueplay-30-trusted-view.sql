-- VenuePlay migration 30: public "Trusted by" view - active venues that have uploaded a logo.
-- Exposes ONLY name + logo_url (no contact data). Granted to anon for the marketing site. Safe to re-run.
CREATE OR REPLACE VIEW v_vp_trusted AS
SELECT v.name AS name, s.logo_url AS logo_url
FROM vp_venues v
JOIN vp_venue_screen s ON s.venue_id = v.id
WHERE v.status = 'active' AND s.logo_url IS NOT NULL AND s.logo_url <> '';
GRANT SELECT ON v_vp_trusted TO anon, authenticated;
