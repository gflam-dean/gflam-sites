-- =====================================================================
-- Migration 40: take unfit trivia off the pub screen
-- ---------------------------------------------------------------------
-- Two separate problems in the live question bank, both of which a venue
-- would have had to explain to a room.
--
-- 1. Six questions carried a machine-written WRONG answer built on "poof",
--    which in an Australian pub reads as a slur, not a magic word. The
--    questions themselves are fine and the correct answer was never the
--    offending option, so the distractor is replaced rather than the question
--    withdrawn.
--
-- 2. Five questions are not usable at all: one asks the room to rank which
--    kind of person is most likely to take their own life, two are crude, and
--    two quote profanity in the question text itself. These are PARKED, not
--    deleted, which is what parked_at is for: they can be rewritten and
--    brought back. Migration 32 added parked_at but nothing ever filtered on
--    it, so parking did nothing until now; the game Worker now excludes
--    parked questions from both round selection and the library search.
--
-- Deliberately NOT a reseed. This edits the rows that are already there.
-- Safe to run more than once.
-- =====================================================================

-- 1. Replace the six slur distractors. options is jsonb, so this rewrites
--    just the one array entry and leaves correct_index untouched.
update vp_questions set options = replace(options::text, '"Vanishing Von Poof"', '"Charles Sturt"')::jsonb
 where options::text like '%"Vanishing Von Poof"%';
update vp_questions set options = replace(options::text, '"Poofing"', '"Misdirection"')::jsonb
 where options::text like '%"Poofing"%';
update vp_questions set options = replace(options::text, '"Poof the Fog Fella"', '"Beast"')::jsonb
 where options::text like '%"Poof the Fog Fella"%';
update vp_questions set options = replace(options::text, '"Poof bread"', '"Roti"')::jsonb
 where options::text like '%"Poof bread"%';
update vp_questions set options = replace(options::text, '"Poofdust"', '"Kumkum"')::jsonb
 where options::text like '%"Poofdust"%';
update vp_questions set options = replace(options::text, '"Pierre le Poof"', '"Harry Kellar"')::jsonb
 where options::text like '%"Pierre le Poof"%';

-- 2. Park the five unusable questions. parked_at is set, nothing is deleted.
update vp_questions set parked_at = now()
 where parked_at is null and question in (
   'According to statistics, which of the following people is most likely to commit suicide?',
   'Which character from the movie The Crow delivered the following words: Caw! Caw! Bang! Fuck, I''m dead!”?',
   'Why don''t you wish in one hand and s**t in the other. See which one fills up first is a line from which movie?',
   'When Seth, one of the main characters in the movie Superbad, was younger, he had an obsession with drawing what?',
   'Which character from the movie Next Friday delivers the following line: Fat bitches need love too, Craig!?'
 );

-- Check what this did:
--   select question, parked_at from vp_questions where parked_at is not null;
--   select question, options from vp_questions where options::text ilike '%poof%';
-- The second should return no rows.
