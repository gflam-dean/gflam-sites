-- VenuePlay migration 52: allow a 'comp' status on venueplay_founding.
--
-- A comp/demo venue added from HQ is written with founding status 'comp' so it runs games (the kill
-- switch reads vp_venues.status, not this) WITHOUT eating one of the 100 founding spots -- the counter
-- venueplay_spots_taken() only counts founding rows with status in ('card_on_file','active').
--
-- venueplay_founding carried an enum-style CHECK (venueplay_founding_status_check) that rejected
-- 'comp'. Drop it so the app-controlled status column accepts new values. Existing rows are untouched.
--
-- Safe to run more than once.

alter table public.venueplay_founding drop constraint if exists venueplay_founding_status_check;
