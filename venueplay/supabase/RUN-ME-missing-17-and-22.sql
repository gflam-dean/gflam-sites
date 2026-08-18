-- =====================================================================
-- The two migrations that never ran. Paste this whole file in one go.
-- Both are idempotent: running it twice changes nothing the second time.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Migration 17: per-manager permission toggles
-- ---------------------------------------------------------------------
-- Without this column, vpbLoadOwner cannot read anyone's permissions, so
-- perms stays null and vpbIsOwner (which is `!o.perms`) says yes to every
-- manager. Every manager is a full account owner today: change the plan,
-- charge the card, cancel the venue, export the player list.
--
-- NOTE: adding the column does NOT restrict anybody on its own. Every
-- existing row still has permissions = null, which still reads as owner.
-- What it does is make restriction POSSIBLE. See the step after this.

alter table vp_venue_staff add column if not exists permissions jsonb;


-- ---------------------------------------------------------------------
-- Migration 22: homes for bingo opt-ins and game figures
-- ---------------------------------------------------------------------
-- Bingo runs on the live link with no worker session, so /capture and
-- /report have had nowhere to write. sbInsert throws when the table is
-- absent and the player page ignores the failure, so every bingo player's
-- name, email, mobile, postcode and marketing consent has been collected
-- from the punter and then thrown away. Same for every end-of-game report.
--
-- RLS on with no policies: the Worker writes with the service key and
-- nothing is readable by the public key.

create table if not exists vp_captures (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references vp_venues(id) on delete cascade,
  first_name          text,
  last_name           text,
  email               text,
  mobile              text,
  postcode            text,
  marketing_optin     boolean not null default false,
  marketing_optin_at  timestamptz,
  source              text default 'bingo',
  created_at          timestamptz not null default now()
);
create index if not exists vp_captures_venue_idx on vp_captures (venue_id, created_at desc);

create table if not exists vp_game_reports (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references vp_venues(id) on delete cascade,
  format      text not null default 'bingo',
  players     int  not null default 0,
  tickets     int  not null default 0,
  prizes      jsonb not null default '[]'::jsonb,
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists vp_game_reports_venue_idx on vp_game_reports (venue_id, created_at desc);

alter table vp_captures     enable row level security;
alter table vp_game_reports enable row level security;


-- ---------------------------------------------------------------------
-- CHECK: re-run the diagnostic afterwards
-- ---------------------------------------------------------------------
-- venueplay-42-what-is-missing.sql should now return no rows at all.
