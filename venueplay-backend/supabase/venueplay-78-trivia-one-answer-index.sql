-- =====================================================================
-- Migration 78: one answer per player per question, written down
-- ---------------------------------------------------------------------
--   Safe to run anywhere, any number of times. On the live and Sydney
--   databases it is already a no-op: the index is ALREADY THERE on both,
--   checked 10 Sep 2026. This file exists so that it survives.
--
-- WHY THIS FILE EXISTS AT ALL. The index was created by hand. It was in
-- both databases and in NO migration, so it existed only as long as
-- nobody rebuilt from this repo. Rebuild, and the duplicate guard quietly
-- disappears: no error, no failed deploy, just a trivia night where a
-- punter who taps twice is scored twice and wins a meat tray they did not
-- earn. This is the same shape as the fault at the top of MIGRATIONS.md,
-- where main shipped code reading four columns that only ever existed
-- because of a branch.
--
-- WHAT IT GUARDS. vp_player_answer (migration 71) leans on this index:
-- it inserts on conflict do nothing and reports back whether the row
-- landed, which is how a phone is told "you have already answered" rather
-- than being scored a second time. Without the index there is no conflict
-- to detect, so the guard reports success every time and the second answer
-- goes in. The room server (phase 2, 10 Sep) holds answers and hands them
-- over in ONE insert at Reveal, which makes this MORE important, not less:
-- a whole question's answers now arrive together, and this is what stops a
-- retried hand-over from doubling every score in the room.
--
-- IF IT REFUSES TO INSTALL, you have real duplicates. Do not drop the
-- index or widen it. Find them first, because each one is a score that
-- was counted twice, and decide which row is the real one:
--
--   select game_id, question_id, player_id, count(*)
--     from public.vp_trivia_answers
--    group by 1,2,3 having count(*) > 1;
-- =====================================================================

-- Column for column the same as the index already live, so this cannot
-- create a second index that means something slightly different.
create unique index if not exists vp_trivia_answers_one_per_player_question
  on public.vp_trivia_answers using btree (game_id, question_id, player_id);

-- Say what happened rather than finishing silently.
do $$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public'
                and indexname = 'vp_trivia_answers_one_per_player_question') then
    raise notice 'ok: one answer per player per question is enforced by the database';
  else
    raise exception 'the index is not there after running this. Do not paste a Worker that trusts it.';
  end if;
end $$;
