-- venueplay-118-custom-bingo-patterns.sql
-- NOT RUN. Written 24 Oct 2026 on branch feature/custom-bingo-patterns.
--
-- WHAT IT IS FOR. Dean, 24 Oct 2026, after a Drag Bingo show where "any 5 numbers on the card" was a
-- winning combo: a venue can save its own NAMED winning patterns for number bingo (phone bingo and
-- real balls), and they sit beside the seven built-in ones in every pattern list on the console.
--
--   vp_bingo_patterns          one row per saved pattern, per venue. rule is one of two shapes:
--                                {"type":"any","n":5}              at least n of the ticket's numbers called
--                                {"type":"shape","cells":[0,8,..]} every number in those squares (0..26) called
--                              Written only by the game Worker (/host/bingo/patterns/save and /delete, owner or
--                              manager). A delete sets deleted_at and keeps the row, so a game playing that
--                              pattern when it was deleted is still judged on it.
--   vp_bingo_claims            may now say pattern 'custom', with the pattern it was judged on kept beside it
--                              (custom_pattern_id, and custom_pattern: the name and rule as they stood then).
--
-- ORDER. Either order with the game Worker is safe. Without this table the Worker's list answers
-- available:false and the console shows no custom option, so nothing else changes. Run this, then
-- deploy the Worker of this branch (it carries VP-DRAW-1.2, which judges custom claims).
--
-- AFTER RUNNING: dump RLS-BASELINE.json (one new locked table: RLS on, no policy, no grant to anon or
-- authenticated) with python3 venueplay-backend/tools/dump-rls-baseline.py and commit it.
--
-- Safe to run twice.

create table if not exists public.vp_bingo_patterns (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.vp_venues(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  rule        jsonb not null check (
                (rule->>'type' = 'any' and jsonb_typeof(rule->'n') = 'number'
                   and (rule->>'n')::numeric between 1 and 15)
                or
                (rule->>'type' = 'shape' and jsonb_typeof(rule->'cells') = 'array'
                   and jsonb_array_length(rule->'cells') between 1 and 27)
              ),
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists vp_bingo_patterns_venue on public.vp_bingo_patterns (venue_id, created_at) where deleted_at is null;

comment on table public.vp_bingo_patterns is
  'A venue''s own named winning patterns for number bingo (24 Oct 2026): any N numbers, or a shape of squares. Written by the game Worker only; judged by VP-DRAW customTicketWins.';

-- Service role only, like the draw, the tickets and the claims (migrations 70 and 104).
alter table public.vp_bingo_patterns enable row level security;
revoke all on public.vp_bingo_patterns from public, anon, authenticated;

-- A claim may be on a custom pattern, and keeps what it was judged on.
alter table public.vp_bingo_claims drop constraint if exists vp_bingo_claims_pattern_check;
alter table public.vp_bingo_claims add constraint vp_bingo_claims_pattern_check
  check (pattern in ('one', 'two', 'full', 'top', 'middle', 'bottom', 'corners', 'custom'));
alter table public.vp_bingo_claims add column if not exists custom_pattern_id uuid references public.vp_bingo_patterns(id) on delete set null;
alter table public.vp_bingo_claims add column if not exists custom_pattern jsonb;

-- CHECK, read-only, after running:
--   select column_name from information_schema.columns where table_name = 'vp_bingo_claims' and column_name like 'custom%';
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_bingo_claims_pattern_check';
--   select relrowsecurity from pg_class where relname = 'vp_bingo_patterns';             -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'vp_bingo_patterns' and grantee in ('anon', 'authenticated');   -- no rows
--
-- ROLLBACK (only before any custom claim is on the record; a claim row saying 'custom' fails the old check):
--   alter table public.vp_bingo_claims drop column if exists custom_pattern;
--   alter table public.vp_bingo_claims drop column if exists custom_pattern_id;
--   alter table public.vp_bingo_claims drop constraint if exists vp_bingo_claims_pattern_check;
--   alter table public.vp_bingo_claims add constraint vp_bingo_claims_pattern_check
--     check (pattern in ('one', 'two', 'full', 'top', 'middle', 'bottom', 'corners'));
--   drop table if exists public.vp_bingo_patterns;
