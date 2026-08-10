-- VenuePlay migration 26: per-venue "already asked" memory so trivia questions do not repeat at a
-- venue for at least 12 months (a question recycles 12 months after its last ask). Safe to run more
-- than once. Only the game worker (service role) reads/writes this; RLS on with no policy locks it
-- to the public.
CREATE TABLE IF NOT EXISTS vp_asked_questions (
  venue_id    uuid NOT NULL,
  question_id uuid NOT NULL,
  asked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vp_asked_venue_q    ON vp_asked_questions (venue_id, question_id);
CREATE INDEX IF NOT EXISTS idx_vp_asked_venue_time ON vp_asked_questions (venue_id, asked_at);
ALTER TABLE vp_asked_questions ENABLE ROW LEVEL SECURITY;
