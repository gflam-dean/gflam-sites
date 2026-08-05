-- VenuePlay migration 20: opt-in export approval flag.
-- Safe to run more than once.
--
-- Customer opt-in data belongs to the VENUE. An account whose venue names clearly read as a
-- venue (Hotel, Tavern, RSL, Club, and the like) can export straight away. Anything else (e.g.
-- a trivia-host company running games at venues it does not own) is held for a manual approval
-- so a third party can't quietly walk off with a venue's customer list. This flag is that
-- approval; NULL/false means "not yet approved" (the export is blocked until a real venue name
-- is detected or an admin approves).

ALTER TABLE venueplay_founding ADD COLUMN IF NOT EXISTS optin_release_approved boolean;
