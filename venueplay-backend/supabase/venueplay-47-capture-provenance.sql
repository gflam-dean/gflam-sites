-- =====================================================================
-- Migration 47: record where a player capture came from
-- ---------------------------------------------------------------------
-- POST /capture cannot be authenticated today. Broadcast bingo has no session
-- and no player token, so the only thing to check is a venue code derived from
-- the venue's PUBLIC slug: anyone can post a forged capture, including a forged
-- marketing_optin carrying a consent timestamp. That is a Spam Act problem for
-- the VENUE, whose list it lands in and who mails from it.
--
-- The real fix is the broadcast signing designed in migration 38 and never
-- built. Until that lands, record the origin of every capture so a poisoned
-- list can be found and cleaned rather than quietly mailed. Hashed with the
-- same IP hash the rate limiter uses, so this adds no new personal data.
--
-- The Worker writes this column if it exists and silently omits it if it does
-- not, so it is safe to run this before or after the Worker is pasted. A
-- player's details are never lost to a schema mismatch.
-- =====================================================================

alter table vp_captures
  add column if not exists source_ip_hash text;

comment on column vp_captures.source_ip_hash is
  'Salted hash of the submitting IP, for spotting forged or bulk-inserted captures. Not personal data on its own, and never shown to a venue. Set by POST /capture; null on rows written before migration 47.';

create index if not exists vp_captures_ip_idx on vp_captures (source_ip_hash) where source_ip_hash is not null;

-- Find a suspicious burst:
--   select source_ip_hash, venue_id, count(*), min(created_at), max(created_at)
--     from vp_captures where source_ip_hash is not null
--    group by 1,2 having count(*) > 20 order by 3 desc;
