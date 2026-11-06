-- =====================================================================
-- Migration 171: our licensed venues list, for the no-card start (vp_licensed_venues)
-- ---------------------------------------------------------------------
-- Dean, 5 Nov 2026 (INBOX 81): "STOP FAKE SIGN-UPS getting a free month just
-- to see what we've got". On submit, the venue name + postcode is matched
-- against our list of LICENSED venues. A match makes the account straight
-- away; no match makes nothing until HQ approves it.
--
-- THE LIST lives on the Mac today, not in Supabase: the two lists the
-- prospect autopilot already calls "our lists of licensed venues"
-- (prospect-autopilot.py venue_rows()):
--   ~/venue-enrich/venueplay-SEND-pubs-and-clubs.csv     (the send list)
--   ~/venue-enrich/partyplay-fit-2026-10-27/master.csv   (the venue master, from the
--                                                         state liquor and gaming registers)
-- tools/build-licensed-venues.py reads both, keys every name with the one
-- matcher (vpVenueKey, vp-venue-match.js), keeps one row per name key and
-- postcode, and writes the rows for loading (it loads nothing itself).
--
-- name_key is vpVenueKey(name) and must be made by that function, never
-- by SQL, so the Worker and the list can never key a name two ways.
--
-- Service role only (RLS on, no policies, nothing granted to anon or
-- authenticated): the Worker reads it by postcode, one postcode at a time,
-- and says only "on the list" or "not on the list".
--
-- NUMBER: 170 is the sign-up attempts (same branch), so 171. Branch
-- fix/signup-core-10nov. NOT RUN.
--
-- ORDER: run, then load the rows (tools/build-licensed-venues.py --sql
-- writes a file of inserts), then deploy the billing Worker. If the table
-- is missing or empty, EVERY no-card start is held for HQ approval (no
-- account, no free month): the safe way round, never "everyone is listed".
--
-- RLS-BASELINE.json: one new table with RLS on and no policy or grant.
-- =====================================================================

create table if not exists public.vp_licensed_venues (
  id          bigserial primary key,
  name        text not null check (char_length(name) between 1 and 200),
  name_key    text not null check (char_length(name_key) between 1 and 200),
  postcode    text not null check (postcode ~ '^[0-9]{4}$'),
  suburb      text check (suburb is null or char_length(suburb) <= 80),
  au_state    text check (au_state is null or au_state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT')),
  source      text not null check (source in ('send list', 'venue master list')),
  loaded_at   timestamptz not null default now()
);
create unique index if not exists vp_licensed_venues_key_pc on public.vp_licensed_venues (name_key, postcode);
create index if not exists vp_licensed_venues_pc on public.vp_licensed_venues (postcode);

alter table public.vp_licensed_venues enable row level security;
revoke all on public.vp_licensed_venues from public, anon, authenticated;
grant select, insert, update, delete on public.vp_licensed_venues to service_role;
grant usage, select on sequence public.vp_licensed_venues_id_seq to service_role;

comment on table public.vp_licensed_venues is
  'Our licensed venues (the send list and the venue master), one row per vpVenueKey name and postcode, for the no-card start''s check (INBOX 81). Service role only. Migration 171.';

-- Read back (read-only):
--   select relname, relrowsecurity from pg_class where relname = 'vp_licensed_venues';
--   expects relrowsecurity = true.
--   select grantee from information_schema.role_table_grants
--    where table_name = 'vp_licensed_venues' and grantee in ('anon', 'authenticated');
--   expects NO rows.
--   After loading: select count(*), count(distinct postcode) from public.vp_licensed_venues;
--   expects the counts tools/build-licensed-venues.py printed.

-- Rollback (the list is rebuilt from the Mac's files at any time):
--   drop table if exists public.vp_licensed_venues;
