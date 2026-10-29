-- =====================================================================
-- Migration 128: Dean's Yes / No / Edit buttons on the prospect review email
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it BEFORE deploying the
--   billing Worker that carries /autopilot/review. Either order is safe:
--   without this table the Worker answers the Mac "Run migration 128 first",
--   and the Mac sends Dean the review with the command line in it, as before.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
--   authenticated).
--
-- WHY. Dean, 29 Oct 2026: "can they just have a button to say yes no or
-- edit maybe? I can't copy and paste a command every time I get this. It's
-- too much." The prospect autopilot (~/venue-enrich/prospect-autopilot.py)
-- emails Dean one review per interested Instantly reply. Each review now
-- carries three signed links to the billing Worker. The Worker only RECORDS
-- his choice here; the Mac fetches it on its 5-minute run and applies it
-- with its own approve() / reject(), every check included.
--
-- ONE ROW PER PROSPECT FOLDER. round goes up by one when the Mac holds a yes
-- (a check failed) and sends fresh buttons; links from an older round are
-- refused. decision is set once per round (the Worker updates only where
-- decision is null); applied_at is set once (only where it is null).
--
-- WHAT IS STORED. The venue name, their own words and the drafted reply
-- (what Dean reads on the page), his choice, an optional reason, the edited
-- reply, and the browser's user agent string. No address book, no key.
--
-- LOCKED. Only the service role (the billing Worker) reaches a row: RLS on,
-- no policies, and anon/authenticated named in the revoke (Supabase grants
-- them explicitly, so a revoke from public alone does nothing; migration 32).
-- =====================================================================

create table if not exists public.vp_autopilot_reviews (
  folder          text primary key check (folder ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  round           integer not null default 1 check (round between 1 and 1000),
  company         text not null check (char_length(company) <= 200),
  class           text check (class is null or char_length(class) <= 40),
  their_words     text check (their_words is null or char_length(their_words) <= 20000),
  reply           text not null check (char_length(reply) <= 20000),
  mailbox         text check (mailbox is null or char_length(mailbox) <= 200),
  reply_to        text check (reply_to is null or char_length(reply_to) <= 200),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  decision        text check (decision is null or decision in ('yes', 'no', 'edit')),
  decided_at      timestamptz,
  decided_agent   text check (decided_agent is null or char_length(decided_agent) <= 200),
  reason          text check (reason is null or char_length(reason) <= 2000),
  edited_reply    text check (edited_reply is null or char_length(edited_reply) <= 20000),
  applied_at      timestamptz,
  applied_result  text check (applied_result is null or applied_result in ('queued', 'held', 'rejected', 'already', 'failed')),
  applied_note    text check (applied_note is null or char_length(applied_note) <= 2000),
  -- nothing is applied that was never decided, and an edit always carries its text
  constraint vp_autopilot_reviews_applied_needs_decision check (applied_at is null or decision is not null),
  constraint vp_autopilot_reviews_edit_has_text check (decision is distinct from 'edit' or edited_reply is not null)
);
create index if not exists vp_autopilot_reviews_pending_idx
  on public.vp_autopilot_reviews (decided_at) where decision is not null and applied_at is null;

alter table public.vp_autopilot_reviews enable row level security;
revoke all on public.vp_autopilot_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.vp_autopilot_reviews to service_role;

-- Rollback:
--   drop table if exists public.vp_autopilot_reviews;
