-- 97: A PAPER NIGHT DOES NOT BROADCAST THE LEADERBOARD EITHER. Review, 28 Sep 2026: migration 94 took
-- the correct answer out of the public trivia.reveal event on a paper night (config.defer_reveal), but
-- the event still carried the full leaderboard after every question, and a team's total going up or
-- not is the answer by another name for anyone technical on the channel. Identical to the live
-- definition (96) except the deferred event omits 'leaderboard'. The console still gets the board in
-- its own reply and broadcasts it itself at the end of the round, and /player/score already holds
-- scores until then (27 Sep). Worker fallback changed to match. Rollback: re-run 96.

CREATE OR REPLACE FUNCTION public.vp_host_reveal(p_game_id uuid, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_game     record;
  v_session  record;
  v_who      jsonb;
  v_tg       record;
  v_q        record;
  v_cfg      jsonb;
  v_base     int;
  v_secs     int;
  v_bonus    boolean;
  v_options  jsonb;
  v_nopts    int;
  v_already  boolean;
  v_raced    boolean := false;
  v_rows     int;
  v_split    jsonb;
  v_board    jsonb;
  v_ends     timestamptz;   -- 93: the deadline the question was ASKED with
  v_mult     int := 1;      -- 96: 2 on a double points question
begin
  select g.id, g.session_id, g.status, g.format, g.config into v_game
    from public.vp_games g where g.id = p_game_id;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  if v_game.format <> 'trivia' then return jsonb_build_object('status', 'not_trivia'); end if;

  select s.id, s.venue_id, s.status into v_session
    from public.vp_sessions s where s.id = v_game.session_id;
  if not found then return jsonb_build_object('status', 'no_session'); end if;

  v_who := public.vp_host_staff(p_auth_user_id, v_session.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;

  if v_game.status <> 'running' then return jsonb_build_object('status', 'not_running'); end if;
  if v_session.status in ('finished', 'cancelled') then return jsonb_build_object('status', 'session_closed'); end if;

  select t.question_set_id, t.current_seq, t.phase, t.question_ends_at into v_tg
    from public.vp_trivia_games t where t.game_id = p_game_id;
  if not found then return jsonb_build_object('status', 'not_trivia'); end if;
  if coalesce(v_tg.current_seq, 0) = 0 then return jsonb_build_object('status', 'no_question'); end if;

  -- Close the question FIRST, then score it.
  v_already := (v_tg.phase = 'revealed');
  if not v_already then
    update public.vp_trivia_games t set phase = 'revealed'
     where t.game_id = p_game_id and t.phase = 'asking';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then v_already := true; v_raced := true; end if;   -- another reveal is flipping it right now
  end if;

  select q.id, q.options, q.correct_index, q.points, q.time_limit_s into v_q
    from public.vp_questions q
   where q.set_id = v_tg.question_set_id and q.seq = v_tg.current_seq
   limit 1;
  if not found then return jsonb_build_object('status', 'no_question_row'); end if;

  v_cfg := coalesce(v_game.config, '{}'::jsonb);
  v_base := case when v_cfg ? 'base_points' and jsonb_typeof(v_cfg->'base_points') = 'number'
                 then (v_cfg->>'base_points')::int else coalesce(nullif(v_q.points, 0), 100) end;
  v_secs := case when v_cfg ? 'time_limit_s' and jsonb_typeof(v_cfg->'time_limit_s') = 'number'
                 then (v_cfg->>'time_limit_s')::int else coalesce(nullif(v_q.time_limit_s, 0), 20) end;
  v_bonus := (v_cfg->'speed_bonus') is distinct from 'false'::jsonb;
  v_options := case when jsonb_typeof(v_q.options) = 'array' then v_q.options else '[]'::jsonb end;
  v_nopts := jsonb_array_length(v_options);
  -- 96: DOUBLE POINTS. The Worker lists the doubled questions (by seq) on the game when it starts,
  -- from the venue's saved setting. Everything a correct answer earns on one of them, speed bonus
  -- included, counts twice.
  if jsonb_typeof(v_cfg->'double_seqs') = 'array' and (v_cfg->'double_seqs') @> to_jsonb(v_tg.current_seq) then
    v_mult := 2;
  end if;

  -- 93: THE BONUS IS MEASURED AGAINST THE WINDOW THE QUESTION WAS ASKED WITH. Time the host added
  -- (config.time_added {seq, ms}, written by /host/question/add-time) lets late answers count but
  -- must not make an answer at second ten look like one at second zero. The Worker's fallback has
  -- always subtracted it; this one-trip reveal, which production runs, never did (live play-test
  -- 27 Sep 2026: a 125-point answer scored 150, the audit fault of 20 Sep).
  v_ends := v_tg.question_ends_at;
  if v_ends is not null and jsonb_typeof(v_cfg->'time_added') = 'object'
     and jsonb_typeof(v_cfg->'time_added'->'seq') = 'number'
     and jsonb_typeof(v_cfg->'time_added'->'ms') = 'number'
     and (v_cfg->'time_added'->>'seq')::int = v_tg.current_seq
     and (v_cfg->'time_added'->>'ms')::numeric > 0 then
    v_ends := v_ends - make_interval(secs => (v_cfg->'time_added'->>'ms')::numeric / 1000);
  end if;

  -- Score every UNSCORED answer in one statement. The loser of the compare-and-set above
  -- scores nothing: the winner is scoring this same set at this moment.
  if not v_raced then
    update public.vp_trivia_answers a
       set is_correct = (a.answer_index = v_q.correct_index),
           points_awarded = case
             when a.answer_index <> v_q.correct_index then 0
             else v_mult * (v_base + case
               when v_bonus and v_ends is not null and v_secs > 0 then
                 round((v_base * 0.5 * (
                   least(v_secs::numeric, greatest(0::numeric,
                     extract(epoch from (v_ends - a.answered_at))::numeric))
                   / v_secs::numeric))::numeric)::int
               else 0 end)
           end
     where a.game_id = p_game_id and a.question_id = v_q.id and a.is_correct is null;
  end if;

  -- Answer distribution: one count per option, in option order.
  select coalesce(jsonb_agg(coalesce(c.n, 0) order by i.i), '[]'::jsonb) into v_split
    from generate_series(0, greatest(v_nopts, 0) - 1) as i(i)
    left join (
      select a.answer_index, count(*)::int as n
        from public.vp_trivia_answers a
       where a.game_id = p_game_id and a.question_id = v_q.id
       group by a.answer_index
    ) c on c.answer_index = i.i;

  -- Running totals, top 50, from the same view the Worker read.
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(l.display_name, 'Player'), 'points', coalesce(l.points, 0)) order by l.points desc), '[]'::jsonb)
    into v_board
    from (select b.display_name, b.points from public.v_vp_trivia_leaderboard b
           where b.game_id = p_game_id order by b.points desc limit 50) l;

  -- PUBLIC broadcast: now it is safe to send correct_index. EXCEPT on a paper night (94): the paper
  -- teams have not handed in, and any phone in the room reads this event. The host's own reply below
  -- still carries the answer; the console puts it up at the end of the round.
  if (v_cfg->'defer_reveal') = 'true'::jsonb then
    perform public.vp_emit_event(v_session.id, 'trivia.reveal', jsonb_build_object(
      'qseq', v_tg.current_seq, 'options', v_options, 'deferred', true
    ), v_who->>'actor');
  else
    perform public.vp_emit_event(v_session.id, 'trivia.reveal', jsonb_build_object(
      'qseq', v_tg.current_seq, 'correct_index', v_q.correct_index,
      'options', v_options, 'split', v_split, 'leaderboard', v_board
    ), v_who->>'actor');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'qseq', v_tg.current_seq, 'correct_index', v_q.correct_index,
    'split', v_split, 'leaderboard', v_board, 'already', v_already, 'double', v_mult = 2
  );
end;
$function$;

