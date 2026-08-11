-- VenuePlay migration 32: hosts flag a weak question, and we IMPROVE it rather than bin it.
--
-- When a host swaps a question out while building a night, that is a signal. One host means
-- nothing (wrong theme for their crowd, they saw it last week). Five DIFFERENT venues means the
-- question itself is the problem.
--
-- We do not delete those. A question five rooms rejected is usually fixable: an ambiguous answer,
-- a dated reference, a badly worded stem. So at five flags it is PARKED (pulled from circulation
-- so it stops going out while it is wrong) and lands in the weekly review queue to be rewritten
-- and put back.
--
-- WHY THE KEY IS THE QUESTION TEXT, NOT THE ID
-- Library questions are COPIED into each venue's set with fresh ids. Flagging by id would only
-- flag that venue's private copy while the library original kept going out to everyone.
--
-- RUN THIS IN TWO PARTS. The Supabase SQL editor splits on semicolons and mishandles dollar
-- quoting, so each function is tagged separately and is meant to be run on its own.
-- Safe to run more than once.

-- ============================ PART 1 ============================
CREATE TABLE IF NOT EXISTS vp_question_flags (
  qkey       text NOT NULL,                       -- normalised question text
  venue_id   uuid NOT NULL,
  reason     text NOT NULL DEFAULT 'swapped',     -- swapped | reported
  question   text,                                -- kept so the review queue can show it
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (qkey, venue_id, reason)            -- one vote per venue, so no venue acts alone
);

CREATE INDEX IF NOT EXISTS idx_vp_qflags_qkey ON vp_question_flags (qkey);
ALTER TABLE vp_question_flags ENABLE ROW LEVEL SECURITY;

-- Parked, not retired: it is coming back once it has been rewritten.
ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS parked_at    timestamptz;
ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS improved_at  timestamptz;
CREATE INDEX IF NOT EXISTS idx_vp_questions_parked ON vp_questions (parked_at);

-- ============================ PART 2 ============================
CREATE OR REPLACE FUNCTION vp_qkey(q text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $qkey$
  SELECT trim(regexp_replace(regexp_replace(lower(coalesce(q, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$qkey$;

-- ============================ PART 3 ============================
-- The weekly worklist: what venues are rejecting, worst first, with the question in front of you
-- so it can be rewritten on the spot. Anything on 3 or 4 is the interesting part, it is on the way
-- out and can still be saved.
CREATE OR REPLACE VIEW v_vp_question_review_queue AS
  SELECT f.qkey,
         min(f.question)            AS question,
         count(DISTINCT f.venue_id) AS venues,
         max(f.created_at)          AS last_flagged
  FROM vp_question_flags f
  GROUP BY f.qkey
  ORDER BY count(DISTINCT f.venue_id) DESC, max(f.created_at) DESC;

-- ============================ PART 4 ============================
CREATE OR REPLACE FUNCTION vp_park_flagged(min_venues int DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $park$
DECLARE n integer;
BEGIN
  WITH bad AS (
    SELECT qkey FROM v_vp_question_review_queue WHERE venues >= min_venues
  )
  UPDATE vp_questions q
     SET parked_at = now()
   WHERE q.parked_at IS NULL
     AND vp_qkey(q.question) IN (SELECT qkey FROM bad);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$park$;

REVOKE ALL ON FUNCTION vp_park_flagged(integer) FROM public;

-- STILL TO WIRE UP IN CODE (not done by this migration):
--   1. handleTriviaSearch adds "&parked_at=is.null" so parked questions stop being served.
--   2. The swap endpoint records the flag and calls vp_park_flagged().
--   3. The weekly review reads v_vp_question_review_queue, rewrites them, clears parked_at and
--      stamps improved_at, and the question goes back into circulation.
-- Until then this collects nothing and changes no behaviour.
