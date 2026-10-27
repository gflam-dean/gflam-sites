-- VenuePlay migration 29: venue logo shown in the corner of the TV. Safe to run more than once.
ALTER TABLE vp_venue_screen ADD COLUMN IF NOT EXISTS logo_url text;
