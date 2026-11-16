-- =====================================================================
-- Migration 202: a known phone at a venue, and each consent box kept on its own (INBOX 416, Jobs "Known phone + wizard
-- asks what to collect", Sunday 22 Nov 2026 games release)
-- ---------------------------------------------------------------------
-- Dean, 14 Nov 2026: "if they have already given us their details via trivia they do not get asked the same details over
-- a raffle or anything else". And: first name + mobile are asked of every player at every venue; a returning player is
-- asked ONLY a field the venue added since; a player is never shown what we hold (a first-name hello at most); the
-- details belong to the ACCOUNT OWNER of the venue; consent like Moshtix, one box per sender (venueplay, the venue, a
-- visiting host), each kept separately with who, when, source and wording version.
--
-- WRITTEN, NOT RUN. Branch feature/known-phone-416-sun22. Run it on TEST first (tools/staging/run-on-test.py), then Dean
-- pastes it on live EARLY, before the push. Safe to run twice. Additive only: two new tables, nothing existing changes.
-- NUMBER: 199 is fix/thu19-billing-credit, 200 is fix/members-upload-thu19 (uncommitted on 16 Nov 14:20, the file
-- venueplay-200-members-upload-contacts.sql in that worktree), so 202 (main, 16 Nov: 201 is the retention sweep, sites-wt-retention-16nov).
--
-- WHAT IT ADDS
--   vp_known_players     one row per phone per VENUE: the first name, mobile, and whatever else that venue asked, so
--                        the next game at the same venue (any game, any night) does not ask again. Found ONLY by the
--                        SHA-256 of a random 256-bit key the phone holds (localStorage); the key itself is never kept.
--                        Never shared across venues: a phone holding keys for two venues has two rows, and a lookup is
--                        always venue_id = <the venue of the code> AND key_hash = <hash>.
--   vp_player_consents   one row per box per answer: party 'venueplay' | 'venue' | 'host', granted true/false, the
--                        wording version the person saw, the game it came from, the session, and for a host box the host's
--                        login and the brand name shown. Each sender reads only its own rows. An unsubscribe is a NEW row
--                        (granted false), never an edit, so the history stays whole.
--
-- PRIVACY (player data is tier one). Both tables: RLS on, no policies, everything revoked from public, anon and
-- authenticated; the game Worker (service role) is the only reader and writer. No view, no grant, no HQ page reads them.
-- The 90-day sweep after a venue leaves deletes both tables' rows for that venue (game Worker sweepRetention).
-- RLS-BASELINE.json: two new tables with RLS on and no grants; dump the baseline after it runs on live.
--
-- ORDER: either order is safe. Before this runs the Worker's lookups answer "not known" (the phone shows the full form,
-- exactly as today) and the consent rows are skipped (the venue's own tick is still kept on vp_players as today).
-- =====================================================================

create table if not exists public.vp_known_players (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.vp_venues(id) on delete cascade,
  key_hash      text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  first_name    text check (first_name is null or char_length(first_name) <= 80),
  last_name     text check (last_name is null or char_length(last_name) <= 80),
  email         text check (email is null or char_length(email) <= 200),
  mobile        text check (mobile is null or mobile ~ '^\+614[0-9]{8}$'),
  postcode      text check (postcode is null or char_length(postcode) <= 10),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create unique index if not exists vp_known_players_key_uq on public.vp_known_players (key_hash);
create index if not exists vp_known_players_venue_idx on public.vp_known_players (venue_id);
create index if not exists vp_known_players_venue_mobile_idx on public.vp_known_players (venue_id, mobile) where mobile is not null;

alter table public.vp_known_players enable row level security;
revoke all on public.vp_known_players from public, anon, authenticated;

create table if not exists public.vp_player_consents (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references public.vp_venues(id) on delete cascade,
  known_id           uuid references public.vp_known_players(id) on delete cascade,
  player_id          uuid,                                                   -- the vp_players row it came with, if any
  session_id         uuid,
  party              text not null check (party in ('venueplay', 'venue', 'host')),
  party_name         text check (party_name is null or char_length(party_name) <= 80),   -- the name shown on the box
  host_auth_user_id  uuid,                                                   -- the host login, for a host box only
  granted            boolean not null,
  wording_version    text not null check (char_length(wording_version) <= 20),
  source             text not null check (char_length(source) <= 20),        -- trivia | musical | bingo | coaster | raffle
  created_at         timestamptz not null default now(),
  check ((party = 'host') = (host_auth_user_id is not null))
);
create index if not exists vp_player_consents_venue_idx on public.vp_player_consents (venue_id, party, created_at desc);
create index if not exists vp_player_consents_known_idx on public.vp_player_consents (known_id, party, created_at desc) where known_id is not null;
create index if not exists vp_player_consents_host_idx on public.vp_player_consents (host_auth_user_id, created_at desc) where host_auth_user_id is not null;

alter table public.vp_player_consents enable row level security;
revoke all on public.vp_player_consents from public, anon, authenticated;

comment on table public.vp_known_players is
  'A phone that gave its details at a venue (first name, mobile, and what that venue asks), found only by the hash of a key the phone holds. Per venue, never shared. Service role only. Migration 202, INBOX 416.';
comment on table public.vp_player_consents is
  'One row per consent box answer (venueplay / venue / host), with wording version, source and session. Each sender reads only its own. Service role only. Migration 202, INBOX 416.';

-- Read back (read-only):
--   select relname, relrowsecurity from pg_class where relname in ('vp_known_players', 'vp_player_consents');   expects both true
--   select count(*) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('vp_known_players', 'vp_player_consents')
--      and grantee in ('anon', 'authenticated');                                                             expects 0
-- Rollback: drop table public.vp_player_consents; drop table public.vp_known_players;
