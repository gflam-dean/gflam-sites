-- =====================================================================
-- Migration 198: the first name and mobile from a Coaster Trivia round at a board with no venueplay account
-- ---------------------------------------------------------------------
-- Dean, 15 November 2026: "name and mobile always, at every venue". At a venueplay venue the details go to that
-- venue the way they always have (vp_captures, source 'coaster'). A venue a player ADDED (and a coaster venue or a
-- pub from our licensed list) has no account owner, so the first name and the mobile are kept here, for venueplay
-- only:
--   - service role only (RLS on, no policies, revoked from public, anon and authenticated), like the other coaster tables
--   - never shown to any venue, never in an export, never emailed or texted for marketing: service only
--   - one row per board and mobile (a second round from the same phone keeps the first)
--   - an added venue's rows go when its lead row goes (the 30-day sweep of unverified boards, migration 194)
-- Additive only: one new table, two indexes. Nothing else changes. Safe to run twice.
-- The game Worker that writes it keeps nothing (and the round plays the same) until this has run.
-- RLS-BASELINE.json: one new table with RLS on and no grants; dump the baseline after it runs on live.
-- =====================================================================

create table if not exists public.vp_coaster_contacts (
  id               uuid primary key default gen_random_uuid(),
  board            text not null check (char_length(board) <= 60),              -- 'c:<uuid>' or 'l:<id>'
  coaster_venue_id uuid references public.vp_coaster_venues(id) on delete cascade,   -- the added venue's lead row, when it is one
  play_id          uuid references public.vp_coaster_plays(id) on delete set null,   -- the first round it came with
  first_name       text check (first_name is null or char_length(first_name) <= 40),
  mobile           text not null check (mobile ~ '^\+614[0-9]{8}$'),
  created_at       timestamptz not null default now()
);

create unique index if not exists vp_coaster_contacts_board_mobile_uq on public.vp_coaster_contacts (board, mobile);
create index if not exists vp_coaster_contacts_venue_idx on public.vp_coaster_contacts (coaster_venue_id) where coaster_venue_id is not null;

alter table public.vp_coaster_contacts enable row level security;
revoke all on public.vp_coaster_contacts from public, anon, authenticated;

comment on table public.vp_coaster_contacts is
  'Coaster Trivia: first name + mobile from a round at a board with no venueplay account (a player-added venue, a coaster venue, a listed pub). venueplay only, service role only, never shown to a venue, never used for marketing. Migration 198.';

-- Read back (read-only):
--   select relrowsecurity from pg_class where oid = 'public.vp_coaster_contacts'::regclass;   expects true
--   select count(*) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'vp_coaster_contacts' and grantee in ('anon', 'authenticated');   expects 0
