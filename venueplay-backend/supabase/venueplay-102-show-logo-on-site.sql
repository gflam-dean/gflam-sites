-- =====================================================================
-- Migration 102: a venue decides whether its logo is on the VenuePlay website
-- ---------------------------------------------------------------------
--   Safe to run any number of times. Run it BEFORE the billing Worker
--   that reads the column is deployed. That Worker also works without it:
--   the "Trusted by" read asks for show_logo_on_site=true, PostgREST refuses
--   a filter on a column that is not there, and the read fails CLOSED, so
--   the homepage strip simply stays hidden until this has been run.
--
-- WHY. Dean, 7 Aug 2026: a venue's logo shows in the corner of its TV, and
-- the logos of live, paying venues scroll across the marketing site as a
-- "Trusted by" strip. The TV half and the strip were built in August
-- (migrations 29, 30, 53, 54), but the only way off the strip was HQ's own
-- hide_from_trusted flag. A venue had no say in being shown to the public
-- as a customer. That is the venue's name and brand on our sales page, so
-- it is the venue's decision: "Show our logo on the VenuePlay website" on
-- the Screen tab of Your account, ticked by default, untick to come off.
-- Two flags on purpose, owned by two people:
--   show_logo_on_site   the VENUE's consent (this migration, default on)
--   hide_from_trusted   HQ's override (migration 54, default off)
-- A logo is on the website only when the venue says yes AND HQ has not
-- hidden it.
--
-- WHERE THE LOGO ITSELF LIVES. vp_venue_screen.logo_url (migration 29),
-- unchanged. It was NOT copied onto vp_venues: the game Worker's /screen
-- already hands that column to tv.html, every game screen and the phones,
-- and a second copy of one answer is the fault this codebase keeps paying
-- for. Uploads now go through the billing Worker (/account/logo-upload),
-- which checks the file really is a PNG or WebP under 1 MB and writes it to
-- the public "venue-logos" Storage bucket as <venue_id>/<sha256>.png.
--
-- WHAT CHANGES.
--   vp_venues.show_logo_on_site   boolean, not null, default true
--   v_vp_trusted                  also requires show_logo_on_site. The
--                                 homepage no longer reads this view (it asks
--                                 the billing Worker's GET /trusted-logos,
--                                 which applies the paying-venue rule as well),
--                                 but the view is still granted to anon, so it
--                                 must not list a venue that said no. Same two
--                                 columns, same grant, so RLS-BASELINE.json
--                                 does not change.
-- No new policy. The column is written only by the billing Worker with the
-- service role (POST /account/logo-site, owner or a manager with the
-- advertising right).
--
-- THE STORAGE BUCKET. The Worker creates "venue-logos" itself on the first
-- upload (the same way it made "venue-ads"). If that ever fails, create it
-- by hand with the service key; this is how the "social" bucket was made:
--
--   curl -X POST "$SUPABASE_URL/storage/v1/bucket" \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
--     -H "apikey: $SUPABASE_SERVICE_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"id":"venue-logos","name":"venue-logos","public":true,
--          "file_size_limit":1048576,
--          "allowed_mime_types":["image/png","image/webp"]}'
--
-- It must be PUBLIC: a TV and the homepage load the logo with no login.
--
-- CHECK AFTERWARDS (read-only):
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'vp_venues' and column_name = 'show_logo_on_site';
--   select pg_get_viewdef('v_vp_trusted'::regclass);   -- mentions show_logo_on_site
-- =====================================================================

ALTER TABLE public.vp_venues
  ADD COLUMN IF NOT EXISTS show_logo_on_site boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.vp_venues.show_logo_on_site IS
  'The venue''s own consent to its logo appearing on the VenuePlay website (Trusted by strip). Default true. HQ can still hide a venue with hide_from_trusted. Migration 102.';

CREATE OR REPLACE VIEW v_vp_trusted AS
SELECT v.name AS name, s.logo_url AS logo_url
FROM vp_venues v
JOIN vp_venue_screen s ON s.venue_id = v.id
LEFT JOIN venueplay_founding f ON f.id = v.founding_id
WHERE v.status = 'active'
  AND s.logo_url IS NOT NULL AND s.logo_url <> ''
  AND v.hide_from_trusted = false
  AND v.show_logo_on_site = true
  AND COALESCE(f.status, '') <> 'comp';

GRANT SELECT ON v_vp_trusted TO anon, authenticated;
