-- =====================================================================
-- Migration 136: HQ's monthly report, stored once instead of added up on every open
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times, any order with the billing
--   Worker: until it is run HQ > Reports says the stored copy is not there yet
--   and its Refresh button says why it cannot keep one. Nothing else changes.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table).
--
-- WHY. Dean, 31 Oct 2026: HQ Reports should "show a stored copy made on the
-- 1st (plus a manual refresh this month button for owner/accounts) so opening
-- HQ during a game night never reads 13 months of every venue". The billing
-- Worker's scheduled run makes last month's copy between 2am and 7am Brisbane
-- on the 1st (whether or not the monthly email is switched on: it sends
-- nothing), and HQ's Refresh makes one for any month on an owner's tap.
--
-- WHAT IS STORED. The HQ answer as JSON: counts per venue and in total, the
-- venues trending down, and the advert counts. Venue names; never a player.
--
-- LOCKED. Service role only: RLS on, no policies, anon/authenticated revoked.
-- =====================================================================

create table if not exists public.vp_month_reports (
  month     text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  data      jsonb not null check (jsonb_typeof(data) = 'object'),
  made_at   timestamptz not null default now(),
  made_by   text check (made_by is null or char_length(made_by) <= 200)
);

alter table public.vp_month_reports enable row level security;
revoke all on public.vp_month_reports from public, anon, authenticated;
grant select, insert, update, delete on public.vp_month_reports to service_role;

-- Read back (service role): GET /rest/v1/vp_month_reports?select=month,made_at&limit=1 answers 200.

-- Rollback:
--   drop table if exists public.vp_month_reports;
