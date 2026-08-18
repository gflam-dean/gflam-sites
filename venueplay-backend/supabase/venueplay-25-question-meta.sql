-- VenuePlay migration 25: give each trivia question its own category, difficulty and (optional) image,
-- so the night builder can filter the library by category + difficulty, we can ship themed/difficulty
-- packs, and questions can carry a picture for picture rounds. Safe to run more than once.
--
-- Until now a question's category lived only on its set (one set per category) and difficulty wasn't
-- stored at all. seed-trivia.py now writes these per row; re-run the seed after this migration.

ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS category   text;
ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS difficulty text;   -- 'easy' | 'medium' | 'hard'
ALTER TABLE vp_questions ADD COLUMN IF NOT EXISTS image_url  text;   -- optional; null for a normal text question

-- Indexes so the builder can filter the 37k-row library quickly.
CREATE INDEX IF NOT EXISTS idx_vp_questions_category   ON vp_questions (category);
CREATE INDEX IF NOT EXISTS idx_vp_questions_difficulty ON vp_questions (difficulty);
