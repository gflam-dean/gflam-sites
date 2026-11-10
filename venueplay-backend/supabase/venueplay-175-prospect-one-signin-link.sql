-- =====================================================================
-- Migration 175: a prospect's ONE sign-in link (NOT RUN)
-- ---------------------------------------------------------------------
-- Dean, 6 November 2026: "the email and the text, and every follow-up
-- email or text for that prospect, use the SAME link, and sending it
-- again must NOT renew the 30 days." Only HQ's separate "Start a fresh
-- 30 days" button gives a new window and a new link.
--
-- The short link venueplay.com.au/s/XXXXXXXXXXXX is NEVER a login key
-- (security review and Dean, 6 Nov 2026): opening it leads to the
-- normal sign-in with their mobile filled in (or empty when we hold
-- none), and the text code to their own mobile is what signs them in.
-- Once the account has been signed in to, it opens plain sign-in.
--
-- Two columns on vp_prospects:
--   signin_code_hash  sha256 of 'short|' + the letters, to find the
--                     prospect an opened short link belongs to
--   signin_code_enc   the letters SEALED by the Worker ("v1.<nonce>.<hex>",
--                     XOR an HMAC-SHA256 keystream from a Worker secret), so
--                     the next email carries the same ones
--
-- Until this has run the Worker reads no column and behaves as today
-- (each send makes its own link), except that a normal HQ Resend no
-- longer renews the 30 days (that needs no column).
--
-- RLS: vp_prospects keeps its row security and grants (service role
-- only, migration 125). No new table, policy, grant or function, so
-- RLS-BASELINE.json does not change.
--
-- Either order with the billing Worker. NUMBER: 173 is fix/signup-core-10nov's,
-- 174 left free, 175 given by the main session. Branch fix/signin-thread-10nov.
-- =====================================================================

alter table public.vp_prospects
  add column if not exists signin_code_enc text
  check (signin_code_enc is null or signin_code_enc ~ '^v1\.[A-Za-z0-9_-]{16}\.[0-9a-f]{24}$');
alter table public.vp_prospects
  add column if not exists signin_code_hash text unique
  check (signin_code_hash is null or signin_code_hash ~ '^[0-9a-f]{64}$');

comment on column public.vp_prospects.signin_code_enc is
  'The prospect''s short sign-in letters, sealed by the billing Worker (a handle, never a login key). Migration 175, Dean 6 Nov 2026.';
comment on column public.vp_prospects.signin_code_hash is
  'sha256 of the short letters: finds the prospect a tapped short link belongs to. Migration 175.';

-- READ BACK (expect two rows: signin_code_enc text YES, signin_code_hash text YES):
--   select table_name, column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'vp_prospects' and column_name in ('signin_code_enc', 'signin_code_hash');
-- ROLLBACK (the Worker goes back to a link per send; every link already sent keeps working until it ends):
--   alter table public.vp_prospects drop column if exists signin_code_enc;
--   alter table public.vp_prospects drop column if exists signin_code_hash;
