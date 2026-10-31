-- =====================================================================
-- Migration 133: the "What's new at VenuePlay" words in the monthly venue email
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times, and in any order with the
--   billing Worker: until it is run, HQ > Reports says the news cannot be
--   saved yet and the monthly report goes out without a news section.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--
-- WHY. Dean, 31 Oct 2026: "link that with our newsletter so then... we are
-- only sending it once a month... we don't send too many emails." Each venue
-- gets ONE routine email a month: their own report first, then a short
-- "What's new at VenuePlay" that HQ writes once (HQ > Reports), the same in
-- every venue's email. This table holds those words, one row per REPORT
-- month: the row for '2026-10' goes out with October's report on 1 November.
--
-- WHAT IS STORED. Up to four items of {title, text, link}, checked by the
-- Worker before they are saved (no long dashes, never Gflam, no .dev, links
-- only to venueplay.com.au), whether HQ has marked it ready, and who last
-- saved it. Nothing about any venue or player.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_monthly_news (
  month       text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  items       jsonb not null default '[]'::jsonb
                check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 4 and char_length(items::text) <= 4000),
  ready       boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text check (updated_by is null or char_length(updated_by) <= 200)
);

alter table public.vp_monthly_news enable row level security;
revoke all on public.vp_monthly_news from public, anon, authenticated;
grant select, insert, update, delete on public.vp_monthly_news to service_role;

-- Read back (as the service role it answers 200 with []; with the anon key it is refused):
--   GET /rest/v1/vp_monthly_news?select=month&limit=1

-- Rollback:
--   drop table if exists public.vp_monthly_news;
