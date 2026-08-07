-- VenuePlay migration 27: review queue for host-written trivia questions. When a host writes their
-- own questions, a copy lands here; the weekly run fact-checks + improves them and promotes the good
-- ones into the shared library. Safe to run more than once. Only the game worker (service role)
-- reads/writes this; RLS on with no policy locks it to the public.
CREATE TABLE IF NOT EXISTS vp_question_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid,
  question      text NOT NULL,
  options       jsonb NOT NULL,
  correct_index int NOT NULL,
  category      text,
  difficulty    text,
  image_url     text,
  status        text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | review
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_vp_subs_status ON vp_question_submissions (status, created_at);
ALTER TABLE vp_question_submissions ENABLE ROW LEVEL SECURITY;
