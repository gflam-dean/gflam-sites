-- VenuePlay migration 17: per-manager permission toggles.
-- Safe to run more than once.
--
-- A manager is a vp_venue_staff row with role 'manager', assigned to one or more venues.
-- The owner can loosen or tighten what each manager may do via these toggles. NULL means
-- "all allowed" (the role default), so existing rows keep working unchanged. The toggles are:
--   advertising | draws_raffles | players_optin | add_hosts   (booleans; missing = allowed)
-- The group-level settings (what player data is collected, the marketing opt-in rule, name
-- display, billing) are NEVER in here: they stay owner-only and are enforced in the Worker.

ALTER TABLE vp_venue_staff ADD COLUMN IF NOT EXISTS permissions jsonb;
