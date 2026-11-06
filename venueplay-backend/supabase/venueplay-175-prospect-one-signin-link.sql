-- =====================================================================
-- Migration 175: a prospect's ONE sign-in link (NOT RUN)
-- ---------------------------------------------------------------------
-- Dean, 6 November 2026: "the email and the text, and every follow-up
-- email or text for that prospect, use the SAME link, and sending it
-- again must NOT renew the 30 days." Only HQ's separate "Start a fresh
-- 30 days" button gives a new window and a new link.
--
-- One column on vp_prospects: signin_code_enc, the prospect's short
-- sign-in code (venueplay.com.au/s/XXXXXXXX), SEALED by the billing
-- Worker ("v1.<nonce>.<hex>": the 8 letters XOR an HMAC-SHA256 keystream
-- from a Worker secret and a random nonce), so this table alone never
-- holds a working key. The code's one-tap row stays in vp_signin_links
-- as every link does (its sha256 only, the expiry, used once and
-- re-armed by the next send at the SAME expiry).
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
  check (signin_code_enc is null or signin_code_enc ~ '^v1\.[A-Za-z0-9_-]{16}\.[0-9a-f]{16}$');

comment on column public.vp_prospects.signin_code_enc is
  'The prospect''s one short sign-in code, sealed by the billing Worker (never a working key on its own). Migration 175, Dean 6 Nov 2026.';

-- READ BACK (expect one row, data_type text, is_nullable YES):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'vp_prospects' and column_name = 'signin_code_enc';
-- ROLLBACK (the Worker goes back to a link per send; every link already sent keeps working until it ends):
--   alter table public.vp_prospects drop column if exists signin_code_enc;
