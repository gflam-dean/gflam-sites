-- =====================================================================
-- Migration 151: a prospect's sign-in link lasts 30 days from setup
-- ---------------------------------------------------------------------
-- Dean, 4 November 2026, the two prospect journeys. A prospect who never
-- signs in gets "here's your sign-in link again" on day 3 and "your free
-- trial link expires in 3 days" on day 27, and both say a true number of
-- days. For that, the link in the welcome and every link resent to them
-- must END AT THE SAME MOMENT: 30 days after vp_prospects.created_at.
--
-- Migration 123 capped a link's life at 15 days (vp_signin_links_life).
-- This lifts the cap to 31 days. Nothing else changes on that table: still
-- one use, still only the hash, still service role only.
--
-- And ONE column on vp_prospects, link_from: when HQ last resent their
-- link. Dean, 4 Nov 2026: an HQ resend by Dean or staff starts a fresh 30
-- days from the resend, with the journey-1 follow-ups re-dated from there;
-- the automatic follow-ups never reset it. Null means "count from setup". Until this has run the
-- billing Worker makes the ordinary 14 day link instead and prints the
-- days that link really has (vpaMintSigninLinkFor), so nothing is wrong
-- either side of it, only shorter.
--
-- NUMBER: 140 to 150 are taken (other branches and this one), so 151.
-- Branch fix/console-hq-5nov. NOT RUN.
--
-- RLS-BASELINE.json: no policy or grant changes (the baseline lists those,
-- not columns), so it does not move.
-- =====================================================================

alter table vp_signin_links drop constraint if exists vp_signin_links_life;
alter table vp_signin_links add constraint vp_signin_links_life
  check (expires_at > created_at and expires_at <= created_at + interval '31 days');

alter table vp_prospects add column if not exists link_from timestamptz;
comment on column vp_prospects.link_from is
  'When HQ last resent this prospect''s sign-in link: their 30 days and the follow-up emails count from here (null: from created_at). Automatic follow-ups never set it.';

-- Read back:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_signin_links_life';
-- expects: CHECK ((expires_at > created_at) AND (expires_at <= (created_at + '31 days'::interval)))

-- Rollback (every live row is at most 15 days old in life until the Worker is deployed; after that,
-- rows longer than 15 days must be retired first or the old check cannot be put back):
--   update vp_signin_links set used_at = now() where used_at is null and expires_at > created_at + interval '15 days';
--   alter table vp_signin_links drop constraint if exists vp_signin_links_life;
--   alter table vp_signin_links add constraint vp_signin_links_life
--     check (expires_at > created_at and expires_at <= created_at + interval '15 days');
--   alter table vp_prospects drop column if exists link_from;
