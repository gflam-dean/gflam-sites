-- =====================================================================
-- Migration 170: the no-card start's sign-up attempts (vp_signup_starts)
-- ---------------------------------------------------------------------
-- Dean, 5 Nov 2026 (INBOX 80B, 81, 60, 61): a public "Have a play, free"
-- start on the offer page. Five boxes (venue, postcode, name, mobile,
-- email), a 6-digit code texted to the mobile, then:
--   - the venue is on our licensed venues list (171): the same card-free
--     prospect account HQ makes (10 players, free month from the first
--     sign-in, card later);
--   - it is not: NO account and NO free month. HQ gets a ticket and
--     approves in one tap (POST /admin/signup-start/decide);
--   - the same venue is on another account (item 60): nothing made, a
--     ticket for Dean;
--   - the mobile already signs in (item 61, proven by the code): the new
--     venue joins THAT account, one bill, through Add a venue's own code.
--
-- ONE ROW PER ATTEMPT holds what they typed and the code's HASH (never the
-- code), so the text code is checked before anything else is made. It is
-- not an account: no login, no venue, no free month comes from a row here.
--
-- Service role only (RLS on, no policies, nothing granted to anon or
-- authenticated). The page never reads it: the billing Worker's /start/*
-- routes do, rate-limited per network and per mobile.
--
-- It also lets vp_prospects.source say 'self' (a self sign-up), next to
-- 'hq' and 'autopilot' (migration 125), so HQ > Prospects tells them apart.
--
-- NUMBER: 166 and 167 are prospect details, 168 is reserved, 169 is the
-- library questions, so 170. Branch fix/signup-core-10nov. NOT RUN.
--
-- ORDER: run BEFORE the billing Worker that carries /start. Before it runs,
-- /start answers "not switched on yet" (503) and makes nothing; every other
-- route is unchanged.
--
-- RLS-BASELINE.json: one new table with RLS on and no policy or grant.
-- After running, dump it (python3 venueplay-backend/tools/dump-rls-baseline.py)
-- and commit the diff, as the repo's process says.
-- =====================================================================

create table if not exists public.vp_signup_starts (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  ip_key            text check (ip_key is null or char_length(ip_key) <= 80),
  venue_name        text not null check (char_length(venue_name) between 1 and 120),
  venue_key         text not null check (char_length(venue_key) between 1 and 160),
  postcode          text not null check (postcode ~ '^[0-9]{4}$'),
  au_state          text check (au_state is null or au_state in ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT')),
  contact_name      text not null check (char_length(contact_name) between 1 and 120),
  email             text not null check (char_length(email) between 3 and 200),
  mobile            text not null check (mobile ~ '^\+614[0-9]{8}$'),
  -- the code: its SHA-256 (salted with the row id), when it stops working, how many wrong tries
  code_hash         text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at   timestamptz,
  code_sent_count   smallint not null default 0 check (code_sent_count between 0 and 20),
  attempts          smallint not null default 0 check (attempts between 0 and 50),
  -- which number the code went to: 'typed' (their mobile) or 'known' (the mobile already on the
  -- login that holds the email they typed, item 61)
  code_to           text not null default 'typed' check (code_to in ('typed', 'known')),
  verified_at       timestamptz,
  known_login_id    uuid,
  outcome           text not null default 'pending' check (outcome in
                      ('pending',        -- code not typed yet
                       'made',           -- a licensed venue: the account was made
                       'joined',         -- a known person: the venue joined their account
                       'held_unlisted',  -- not on the licensed list: waiting for HQ
                       'held_same_venue',-- on another account: ticket for Dean (item 60)
                       'held_known',     -- a known mobile or email that could not be joined here: ticket
                       'yours',          -- the venue is already on their own account
                       'check_email',    -- the email signs in elsewhere: a sign-in link went to it
                       'approved',       -- HQ approved a held one: the account was made
                       'refused')),      -- HQ said no
  venue_id          uuid references public.vp_venues(id) on delete set null,
  founding_id       uuid,
  ticket_no         integer,
  licensed_match    text check (licensed_match is null or char_length(licensed_match) <= 200),
  decided_at        timestamptz,
  decided_label     text check (decided_label is null or char_length(decided_label) <= 120)
);
create index if not exists vp_signup_starts_mobile_idx on public.vp_signup_starts (mobile, created_at desc);
create index if not exists vp_signup_starts_email_idx  on public.vp_signup_starts (email, created_at desc);
create index if not exists vp_signup_starts_venue_idx  on public.vp_signup_starts (venue_key, postcode);
create index if not exists vp_signup_starts_held_idx   on public.vp_signup_starts (outcome, created_at desc);

alter table public.vp_signup_starts enable row level security;
revoke all on public.vp_signup_starts from public, anon, authenticated;
grant select, insert, update, delete on public.vp_signup_starts to service_role;

comment on table public.vp_signup_starts is
  'The no-card start (/start): one row per sign-up attempt, the text code as a hash, and what came of it. Not an account. Service role only. Migration 170.';

-- vp_prospects.source may now be 'self' (a venue that signed itself up).
alter table public.vp_prospects drop constraint if exists vp_prospects_source_check;
alter table public.vp_prospects add constraint vp_prospects_source_check check (source in ('hq', 'autopilot', 'self'));

-- Read back (read-only):
--   select relname, relrowsecurity from pg_class where relname = 'vp_signup_starts';
--   expects one row, relrowsecurity = true.
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'vp_signup_starts' and grantee in ('anon', 'authenticated');
--   expects NO rows.
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_prospects_source_check';
--   expects CHECK ((source = ANY (ARRAY['hq'::text, 'autopilot'::text, 'self'::text]))).

-- Rollback (deletes every sign-up attempt; no account is held in it):
--   drop table if exists public.vp_signup_starts;
--   alter table public.vp_prospects drop constraint if exists vp_prospects_source_check;
--   alter table public.vp_prospects add constraint vp_prospects_source_check check (source in ('hq', 'autopilot'));
--   (only once no vp_prospects row has source 'self')
