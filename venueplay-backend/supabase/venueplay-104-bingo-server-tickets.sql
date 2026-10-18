-- =====================================================================
-- Migration 104: bingo phone tickets are dealt and claims are checked
--                by the SERVER, and both are kept on the record
-- ---------------------------------------------------------------------
--   Run this BEFORE deploying the venueplay-game.js that goes with it.
--   Safe to run any number of times.
--
--   Either order is still safe for a night: if the Worker is deployed
--   first, /host/bingo/deal cannot write its table, answers an error, and
--   the console deals that game from the tablet exactly as it always did
--   (and says so on the record once it can). But until this is run no
--   ticket and no claim is kept on the server, and keeping them is the
--   point.
--
-- WHY. Dean, 19 Oct 2026: "Lets go the server". Until now the bingo console
-- on the host's tablet made every phone ticket and checked every BINGO
-- against its own copy, and the only server record was the draw and the
-- end-of-game report. For the Queensland phone-ticket approval
-- (rng-certification/qld/PHONE-TICKETS.md, section 5) the system that
-- draws the numbers should also hold the tickets and decide the claims:
--
--   vp_bingo_tickets  every ticket of every game: which draw, which phone
--                     (pid = the phone's signed key fingerprint, and its
--                     server device id), the strip it came from, the 27
--                     cells, the number on it, when it was dealt, and
--                     whether the server or (in an outage) the tablet made
--                     it. A paid count corrected down VOIDS a ticket; the
--                     row stays.
--   vp_bingo_claims   every BINGO pressed: the ticket claimed on, the one
--                     checked, the pattern, how many balls were out, the
--                     verdict the SERVER computed from its own ticket and
--                     its own ball record, which check the host saw, and
--                     what the host decided.
--
-- The pages of a strip that a player has not been dealt yet are stored
-- with dealt_at null, so a ticket bought later comes from the same book
-- (every number once across a book of six). They are never sent to any
-- client before they are dealt.
--
-- Nothing here is readable by the anon or authenticated keys. The game
-- Worker holds the service_role key and is the only thing that touches
-- these, exactly like vp_bingo_draws (migration 70).
--
-- AFTER RUNNING: the live gate compares the database's locks against
-- venueplay-backend/supabase/RLS-BASELINE.json, and these are two new
-- locked tables. Run python3 venueplay-backend/tools/dump-rls-baseline.py
-- and commit the file: that diff is the record that it was on purpose.
--
-- CHECK AFTERWARDS (read-only):
--   select table_name from information_schema.tables
--    where table_name in ('vp_bingo_tickets','vp_bingo_claims');
--   select relname, relrowsecurity from pg_class
--    where relname in ('vp_bingo_tickets','vp_bingo_claims');
--   select grantee, table_name, privilege_type from information_schema.role_table_grants
--    where table_name in ('vp_bingo_tickets','vp_bingo_claims') and grantee in ('anon','authenticated');
--   expect: both tables; relrowsecurity true for both; NO rows from the last query.
--
-- ROLLBACK (loses the ticket and claim record; the night carries on, the
-- console falls back to dealing on the tablet):
--   begin;
--   drop table if exists public.vp_bingo_claims;
--   drop table if exists public.vp_bingo_tickets;
--   commit;
-- =====================================================================

begin;

create table if not exists public.vp_bingo_tickets (
  id          uuid primary key default gen_random_uuid(),
  draw_id     uuid not null references public.vp_bingo_draws(id) on delete cascade,
  pid         text not null check (pid ~ '^[A-Za-z0-9_-]{1,40}$'),   -- the phone's id on the channel
  device_id   text,                                                  -- its server identity (vp_players.device_id)
  book        int  not null check (book >= 0),                       -- which strip of this player's hand
  page        int  not null check (page between 0 and 5),            -- which ticket of that strip
  cells       int[] not null check (array_length(cells, 1) = 27),    -- row-major 3 x 9, blanks are 0
  card_no     int check (card_no is null or card_no > 0),            -- the number on the phone; set when dealt
  source      text not null default 'server' check (source in ('server', 'tablet')),
  created_at  timestamptz not null default now(),
  dealt_at    timestamptz,                                           -- null = not handed out (yet)
  voided_at   timestamptz,                                           -- taken back; the row stays
  check (dealt_at is not null or card_no is null)
);
-- One page of one book per player, per game. Stops two racing deals building the same book twice.
create unique index if not exists vp_bingo_tickets_page
  on public.vp_bingo_tickets (draw_id, pid, book, page);
-- A ticket number the server hands out is unique in the whole game, so "ticket 437 won the house"
-- names one ticket. A tablet ticket (an outage) is numbered by the tablet, unique per player only.
create unique index if not exists vp_bingo_tickets_server_no
  on public.vp_bingo_tickets (draw_id, card_no) where card_no is not null and source = 'server';
create unique index if not exists vp_bingo_tickets_hand_no
  on public.vp_bingo_tickets (draw_id, pid, card_no) where card_no is not null;
create index if not exists vp_bingo_tickets_draw_pid on public.vp_bingo_tickets (draw_id, pid);

create table if not exists public.vp_bingo_claims (
  id              uuid primary key default gen_random_uuid(),
  draw_id         uuid not null references public.vp_bingo_draws(id) on delete cascade,
  ref             text not null check (length(ref) between 6 and 80),   -- the console's key: a retry is the same claim
  pid             text not null check (pid ~ '^[A-Za-z0-9_-]{1,40}$'),
  device_id       text,
  card_no_called  int,                                    -- the ticket number the phone claimed on
  ticket_id       uuid references public.vp_bingo_tickets(id) on delete set null,
  card_no         int,                                    -- the ticket the server checked
  swapped         boolean not null default false,         -- the claimed number was not theirs; another ticket was checked
  pattern         text not null check (pattern in ('one', 'two', 'full', 'top', 'middle', 'bottom', 'corners')),
  balls           int  not null check (balls between 0 and 90),   -- how many balls were out when they pressed BINGO
  last_ball       int check (last_ball is null or last_ball between 1 and 90),
  verdict         text not null check (verdict in ('win', 'not_yet', 'no_ticket')),   -- the SERVER's
  winning_cells   int[],
  decided_on      text not null default 'server' check (decided_on in ('server', 'tablet')),  -- the check the host saw
  tablet_verdict  text check (tablet_verdict is null or tablet_verdict in ('win', 'not_yet')),
  record_note     text,                                   -- e.g. the tablet's ball list disagreed with the server's
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'dropped')),
  claimed_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid
);
create unique index if not exists vp_bingo_claims_ref on public.vp_bingo_claims (draw_id, ref);
create index if not exists vp_bingo_claims_draw on public.vp_bingo_claims (draw_id, claimed_at);

comment on table public.vp_bingo_tickets is
  'Every bingo phone ticket: dealt by the game Worker (or, in an outage, by the tablet and recorded after), to which phone, from which strip, and whether it was voided.';
comment on table public.vp_bingo_claims is
  'Every BINGO pressed on a phone: the ticket checked, the verdict the server computed from its own tickets and ball record, and what the host decided.';

-- Service role only, like the draw (migration 70). The anon key is printed in every page and the
-- authenticated key belongs to a host; neither may read a ticket another phone has not been dealt.
alter table public.vp_bingo_tickets enable row level security;
alter table public.vp_bingo_claims  enable row level security;
revoke all on public.vp_bingo_tickets from public, anon, authenticated;
revoke all on public.vp_bingo_claims  from public, anon, authenticated;

commit;
