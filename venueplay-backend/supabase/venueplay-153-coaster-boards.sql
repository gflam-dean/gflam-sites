-- =====================================================================
-- Migration 153: the coaster round's venue boards and coaster venues
-- ---------------------------------------------------------------------
-- Dean, 4 November 2026, /live-here-now v2 (the drink-coaster QR page).
-- All 10,000 coasters carry ONE QR, so the page asks the player's first
-- name, then "Where are you playing?" (type three letters of the pub's
-- name). The search lists only what is in venueplay: customers, prospects
-- and COASTER VENUES. A pub that is not listed is typed in and saved as a
-- lead for Dean. Everyone who plays at a place lands on that place's board,
-- "Tonight" and "This week", first names only.
--
-- TWO TABLES, both service role only (RLS on, no policies, nothing granted
-- to anon or authenticated). The page never reads them: it goes through
-- four narrow, rate-limited game Worker routes (/coaster/*), and HQ goes
-- through the billing Worker's /admin/coaster/* (owner or accounts).
--
-- vp_coaster_venues: places that are NOT venueplay venues.
--   kind 'coaster'  Dean hands a venue coasters and adds it in HQ as a
--                   "coaster venue (no emails)": name, suburb, postcode,
--                   logo. It is NOT a vp_venues row, has no login, no
--                   email address and no vp_prospects row, so no welcome,
--                   nudge, reminder, sign-in text or monthly email path
--                   can reach it (those all start from vp_venues /
--                   vp_prospects / vp_venue_staff). When Dean switches it
--                   to a normal prospect, HQ's ordinary Set up a prospect
--                   runs (that is when emails start, by his choice) and
--                   venue_id/switched_at are set here; its board moves to
--                   the new venue.
--   kind 'lead'     a player typed a pub that is not listed. Shown in HQ as
--                   "coaster players at X, not on venueplay". One row per
--                   name (name_key), so mates typing the same pub share a
--                   board. Never offered in the search to other players
--                   (it is unchecked free text).
--
-- vp_coaster_plays: one row per round played. board is 'v:<vp_venues.id>'
--   or 'c:<vp_coaster_venues.id>'. first_name is the first word only,
--   cleaned by the game Worker's cleanName (no surnames, no contact
--   details: nothing else about the person is collected). night/week are
--   the place's local night (5am rollover) and that night's Monday, so the
--   boards reset by themselves. The Worker times and scores each answer
--   itself (the trivia rule, triviaAnswerPoints), so a phone cannot post a
--   score. token_hash is the SHA-256 of the round's secret; the phone keeps
--   the secret. code is the "Challenge your mates" link's code. Rounds are
--   deleted after 35 days by the game Worker's nightly sweep.
--
-- NUMBER: 140 to 152 are taken on other branches (152 is
-- fix/hq-prospects-6nov), so 153. Branch feature/live-here-now-v2. NOT RUN.
--
-- ORDER: run BEFORE the game Worker and billing Worker that carry /coaster
-- and /admin/coaster. Before it runs, both answer "not switched on yet" and
-- the page plays exactly as before (no names, no board).
--
-- RLS-BASELINE.json: two new tables with RLS on and no policy or grant.
-- After running, dump it (python3 venueplay-backend/tools/dump-rls-baseline.py)
-- and commit the diff, as the repo's process says.
-- =====================================================================

create table if not exists public.vp_coaster_venues (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('coaster', 'lead')),
  name          text not null check (char_length(name) between 1 and 120),
  name_key      text not null check (char_length(name_key) between 1 and 120),
  suburb        text check (suburb is null or char_length(suburb) <= 60),
  postcode      text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  au_state      text check (au_state is null or au_state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT')),
  timezone      text check (timezone is null or timezone ~ '^Australia/[A-Za-z_]+$'),
  logo_url      text check (logo_url is null or (char_length(logo_url) <= 400 and logo_url ~* '^https://')),
  venue_id      uuid references public.vp_venues(id) on delete set null,
  switched_at   timestamptz,
  created_at    timestamptz not null default now(),
  created_label text check (created_label is null or char_length(created_label) <= 120)
);
-- One lead per typed name (still open), so mates typing the same pub share one board.
create unique index if not exists vp_coaster_venues_lead_name
  on public.vp_coaster_venues (name_key) where kind = 'lead' and venue_id is null;
create index if not exists vp_coaster_venues_kind_idx on public.vp_coaster_venues (kind, created_at desc);

alter table public.vp_coaster_venues enable row level security;
revoke all on public.vp_coaster_venues from public, anon, authenticated;
grant select, insert, update, delete on public.vp_coaster_venues to service_role;

create table if not exists public.vp_coaster_plays (
  id          uuid primary key default gen_random_uuid(),
  board       text not null check (board ~ '^[vc]:[0-9a-f-]{36}$'),
  first_name  text not null check (char_length(first_name) between 1 and 14),
  qids        text[] not null check (array_length(qids, 1) = 5),
  code        text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  from_code   text check (from_code is null or from_code ~ '^[A-Z0-9]{6}$'),
  token_hash  text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  answers     smallint[] not null default '{}',
  points      integer not null default 0 check (points between 0 and 100000),
  correct     smallint not null default 0 check (correct between 0 and 5),
  ms_total    integer not null default 0 check (ms_total >= 0),
  asked_at    timestamptz not null default now(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  night       date not null,
  week        date not null
);
create index if not exists vp_coaster_plays_night_idx on public.vp_coaster_plays (board, night, points desc, ms_total asc) where finished_at is not null;
create index if not exists vp_coaster_plays_week_idx  on public.vp_coaster_plays (board, week, points desc, ms_total asc) where finished_at is not null;
create index if not exists vp_coaster_plays_started_idx on public.vp_coaster_plays (started_at);

alter table public.vp_coaster_plays enable row level security;
revoke all on public.vp_coaster_plays from public, anon, authenticated;
grant select, insert, update, delete on public.vp_coaster_plays to service_role;

comment on table public.vp_coaster_venues is
  'Coaster round places that are not venueplay venues: coaster venues Dean added in HQ (no emails) and pubs players typed in (leads). Service role only. Migration 153.';
comment on table public.vp_coaster_plays is
  'One coaster round (/live-here-now): first name only, scored by the game Worker, kept 35 days. Service role only. Migration 153.';

-- Read back (read-only):
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('vp_coaster_venues', 'vp_coaster_plays') order by 1;
--   expects two rows.
--   select relname, relrowsecurity from pg_class where relname in ('vp_coaster_venues', 'vp_coaster_plays');
--   expects relrowsecurity = true for both.
--   select grantee, table_name, privilege_type from information_schema.role_table_grants
--    where table_name in ('vp_coaster_venues', 'vp_coaster_plays') and grantee in ('anon', 'authenticated');
--   expects NO rows.
--   select count(*) from pg_policies where tablename in ('vp_coaster_venues', 'vp_coaster_plays');
--   expects 0.

-- Rollback (deletes every coaster board and coaster venue; nothing else reads them):
--   drop table if exists public.vp_coaster_plays;
--   drop table if exists public.vp_coaster_venues;
