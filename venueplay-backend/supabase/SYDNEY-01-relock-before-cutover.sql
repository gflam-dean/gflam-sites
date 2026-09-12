-- SYDNEY-01-relock-before-cutover.sql
-- RUN THIS ON SYDNEY ONLY. Not on the live (Singapore) database, which already has all of it.
--
-- WHAT IS WRONG, measured on 12 September 2026 rather than assumed.
--
-- The Sydney copy was built with pg_dump --schema-only. Supabase re-grants everything to the
-- public key on every table as it is created, and a schema dump does not carry the REVOKE
-- statements that took those grants away again. So the shape matched perfectly (73 tables,
-- 892 columns, 106 policies, all identical) while the PERMISSIONS did not, and nothing in the
-- migration toolkit compares permissions. check-databases-match.py says "Sydney has everything
-- live has" and it is telling the truth about the only thing it looks at.
--
-- PROVED, with the actual public key that is printed in every VenuePlay page:
--
--     vp_bingo_next_ball    Singapore 401 refused     Sydney 200 REACHED IT
--     vp_draw_next_ball     Singapore 401 refused     Sydney 200 REACHED IT
--     v_signups_all         Singapore 401 refused     Sydney 200, real signup rows returned
--     vp_players            Singapore 401 refused     Sydney 200
--     vp_bingo_draws        Singapore 401 refused     Sydney 200
--     ops_questions         Singapore 401 refused     Sydney 200
--
-- The first two are the server-side bingo ball draw. That is the RNG the OLGR submission is
-- built around, and on Sydney anyone holding the key out of the page source can call it.
--
-- NOTHING IS LIVE ON SYDNEY YET, so this is not an incident. It is a blocker: cut over without
-- running this and it becomes one in the same minute.
--
-- SAFE TO RUN TWICE. Every statement is a REVOKE; re-running takes away what is already gone.
-- IF A LINE ERRORS with "does not exist", that object is not on Sydney and the line can be
-- skipped: it means there is less to take away, not more.
--
-- AFTERWARDS, PROVE IT rather than trusting this file. The check at the bottom of this file
-- lists what anon can still reach; it should come back empty.

-- ---------------------------------------------------------------- functions
-- The ball draw and the one-trip host routes. Service role only: the Workers call these with
-- the service key, and nothing in a browser has any business reaching them.
revoke all on function public.vp_bingo_next_ball(uuid)                     from public, anon, authenticated;
revoke all on function public.vp_bingo_ball(uuid, uuid, int)               from public, anon, authenticated;
revoke all on function public.vp_draw_next_ball(uuid)                      from public, anon, authenticated;
revoke all on function public.vp_emit_event(uuid, text, jsonb, text)       from public, anon, authenticated;
revoke all on function public.vp_park_flagged(integer)                     from public, anon, authenticated;
revoke all on function public.vp_host_question(uuid, uuid)                 from public, anon, authenticated;
revoke all on function public.vp_host_reveal(uuid, uuid)                   from public, anon, authenticated;
revoke all on function public.vp_host_staff(uuid, uuid)                    from public, anon, authenticated;
revoke all on function public.vp_member_name(text, text, text)             from public, anon, authenticated;
revoke all on function public.vp_members_draw(uuid, uuid, bigint[], int, int, int) from public, anon, authenticated;
revoke all on function public.vp_player_answer(text, uuid, int, int)       from public, anon, authenticated;
revoke all on function public.vp_screen_poll(text, text, text)             from public, anon, authenticated;

-- ---------------------------------------------------------------- the draw tables
revoke all on public.vp_bingo_draws      from public, anon, authenticated;
revoke all on public.vp_bingo_draw_balls from public, anon, authenticated;

-- ---------------------------------------------------------------- the views that carry people
-- Opt-ins, prizes, feedback and the review queue all hold a player's own details.
revoke all on public.v_vp_player_optins         from anon, authenticated;
revoke all on public.v_vp_prizes_given          from anon;
revoke all on public.v_vp_question_review_queue from anon, authenticated;
revoke all on public.v_vp_screen_draws          from anon, authenticated;
revoke all on public.v_vp_feedback_by_session   from anon, authenticated;
revoke all on public.v_vp_song_flag_counts      from anon, authenticated;
revoke all on public.vp_venue_screen            from anon, authenticated;
revoke all on public.v_signups_all              from anon, authenticated;

-- ---------------------------------------------------------------- the ops tables
-- These are Dean's own approval queue and they were open to the public key on Sydney with
-- FULL WRITE. On live, anon has nothing here at all.
revoke all on public.ops_approvals  from anon, authenticated;
revoke all on public.ops_questions  from anon, authenticated;
revoke all on public.ops_priorities from anon, authenticated;

-- ---------------------------------------------------------------- the other sites' tables
-- Sydney handed anon DELETE, INSERT, UPDATE and TRUNCATE on these. Live gives SELECT where a
-- page needs it and nothing else. Taking the write half away; re-grant select below.
revoke insert, update, delete, truncate, references, trigger on public.reviews  from anon;
revoke insert, update, delete, truncate, references, trigger on public.shows    from anon;
revoke insert, update, delete, truncate, references, trigger on public.venues   from anon;
revoke insert, update, delete, truncate, references, trigger on public.signups  from anon;
revoke insert, update, delete, truncate, references, trigger on public.contacts from anon;

-- The public sites READ shows and reviews to draw a tour page, so that stays.
grant select on public.shows   to anon;
grant select on public.reviews to anon;

-- ---------------------------------------------------------------- PROVE IT
-- Run this after the statements above. It should return NO ROWS. Anything it lists is still
-- reachable by the key printed in every page.
--
--   select table_schema, table_name, privilege_type
--     from information_schema.role_table_grants
--    where grantee = 'anon'
--      and table_schema = 'public'
--      and (privilege_type <> 'SELECT'
--           or table_name in ('vp_players','vp_bingo_draws','ops_questions','ops_approvals',
--                             'v_signups_all','v_vp_player_optins','v_vp_prizes_given',
--                             'v_vp_screen_draws','v_vp_question_review_queue'))
--    order by table_name, privilege_type;
--
-- And the functions, which should list none:
--
--   select p.proname
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and has_function_privilege('anon', p.oid, 'EXECUTE')
--    order by 1;
