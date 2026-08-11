-- VenuePlay migration 32: let hosts vote a bad question out of the library.
--
-- When a host swaps a question out while building a night, that is a signal. One host doing it
-- means nothing (wrong theme for their crowd, seen it last week). Several DIFFERENT venues doing
-- it means the question is genuinely poor, and it should stop being served to anyone.
--
-- WHY THE KEY IS THE QUESTION TEXT, NOT THE QUESTION ID
-- Library questions are COPIED into each venue's set with fresh ids. Flagging by id would only
-- ever flag that venue's private copy and the library original would keep going out to everyone.
-- So flags key on a normalised form of the question text, which follows the question everywhere.
--
-- Safe to run more than once.

-- Normalise once, in the database, so the Worker and any script agree on what "the same
-- question" means. Lower case, strip punctuation, collapse whitespace.
CREATE OR REPLACE FUNCTION vp_qkey(q text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT trim(regexp_replace(regexp_replace(lower(coalesce(q, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$fn$;

CREATE TABLE IF NOT EXISTS vp_question_flags (
  qkey       text NOT NULL,                       -- vp_qkey(question)
  venue_id   uuid NOT NULL,
  reason     text NOT NULL DEFAULT 'swapped',     -- swapped | reported
  question   text,                                -- kept for review, so we can see what got binned
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (qkey, venue_id, reason)            -- one vote per venue per reason, so a single
);                                                -- venue cannot bin a question on its own

CREATE INDEX IF NOT EXISTS idx_vp_qflags_qkey ON vp_question_flags (qkey);

ALTER TABLE vp_question_flags ENABLE ROW LEVEL SECURITY;   -- service role only, same as the other queues

-- Retiring, rather than deleting. A retired question stays in the table so the weekly review can
-- see what was binned and why, and so it can be brought back if the flags turn out to be noise.
ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS retired_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_vp_questions_retired ON vp_questions (retired_at);

-- How many DIFFERENT venues have to swap a question out before it is pulled.
-- 3 is deliberately low pre-launch so the signal shows up during testing; raise it later.
CREATE OR REPLACE VIEW v_vp_question_flag_counts AS
  SELECT qkey,
         min(question)                AS question,
         count(DISTINCT venue_id)     AS venues,
         max(created_at)              AS last_flagged
  FROM vp_question_flags
  GROUP BY qkey;

-- Called by the Worker after each flag. Retires every copy of a question whose text has been
-- swapped out by enough separate venues. Idempotent: already-retired rows are left alone.
CREATE OR REPLACE FUNCTION vp_retire_flagged(min_venues int DEFAULT 3)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE n int;
BEGIN
  WITH bad AS (
    SELECT qkey FROM v_vp_question_flag_counts WHERE venues >= min_venues
  )
  UPDATE vp_questions q
     SET retired_at = now()
   WHERE q.retired_at IS NULL
     AND vp_qkey(q.question) IN (SELECT qkey FROM bad);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION vp_retire_flagged(int) FROM public;

-- WHAT STILL HAS TO CHANGE IN CODE (not done by this migration):
--   1. handleTriviaSearch must add "&retired_at=is.null" so retired questions stop being served.
--   2. A swap endpoint records the flag and calls vp_retire_flagged().
-- Until then this table simply collects nothing and changes no behaviour, which is why it is
-- safe to run now and wire up after.
