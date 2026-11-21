-- =====================================================================
-- Migration 227: the Music trivia set holds only music questions
-- ---------------------------------------------------------------------
-- Jobs 525, real night 20 Nov 2026 (The Mini Bar, ~/venue-enrich/reports/real-night/ddc20247-hand.md):
-- the library set "Music (1822)" asked about rock climbing, Butch Cassidy and a 1903 silent film, twice.
--
-- WHY. The game Worker serves a round only from the set the host picked (hostStartTrivia reads
-- vp_questions set_id=eq.<set>; when the set runs short it recycles the set's own questions, it never
-- borrows another set's). The questions were in the WRONG SET: the seed's theme map
-- (venueplay-backend/seed-trivia.py, now venueplay-backend/trivia_themes.py) matched a keyword anywhere in a
-- category's words, so three fine categories went into Music:
--     "Famous train robberies and bandits"   ("band")   50 in data/trivia-library.json  -> History
--     "Famous rock climbers and cliffs"      ("rock")   49                              -> Sport
--     "Famous canyons and rock formations"   ("rock")   46                              -> Geography
-- The map is fixed in trivia_themes.py (a future reseed or top-up files them right); this moves the rows
-- already in the live library.
--
-- WHAT IT DOES. Only LIBRARY sets (visibility 'library', no owner venue), found by title, each exactly once
-- (it refuses otherwise). Each question keeps its id, words, answers and fine category: it changes set_id and
-- gets a seq after the last one in its new set. So the twelve-month "already asked" memory (by id), past
-- answers and results are untouched. A venue's own nights, and its copies of library questions, are not
-- touched. question_count on the four sets moves by the number moved (whatever it counted before, it counts
-- the same way after). Rounds are drawn by id/seq lists saved at Start round, so a gap left in Music's seqs is
-- harmless; it REFUSES while a trivia round on the Music set is running (run it in the day).
--
-- DATA CHANGE ONLY: no table, column, policy or grant. The code does not depend on it: run it before or
-- after the release, any time no trivia round is running. Safe to run twice (the second run moves nothing).
--
-- WRITTEN, NOT RUN. Not run on TEST, not run on LIVE. Branch sun22/faults-523-525-526.
-- NUMBER: 227 (223, 225, 226 are files on other branches; 224 is held). Main registers it.
-- =====================================================================

begin;

do $$
declare
  s_music uuid; s_history uuid; s_sport uuid; s_geo uuid;
  n_hist int; n_sport int; n_geo int; base int;
begin
  -- exactly one active library set of each title, or nothing happens
  select id into strict s_music   from vp_question_sets where title = 'Music'     and visibility = 'library' and owner_venue_id is null and status = 'active';
  select id into strict s_history from vp_question_sets where title = 'History'   and visibility = 'library' and owner_venue_id is null and status = 'active';
  select id into strict s_sport   from vp_question_sets where title = 'Sport'     and visibility = 'library' and owner_venue_id is null and status = 'active';
  select id into strict s_geo     from vp_question_sets where title = 'Geography' and visibility = 'library' and owner_venue_id is null and status = 'active';

  if exists (select 1 from vp_trivia_games tg join vp_games g on g.id = tg.game_id
              where tg.question_set_id = s_music and g.status = 'running') then
    raise exception 'A trivia round on the Music set is running. Nothing was changed. Run this when no round is on.';
  end if;

  -- History: the train robbers and bandits
  select coalesce(max(seq), 0) into base from vp_questions where set_id = s_history;
  update vp_questions q set set_id = s_history, seq = base + m.rn
    from (select id, row_number() over (order by seq, id) as rn from vp_questions
           where set_id = s_music and lower(btrim(category)) = 'famous train robberies and bandits') m
   where q.id = m.id;
  get diagnostics n_hist = row_count;

  -- Sport: the rock climbers
  select coalesce(max(seq), 0) into base from vp_questions where set_id = s_sport;
  update vp_questions q set set_id = s_sport, seq = base + m.rn
    from (select id, row_number() over (order by seq, id) as rn from vp_questions
           where set_id = s_music and lower(btrim(category)) = 'famous rock climbers and cliffs') m
   where q.id = m.id;
  get diagnostics n_sport = row_count;

  -- Geography: the canyons and rock formations
  select coalesce(max(seq), 0) into base from vp_questions where set_id = s_geo;
  update vp_questions q set set_id = s_geo, seq = base + m.rn
    from (select id, row_number() over (order by seq, id) as rn from vp_questions
           where set_id = s_music and lower(btrim(category)) = 'famous canyons and rock formations') m
   where q.id = m.id;
  get diagnostics n_geo = row_count;

  update vp_question_sets set question_count = greatest(0, coalesce(question_count, 0) - (n_hist + n_sport + n_geo)) where id = s_music;
  update vp_question_sets set question_count = coalesce(question_count, 0) + n_hist  where id = s_history;
  update vp_question_sets set question_count = coalesce(question_count, 0) + n_sport where id = s_sport;
  update vp_question_sets set question_count = coalesce(question_count, 0) + n_geo   where id = s_geo;

  raise notice 'moved out of Music: % to History, % to Sport, % to Geography', n_hist, n_sport, n_geo;
end $$;

commit;

-- Read back (read only). The first should be 0 rows; the second shows where the three categories are now.
--   select q.category, count(*) from vp_questions q join vp_question_sets s on s.id = q.set_id
--    where s.title = 'Music' and s.visibility = 'library' and s.owner_venue_id is null
--      and lower(btrim(q.category)) in ('famous train robberies and bandits', 'famous rock climbers and cliffs', 'famous canyons and rock formations')
--    group by 1;
--   select s.title, q.category, count(*) from vp_questions q join vp_question_sets s on s.id = q.set_id
--    where s.visibility = 'library' and s.owner_venue_id is null
--      and lower(btrim(q.category)) in ('famous train robberies and bandits', 'famous rock climbers and cliffs', 'famous canyons and rock formations')
--    group by 1, 2 order by 1, 2;
--   select title, question_count from vp_question_sets
--    where visibility = 'library' and owner_venue_id is null and title in ('Music', 'History', 'Sport', 'Geography');
