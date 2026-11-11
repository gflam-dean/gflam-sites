-- =====================================================================
-- Migration 164: a host's opt-in to venueplay product updates (Dean, 5 Nov 2026, INBOX item 21a)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Either order with the billing
--   Worker: before this table exists POST /account/updates-ask answers
--   {ask:false} (it never asks for what it cannot store), so the host console
--   shows nothing.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no policies, no grants to
--   anon or authenticated). That is Dean's step.
--
-- WHY. Dean: "when a host signs in (by phone), also ask for their EMAIL
-- address, optional, for product updates about once a month. It needs a clear
-- opt-in tick, unticked by default ... and an unsubscribe link in every update.
-- Store the consent with a timestamp. Hosts who skip it are never asked again
-- on every sign-in: at most once a month."
--
-- ONE ROW PER LOGIN (auth_user_id). A host who presses "Not now" (or Save with
-- the tick off) gets opted_in false, asked_at now, and NO email: an email is
-- only ever stored with a tick. A host who ticks gets their email (trimmed,
-- lower case), consent_at, the exact words they ticked (consent_text) and
-- where they ticked it (source 'host-sign-in'). Unsubscribing is NOT a column
-- here: it is vp_unsubscribes, the same list every other email honours, so a
-- person who unsubscribes from anything venueplay sends is never sent these.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
--
-- NUMBER: 152 to 154 are on other branches, tonight's agents take 155
-- onwards, 160 is on this branch, and 161 is the venue rating (fix/venue-rating-8nov), so 164 (the coordinator, 5 Nov 2026). Renumber at merge if taken.
-- Branch fix/host-updates-optin-8nov.
-- =====================================================================

create table if not exists public.vp_host_updates_optin (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  email         text null,
  opted_in      boolean not null default false,
  consent_at    timestamptz null,
  consent_text  text null,
  source        text null,
  asked_at      timestamptz null,
  updated_at    timestamptz default now(),
  -- An email is only ever kept with a tick, and a tick always carries its moment and its words.
  constraint vp_host_updates_optin_consent check (
    (opted_in and email is not null and consent_at is not null and consent_text is not null)
    or (not opted_in and email is null)
  )
);

alter table public.vp_host_updates_optin enable row level security;
revoke all on public.vp_host_updates_optin from public, anon, authenticated;
grant select, insert, update, delete on public.vp_host_updates_optin to service_role;

-- Read back:
--   select relrowsecurity from pg_class where relname = 'vp_host_updates_optin';      -- expect t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'vp_host_updates_optin' and grantee in ('anon', 'authenticated');  -- expect no rows
--   select count(*) filter (where opted_in), count(*) from public.vp_host_updates_optin;

-- Rollback:
--   drop table if exists public.vp_host_updates_optin;
