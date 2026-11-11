-- =====================================================================
-- Migration 185: every one-tap sign-in link lasts 90 days from issue
-- ---------------------------------------------------------------------
-- Dean, 10 November 2026 (INBOX 154): "make the sign-in link last 90 days
-- because that's when we delete the data", so everything lines up on one
-- number: the same 90 days as player-data deletion and the "come back
-- within 90 days" cancel line. The billing Worker's VPA_LINK_DAYS (90) is
-- that one number for every link: the prospect welcome, HQ's resend and
-- "Start a fresh 90 days", the Instantly in-thread link and an HQ-onboarded
-- venue's welcome.
--
-- 1. Migration 151 capped a link's life at 31 days (vp_signin_links_life).
--    This lifts it to 92 days: 90, plus one for a welcome booked up to a
--    day ahead (VPA_PROSPECT_MAX_DELAY_MIN), plus one spare. Still one use,
--    still only the hash, still service role only.
-- 2. Links ALREADY ISSUED AND STILL UNUSED are given 90 days from the day
--    they were issued (created_at). "Unused" is used_at is null: a link that
--    was used, or retired because a newer one went (the Worker retires by
--    setting used_at), is not brought back. A link whose 90 days from issue
--    have already passed is left as it is. Nothing is shortened.
--
-- A prospect's window (setup or HQ's last fresh start, plus the days) is
-- worked out by the Worker from VPA_LINK_DAYS on every read, so it needs
-- no change here; the short link (migration 175) follows that window.
--
-- Either order with the billing Worker: before this runs, the Worker asks
-- for 90 days, is refused by 151's cap, and makes a 30 day link instead
-- and prints the days that link really has (vpaMintSigninLinkFor).
--
-- NUMBER: 180 to 184 are taken (184 is help-blocklist; 183 was spoken for
-- by a link-life change that was never committed), checked every branch
-- and worktree 11 Nov 2026, so 185. Branch fix/link-90-days-15nov.
-- NOT RUN.
--
-- RLS-BASELINE.json: no policy or grant changes, so it does not move.
-- =====================================================================

alter table vp_signin_links drop constraint if exists vp_signin_links_life;
alter table vp_signin_links add constraint vp_signin_links_life
  check (expires_at > created_at and expires_at <= created_at + interval '92 days');

update vp_signin_links
   set expires_at = created_at + interval '90 days'
 where used_at is null
   and expires_at < created_at + interval '90 days'
   and created_at + interval '90 days' > now();

-- Read back:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_signin_links_life';
-- expects: CHECK ((expires_at > created_at) AND (expires_at <= (created_at + '92 days'::interval)))
--   select count(*) from vp_signin_links
--    where used_at is null and created_at + interval '90 days' > now()
--      and expires_at <> created_at + interval '90 days'
--      and expires_at < created_at + interval '90 days';
-- expects: 0

-- Rollback (rows longer than 31 days must be cut back first or the old check cannot be put back):
--   update vp_signin_links set expires_at = least(expires_at, created_at + interval '30 days')
--    where expires_at > created_at + interval '31 days';
--   alter table vp_signin_links drop constraint if exists vp_signin_links_life;
--   alter table vp_signin_links add constraint vp_signin_links_life
--     check (expires_at > created_at and expires_at <= created_at + interval '31 days');
