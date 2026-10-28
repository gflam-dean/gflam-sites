-- =====================================================================
-- Migration 124: the prospect welcome goes on a delay, and HQ can stop it
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries /admin/prospect/welcome-cancel and
--   /admin/prospect/welcome-now. Either order is safe: without this table
--   HQ > Set up a prospect still books the email for later (Resend holds
--   it, scheduled_at), and HQ is told it cannot cancel it or send it early
--   until this is run.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--
-- WHY. Dean, 28 Oct 2026: "an email that goes to the customer... on a
-- delay, so they don't get it straight away." HQ's "Send their email in
-- [90] minutes" books the welcome with Resend for that time. This table is
-- HQ's record of it: when it goes, Resend's id (so it can be cancelled),
-- and the hash of the one-time sign-in link it carries (migration 123), so
-- a cancelled or replaced email's link is retired and cannot be used.
--
-- WHAT IS STORED. Never the sign-in link itself: only its SHA-256, as in
-- vp_signin_links. detail holds what the email was made from (venue name,
-- first name, slug, crowd, state, club or pub, slide count, the login id),
-- so "Send now" can make the same email again with a fresh link.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_prospect_welcomes (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references public.vp_venues(id) on delete cascade,
  email              text not null,
  resend_id          text,
  send_at            timestamptz not null,
  status             text not null default 'scheduled'
                       check (status in ('scheduled', 'sent', 'sent_now', 'cancelled', 'failed')),
  signin_token_hash  text check (signin_token_hash is null or signin_token_hash ~ '^[0-9a-f]{64}$'),
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  created_label      text,
  changed_at         timestamptz,
  changed_by         uuid,
  changed_label      text,
  -- HQ's field is 0 to 1440 minutes; a day of slack for clocks.
  constraint vp_prospect_welcomes_when check (send_at <= created_at + interval '2 days')
);
create index if not exists vp_prospect_welcomes_send_idx on public.vp_prospect_welcomes (send_at desc);
create index if not exists vp_prospect_welcomes_venue_idx on public.vp_prospect_welcomes (venue_id);

alter table public.vp_prospect_welcomes enable row level security;
revoke all on public.vp_prospect_welcomes from public, anon, authenticated;
grant select, insert, update, delete on public.vp_prospect_welcomes to service_role;

-- Rollback:
--   drop table if exists public.vp_prospect_welcomes;
