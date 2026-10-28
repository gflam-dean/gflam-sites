-- =====================================================================
-- Migration 123: one-time "Open your VenuePlay" sign-in links
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries POST /auth/one-click. Either order is safe:
--     without this table /admin/prospect still sets the venue up and sends
--     the welcome; its main button then opens the email sign-in instead of
--     signing them straight in, and HQ is told why.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--
-- WHY. Dean, 28 Oct 2026: "Can we do a link to click that automatically goes
-- to that page so there's no signing in with an email to confuse them why
-- they then get a text?" The prospect welcome email (HQ > Set up a prospect)
-- now carries ONE button that signs the contact straight in, once.
--
-- WHAT IS STORED. Never the link itself. The Worker makes 32 random bytes
-- (crypto.getRandomValues), puts them in the email, and keeps only their
-- SHA-256 here. Someone who reads this table cannot sign in with anything in
-- it. A link works ONCE (used_at is set by the one conditional UPDATE that
-- signs them in: "where used_at is null", so a double click or two tabs at
-- the same instant give exactly one sign-in) and for 14 days.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_signin_links (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  venue_id      uuid not null references public.vp_venues(id) on delete cascade,
  purpose       text not null default 'prospect_welcome' check (purpose in ('prospect_welcome')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  -- A link can never be made to last longer than the 14 days the email promises (with a day of slack for clocks).
  constraint vp_signin_links_life check (expires_at > created_at and expires_at <= created_at + interval '15 days')
);
create index if not exists vp_signin_links_user_idx on public.vp_signin_links (auth_user_id);

alter table public.vp_signin_links enable row level security;
revoke all on public.vp_signin_links from public, anon, authenticated;
grant select, insert, update, delete on public.vp_signin_links to service_role;

-- Rollback:
--   drop table if exists public.vp_signin_links;
