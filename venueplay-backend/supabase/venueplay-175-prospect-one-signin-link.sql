-- =====================================================================
-- Migration 175: a prospect's ONE sign-in link (NOT RUN)
-- ---------------------------------------------------------------------
-- Dean, 6 November 2026: "the email and the text, and every follow-up
-- email or text for that prospect, use the SAME link, and sending it
-- again must NOT renew the 30 days." Only HQ's separate "Start a fresh
-- 30 days" button gives a new window and a new link.
--
-- The short link venueplay.com.au/s/XXXXXXXX is a HANDLE, never a login key
-- (security review, 6 Nov 2026): the billing Worker maps it to the CURRENT
-- live one-tap token (32 random bytes, kept as its sha256, single use,
-- ending with the 30 days). A used token is never opened again; a send we
-- make on purpose mints the next one behind the same letters at the SAME
-- end. Self-serve asks ("Send me a new link", /go/{venue code}) never touch
-- the short link: they email a long link of their own.
--
-- Three columns:
--   vp_prospects.signin_code_hash  sha256 of 'short|' + the letters, to find
--                                  the prospect a tapped short link belongs to
--   vp_prospects.signin_code_enc   the letters SEALED by the Worker ("v1.<nonce>.<hex>",
--                                  XOR an HMAC-SHA256 keystream from a Worker
--                                  secret), so the next email carries the same ones
--   vp_signin_links.short_ok       true only for a token made to sit behind the
--                                  short link (default false: every other link)
--
-- Until this has run the Worker reads no column and behaves as today
-- (each send makes its own link), except that a normal HQ Resend no
-- longer renews the 30 days (that needs no column).
--
-- RLS: vp_prospects and vp_signin_links keep their row security and
-- grants (service role only, migrations 125 and 123). No new table, policy, grant or function, so
-- RLS-BASELINE.json does not change.
--
-- Either order with the billing Worker. NUMBER: 173 is fix/signup-core-10nov's,
-- 174 left free, 175 given by the main session. Branch fix/signin-thread-10nov.
-- =====================================================================

alter table public.vp_prospects
  add column if not exists signin_code_enc text
  check (signin_code_enc is null or signin_code_enc ~ '^v1\.[A-Za-z0-9_-]{16}\.[0-9a-f]{16}$');
alter table public.vp_prospects
  add column if not exists signin_code_hash text unique
  check (signin_code_hash is null or signin_code_hash ~ '^[0-9a-f]{64}$');
alter table public.vp_signin_links
  add column if not exists short_ok boolean not null default false;

comment on column public.vp_prospects.signin_code_enc is
  'The prospect''s short sign-in letters, sealed by the billing Worker (a handle, never a login key). Migration 175, Dean 6 Nov 2026.';
comment on column public.vp_prospects.signin_code_hash is
  'sha256 of the short letters: finds the prospect a tapped short link belongs to. Migration 175.';
comment on column public.vp_signin_links.short_ok is
  'True only for a one-tap token made to sit behind the prospect''s short link. Migration 175.';

-- READ BACK (expect three rows: signin_code_enc text YES, signin_code_hash text YES, short_ok boolean NO):
--   select table_name, column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and ((table_name = 'vp_prospects' and column_name in ('signin_code_enc', 'signin_code_hash'))
--       or (table_name = 'vp_signin_links' and column_name = 'short_ok'));
-- ROLLBACK (the Worker goes back to a link per send; every link already sent keeps working until it ends):
--   alter table public.vp_prospects drop column if exists signin_code_enc;
--   alter table public.vp_prospects drop column if exists signin_code_hash;
--   alter table public.vp_signin_links drop column if exists short_ok;
