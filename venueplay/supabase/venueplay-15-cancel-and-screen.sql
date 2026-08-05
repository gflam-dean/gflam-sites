-- VenuePlay migration 15: venue cancellation + customisable venue screen.
--
-- Two independent additions. Safe to run more than once.
--
-- 1) vp_venues.cancel_at_period_end
--    Powers the "Cancel this venue" button on the Account page. When set, the venue keeps
--    full access until the end of its current paid period; the invoice.paid webhook then
--    suspends it and it stops being billed. Clearing the flag (Undo) restores normal billing.
ALTER TABLE vp_venues ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

-- 2) vp_venue_screen
--    One row per venue holding what shows on that venue's TV (/tv?venue=<slug>): custom promo
--    slides, the weekly members-draw schedule, and the meat-raffle blurb. The venue owner edits
--    this from the Account page (through the Worker, service key). The TV screen reads it
--    unauthenticated by slug, so anon SELECT is allowed; there is no anon write.
CREATE TABLE IF NOT EXISTS vp_venue_screen (
  venue_id   uuid PRIMARY KEY REFERENCES vp_venues(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  slides     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{tag,head,sub,accent}]
  draws      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{day,jackpot,time,tonight}]
  raffle     jsonb,                                 -- {tag,head,sub} or null to hide
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vp_venue_screen_slug ON vp_venue_screen (slug);

ALTER TABLE vp_venue_screen ENABLE ROW LEVEL SECURITY;

-- The TV screen is a public kiosk: allow anyone to read a venue's screen content.
DROP POLICY IF EXISTS vp_venue_screen_public_read ON vp_venue_screen;
CREATE POLICY vp_venue_screen_public_read ON vp_venue_screen
  FOR SELECT USING (true);

-- No client write policy on purpose: every write goes through the owner-gated Worker with the
-- service key, so a venue can only ever change its own screen (the Worker enforces ownership).
