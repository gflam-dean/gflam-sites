-- SYDNEY-01-relock-before-cutover.sql   (version 2)
-- RUN ON SYDNEY ONLY. Not on the live (Singapore) database, which already has all of this.
--
-- WHY VERSION 2. Version 1 was a plain list of REVOKE statements with a note saying that a line
-- erroring with "does not exist" could be skipped. In the Supabase SQL editor you cannot skip a
-- line: the whole script runs as ONE TRANSACTION, so the first missing object rolls back every
-- statement that came before it and the editor still reports a result. Dean ran it, it reported
-- fine, and a probe afterwards showed all eleven paths still wide open. My error, not his.
--
-- So every statement is now wrapped so that a missing object skips THAT line and nothing else.
--
-- WHAT IS WRONG, measured rather than assumed. Sydney was built with pg_dump --schema-only, and
-- Supabase re-grants everything to the public key as each table is created. A schema dump does
-- not carry the REVOKEs that took those grants back. The shape matched perfectly (73 tables,
-- 892 columns, 106 policies, identical) while the PERMISSIONS did not, and nothing in the
-- migration toolkit compares permissions.
--
-- Probed with the actual public key printed in every VenuePlay page:
--
--     vp_bingo_next_ball    Singapore 401 refused     Sydney 200 REACHED IT
--     vp_draw_next_ball     Singapore 401 refused     Sydney 200 REACHED IT
--     v_signups_all         Singapore 401 refused     Sydney 200, real rows
--     vp_players, vp_bingo_draws, ops_questions, ops_approvals, and four more: all 200
--
-- The first two are the server-side bingo ball draw, which is the RNG the OLGR submission is
-- built around. Nothing is live on Sydney yet, so this is a blocker and not an incident.
--
-- SAFE TO RUN TWICE. Everything here is a REVOKE.
-- AFTER RUNNING IT, the last statement prints what anon can still reach. It should be empty.

do $$
declare
  r record;
  -- Functions: revoked by name, whatever their arguments, so a signature that drifted since
  -- the migration was written cannot let one through.
  fns text[] := array[
    'vp_bingo_next_ball','vp_bingo_ball','vp_draw_next_ball','vp_emit_event','vp_park_flagged',
    'vp_host_question','vp_host_reveal','vp_host_staff','vp_member_name','vp_members_draw',
    'vp_player_answer','vp_screen_poll'
  ];
  -- Tables and views that must be invisible to the key in the page.
  shut text[] := array[
    'vp_bingo_draws','vp_bingo_draw_balls','vp_players','vp_venue_screen',
    'v_vp_player_optins','v_vp_prizes_given','v_vp_question_review_queue','v_vp_screen_draws',
    'v_vp_feedback_by_session','v_vp_song_flag_counts','v_signups_all',
    'ops_approvals','ops_questions','ops_priorities'
  ];
  -- The other Gflam sites read these, so SELECT stays and only the write half goes.
  readonly text[] := array['reviews','shows','venues','signups','contacts',
                           'experience','tour_categories','ticket_milestones'];
  n text;
begin
  foreach n in array fns loop
    for r in select p.oid::regprocedure as sig
               from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname = n
    loop
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
      raise notice 'revoked function %', r.sig;
    end loop;
  end loop;

  foreach n in array shut loop
    begin
      execute format('revoke all on public.%I from anon, authenticated', n);
      raise notice 'shut %', n;
    exception when undefined_table then
      raise notice 'skipped %, not on this database', n;
    end;
  end loop;

  foreach n in array readonly loop
    begin
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', n);
      raise notice 'write access removed from %', n;
    exception when undefined_table then
      raise notice 'skipped %, not on this database', n;
    end;
  end loop;

  -- The public sites draw a tour page from these two, so reading stays.
  begin execute 'grant select on public.shows to anon';   exception when undefined_table then null; end;
  begin execute 'grant select on public.reviews to anon'; exception when undefined_table then null; end;
end $$;

-- PostgREST caches what a role may see. Without this the change is real in the database and
-- invisible over the API, which looks exactly like the script having done nothing.
notify pgrst, 'reload schema';

-- PROVE IT. Both of these should come back with NO ROWS.
select 'function still reachable by anon' as problem, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'EXECUTE')
   and p.proname = any (array['vp_bingo_next_ball','vp_bingo_ball','vp_draw_next_ball',
        'vp_emit_event','vp_park_flagged','vp_host_question','vp_host_reveal','vp_host_staff',
        'vp_member_name','vp_members_draw','vp_player_answer','vp_screen_poll'])
union all
select 'table still readable by anon', table_name
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'
   and table_name = any (array['vp_bingo_draws','vp_bingo_draw_balls','vp_players',
        'vp_venue_screen','v_vp_player_optins','v_vp_prizes_given','v_vp_question_review_queue',
        'v_vp_screen_draws','v_vp_feedback_by_session','v_vp_song_flag_counts','v_signups_all',
        'ops_approvals','ops_questions','ops_priorities'])
union all
select 'anon can still WRITE to', table_name
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'
   and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
   and table_name = any (array['reviews','shows','venues','signups','contacts',
        'experience','tour_categories','ticket_milestones']);
