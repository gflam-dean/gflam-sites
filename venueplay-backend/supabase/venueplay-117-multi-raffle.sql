-- =====================================================================
-- Migration 117: more than one raffle per venue
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the Workers
--   and the site is safe:
--     billing Worker  reads vp_venue_screen.raffles in a query of its own; if
--                     PostgREST refuses the column (not run yet) the account
--                     page keeps the ONE raffle routine it has always had and
--                     says nothing is wrong. It only writes `raffles` once the
--                     column has been read back.
--     game Worker     the same: /screen asks for raffles on its own and the TV
--                     falls back to the single routine.
--     prizes          a prize is filed under a raffle only when raffle_id
--                     exists; before that every prize is the venue's, as now.
--
-- WHY. Dean, 24 Oct 2026: "Absolutely" to venues running more than one raffle
-- (a Friday meat raffle and a Sunday chook raffle). The raffle "routine" was one
-- {label, day, time} object on the venue's screen row (vp_venue_screen.raffle),
-- so a second one could not exist.
--
-- WHAT CHANGES.
--   vp_venue_screen.raffles   jsonb, not null, default '[]': the venue's raffles,
--                             each { id, label, day, time }. Lives on the screen
--                             row because that is what the TV already reads, and
--                             the screen history (migration 114) records the
--                             whole row, so every raffle change is versioned and
--                             restorable with no new trigger. `raffle` (the single
--                             routine) is kept and mirrored to the first raffle by
--                             the billing Worker, so anything still reading it
--                             (an older TV page cached in a pub) keeps working.
--   backfill                  every venue with a saved routine gets it as its
--                             first raffle, with a fresh id.
--   vp_raffle_prizes.raffle_id text, null allowed: which raffle a usual prize
--                             belongs to (the id inside `raffles`). Null is a
--                             prize from before this, shown under the venue's
--                             first raffle and in the host console as before.
--
-- No new table, policy, grant or function, so RLS-BASELINE.json does not change.
-- The history trigger fires for the backfill update with no actor header, so
-- those versions read "direct", which is true.
-- =====================================================================

alter table public.vp_venue_screen
  add column if not exists raffles jsonb not null default '[]'::jsonb;

update public.vp_venue_screen
   set raffles = jsonb_build_array(jsonb_build_object(
         'id',    gen_random_uuid()::text,
         'label', coalesce(raffle ->> 'label', ''),
         'day',   coalesce(raffle ->> 'day', ''),
         'time',  coalesce(raffle ->> 'time', '')))
 where raffle is not null
   and jsonb_typeof(raffle) = 'object'
   and (coalesce(raffle ->> 'label', '') <> '' or coalesce(raffle ->> 'day', '') <> '' or coalesce(raffle ->> 'time', '') <> '')
   and raffles = '[]'::jsonb;

alter table public.vp_raffle_prizes
  add column if not exists raffle_id text;

create index if not exists vp_raffle_prizes_raffle_id_idx on public.vp_raffle_prizes (raffle_id);

-- CHECK, read-only, after running:
--   select venue_id, raffle, raffles from public.vp_venue_screen where raffles <> '[]'::jsonb;
--   select column_name from information_schema.columns
--    where table_name = 'vp_raffle_prizes' and column_name = 'raffle_id';
--
-- ROLLBACK (the routine in `raffle` is untouched by this file, so nothing is lost):
--   drop index if exists public.vp_raffle_prizes_raffle_id_idx;
--   alter table public.vp_raffle_prizes drop column if exists raffle_id;
--   alter table public.vp_venue_screen drop column if exists raffles;
