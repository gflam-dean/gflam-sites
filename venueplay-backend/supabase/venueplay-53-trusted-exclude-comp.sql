-- VenuePlay migration 53: keep comp/demo venues off the public "Trusted by" marquee.
--
-- v_vp_trusted (migration 30) shows every ACTIVE venue that has a logo. That includes test/demo
-- venues, whose logos then appear on the marketing homepage. A comp venue (founding status 'comp',
-- see migration 52) is a demo, not a customer, so it should never appear. Exclude it.
--
-- Still exposes only name + logo_url (no contact data), still granted to anon. Safe to re-run.

CREATE OR REPLACE VIEW v_vp_trusted AS
SELECT v.name AS name, s.logo_url AS logo_url
FROM vp_venues v
JOIN vp_venue_screen s ON s.venue_id = v.id
LEFT JOIN venueplay_founding f ON f.id = v.founding_id
WHERE v.status = 'active'
  AND s.logo_url IS NOT NULL AND s.logo_url <> ''
  AND COALESCE(f.status, '') <> 'comp';

GRANT SELECT ON v_vp_trusted TO anon, authenticated;
