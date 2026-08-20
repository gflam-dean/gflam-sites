-- VenuePlay migration 54: a per-venue "hide from the homepage marquee" flag.
--
-- The public "Trusted by" marquee (v_vp_trusted) shows every active venue with a logo. HQ gets a
-- one-click toggle to keep a specific venue off it (a test/friend venue, or one that would rather not
-- appear) WITHOUT having to remove its logo or mark it comp. Defaults false, so nothing changes for
-- existing venues.
--
-- The view now excludes hidden venues AND comp venues (migration 53). Still only name + logo_url, still
-- granted to anon. Safe to re-run.

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS hide_from_trusted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW v_vp_trusted AS
SELECT v.name AS name, s.logo_url AS logo_url
FROM vp_venues v
JOIN vp_venue_screen s ON s.venue_id = v.id
LEFT JOIN venueplay_founding f ON f.id = v.founding_id
WHERE v.status = 'active'
  AND s.logo_url IS NOT NULL AND s.logo_url <> ''
  AND v.hide_from_trusted = false
  AND COALESCE(f.status, '') <> 'comp';

GRANT SELECT ON v_vp_trusted TO anon, authenticated;
