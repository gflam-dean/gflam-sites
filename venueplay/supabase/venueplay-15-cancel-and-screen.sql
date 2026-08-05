-- VenuePlay migration 15: venue cancellation + customisable venue screen.
-- Safe to run more than once.
--
-- Comments are kept on their own lines on purpose. Inline (end-of-line) comments can get
-- merged into the next statement when the file is copy-pasted, which swallows a semicolon
-- and produces a "syntax error at or near ALTER". Full-line comments avoid that entirely.
--
-- 1) vp_venues.cancel_at_period_end
--    Powers the "Cancel this venue" button on the Account page. When set, the venue keeps
--    full access until the end of its current paid period; the invoice.paid webhook then
--    suspends it and it stops being billed. Clearing the flag (Undo) restores normal billing.
--
-- 2) vp_venue_screen
--    One row per venue holding what shows on that venue's TV (/tv?venue=<slug>): uploaded
--    advertising images and the raffle routine. Owners edit it from the Account page through
--    the Worker (service key). The TV reads it unauthenticated by slug, so anon SELECT is
--    allowed; there is no anon write.
--    slides shape: [{image_url,seconds,starts?,ends?}]   raffle shape: {label,day,time} or null.
--    draws is legacy/unused (the members board reads vp_member_draws directly).

ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vp_venue_screen (
  venue_id uuid PRIMARY KEY REFERENCES vp_venues(id) ON DELETE CASCADE,
  slug text NOT NULL,
  slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  draws jsonb NOT NULL DEFAULT '[]'::jsonb,
  raffle jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp_venue_screen_slug ON vp_venue_screen (slug);

ALTER TABLE vp_venue_screen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vp_venue_screen_public_read ON vp_venue_screen;

CREATE POLICY vp_venue_screen_public_read ON vp_venue_screen FOR SELECT USING (true);

GRANT SELECT ON vp_venue_screen TO anon, authenticated;
