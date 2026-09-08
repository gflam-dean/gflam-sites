-- =====================================================================
-- Migration 73: the host's Next question and Reveal are one database trip each
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the venueplay-game.js that goes with it. The
--   Worker checks the functions are there and falls back to the old
--   many-trip path if they are not, so the order is safe either way; only
--   the speed depends on it.
--
-- WHY. Measured on 8 Sep 2026 under a Tuesday-shaped load (1,000 rooms):
-- Next question took 5 to 6 s and Reveal the same, at only 3 host
-- requests a second. Each one is eight to twelve round trips made one
-- after another (game, trivia state, session, staff, venue, group, the
-- question, the compare-and-set, the event, the preview; a reveal also
-- reads every answer and writes one PATCH per points bucket). At the
-- gateway's ceiling of about 45 calls a second, every trip waits behind
-- every other room's trips, so the host's tap is the slowest thing in
-- the building.
--
-- vp_host_question and vp_host_reveal make the same checks in the same
-- order, with the same outcomes, and return a status word plus the same
-- fields the Worker returned. The Worker maps the status word to the
-- exact HTTP reply it gave before. Nothing the console, the TV or a
-- phone sees changes except the wait.
--
-- One deliberate difference: a reveal scores every unscored answer in ONE
-- update instead of one PATCH per points bucket, and the correct/points
-- rule is the same expression (base, plus up to half of base scaled by
-- the time left, rounded; wrong answers score 0).
--
-- Service role only. These act as a host; the anon key must never be
-- able to call them.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Who is asking, and may they run games at this venue.
-- Same order as requireStaff in the Worker: a staff row at the venue, else
-- a platform admin with role owner/accounts (HQ "View as"), else refused;
-- then the kill-switch (venue or its group not active).
-- Returns jsonb: {status, actor, staff_id, role, is_admin}
--   status: ok | not_staff | venue_missing | venue_paused
-- ---------------------------------------------------------------------
create or replace function public.vp_host_staff(p_auth_user_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff  record;
  v_admin  record;
  v_venue  record;
  v_group  record;
  v_actor  text;
  v_out    jsonb;
begin
  select s.id, s.role into v_staff
    from public.vp_venue_staff s
   where s.auth_user_id = p_auth_user_id and s.venue_id = p_venue_id
   limit 1;
  if found then
    v_actor := 'host:' || v_staff.id::text;
    v_out := jsonb_build_object('actor', v_actor, 'staff_id', v_staff.id, 'role', v_staff.role, 'is_admin', false);
  else
    select a.role into v_admin
      from public.vp_platform_admins a
     where a.auth_user_id = p_auth_user_id and a.role in ('owner', 'accounts')
     limit 1;
    if not found then return jsonb_build_object('status', 'not_staff'); end if;
    v_actor := 'vpadmin:' || p_auth_user_id::text;
    v_out := jsonb_build_object('actor', v_actor, 'staff_id', null, 'role', 'owner', 'is_admin', true);
  end if;

  select v.status, v.group_id into v_venue from public.vp_venues v where v.id = p_venue_id;
  if not found then return jsonb_build_object('status', 'venue_missing'); end if;
  if v_venue.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
  if v_venue.group_id is not null then
    select g.status into v_group from public.vp_venue_groups g where g.id = v_venue.group_id;
    if found and v_group.status <> 'active' then return jsonb_build_object('status', 'venue_paused'); end if;
  end if;
  return v_out || jsonb_build_object('status', 'ok');
end;
$$;

-- ---------------------------------------------------------------------
-- POST /host/question in one trip.
-- Returns jsonb with status:
--   ok            {qseq, qi, qtotal, text, options, correct_index, ends_at, secs,
--                  image_url, next_preview|null}   (the event is already emitted)
--   done          no more questions this round
--   moved_on      another host, or a retry, already advanced past this question
--   no_game | not_trivia | not_running | no_session | session_closed
--   not_staff | venue_missing | venue_paused
-- ---------------------------------------------------------------------
create or replace function public.vp_host_question(p_game_id uuid, p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game     record;
  v_tg       record;
  v_session  record;
  v_who      jsonb;
  v_cfg      jsonb;
  v_seqs     jsonb;
  v_cur      int;
  v_pos      int;          -- 0-based position of the NEXT question in config.question_seqs
  v_limit    int;
  v_q        record;
  v_qi       int;
  v_qtotal   int;
  v_secs     int;
  v_ends     timestamptz;
  v_ends_txt text;
  v_options  jsonb;
  v_prev     record;
  v_preview  jsonb := null;
  v_rows     int;
begin
  select g.id, g.session_id, g.status, g.format, g.config into v_game
    from public.vp_games g where g.id = p_game_id;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  if v_game.format <> 'trivia' then return jsonb_build_object('status', 'not_trivia'); end if;
  if v_game.status <> 'running' then return jsonb_build_object('status', 'not_running'); end if;

  select t.question_set_id, t.current_seq, t.phase into v_tg
    from public.vp_trivia_games t where t.game_id = p_game_id;
  if not found then return jsonb_build_object('status', 'not_trivia'); end if;

  select s.id, s.venue_id, s.status into v_session
    from public.vp_sessions s where s.id = v_game.session_id;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if v_session.status in ('finished', 'cancelled') then return jsonb_build_object('status', 'session_closed'); end if;

  v_who := public.vp_host_staff(p_auth_user_id, v_session.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;

  v_cfg := coalesce(v_game.config, '{}'::jsonb);
  v_cur := coalesce(v_tg.current_seq, 0);
  v_seqs := case when jsonb_typeof(v_cfg->'question_seqs') = 'array' then v_cfg->'question_seqs' else null end;

  if v_seqs is not null then
    -- Randomised game: question_seqs is this round's order. current_seq holds the SEQ of the
    -- question last served; advance by POSITION. Not found (or 0 at the start) means position 0.
    select t.ord into v_pos
      from jsonb_array_elements(v_seqs) with ordinality as t(el, ord)
     where jsonb_typeof(t.el) = 'number' and (t.el)::int = v_cur
     limit 1;
    v_pos := coalesce(v_pos, 0);                       -- ord is 1-based, so it IS the next 0-based index
    v_qtotal := jsonb_array_length(v_seqs);
    if v_pos >= v_qtotal then return jsonb_build_object('status', 'done'); end if;
    select q.id, q.seq, q.question, q.options, q.correct_index, q.time_limit_s, q.points, q.image_url into v_q
      from public.vp_questions q
     where q.set_id = v_tg.question_set_id and q.seq = (v_seqs->v_pos)::int
     limit 1;
    if not found then return jsonb_build_object('status', 'done'); end if;
    v_qi := v_pos + 1;
  else
    -- Legacy game started before the randomiser: seq 1..N in order.
    v_limit := case when jsonb_typeof(v_cfg->'question_count') = 'number' then (v_cfg->>'question_count')::int else null end;
    if v_limit is not null and v_cur >= v_limit then return jsonb_build_object('status', 'done'); end if;
    select q.id, q.seq, q.question, q.options, q.correct_index, q.time_limit_s, q.points, q.image_url into v_q
      from public.vp_questions q
     where q.set_id = v_tg.question_set_id and q.seq > v_cur
     order by q.seq asc limit 1;
    if not found then return jsonb_build_object('status', 'done'); end if;
    v_qi := v_q.seq;
    v_qtotal := v_limit;
  end if;

  v_secs := case when v_cfg ? 'time_limit_s' and jsonb_typeof(v_cfg->'time_limit_s') = 'number'
                 then (v_cfg->>'time_limit_s')::int
                 else coalesce(nullif(v_q.time_limit_s, 0), 20) end;
  v_ends := now() + make_interval(secs => v_secs);
  v_ends_txt := to_char(v_ends at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_options := case when jsonb_typeof(v_q.options) = 'array' then v_q.options else '[]'::jsonb end;

  -- Compare-and-set on the question we believe we are leaving: a second host, or a retry
  -- after a lost reply, changes no rows and is told so instead of skipping a question.
  update public.vp_trivia_games t
     set current_seq = v_q.seq, phase = 'asking', question_ends_at = v_ends
   where t.game_id = p_game_id and coalesce(t.current_seq, 0) = v_cur;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('status', 'moved_on'); end if;

  -- PUBLIC broadcast: options only, never correct_index.
  perform public.vp_emit_event(v_session.id, 'trivia.question', jsonb_build_object(
    'qseq', v_q.seq, 'qi', v_qi, 'qtotal', v_qtotal,
    'text', v_q.question, 'options', v_options, 'ends_at', v_ends_txt, 'secs', v_secs,
    'image_url', v_q.image_url,
    'colour', (v_cfg->'colour') is distinct from 'false'::jsonb
  ), v_who->>'actor');

  -- One further ahead, HOST ONLY, so the console can start reading the next one.
  if v_seqs is not null then
    if v_pos + 1 < v_qtotal then
      select q.seq, q.question, q.options, q.correct_index, q.image_url into v_prev
        from public.vp_questions q
       where q.set_id = v_tg.question_set_id and q.seq = (v_seqs->(v_pos + 1))::int
       limit 1;
      if found then v_preview := jsonb_build_object('qseq', v_prev.seq, 'text', v_prev.question,
        'options', case when jsonb_typeof(v_prev.options) = 'array' then v_prev.options else '[]'::jsonb end,
        'correct_index', v_prev.correct_index, 'image_url', v_prev.image_url); end if;
    end if;
  else
    if v_limit is null or v_q.seq < v_limit then
      select q.seq, q.question, q.options, q.correct_index, q.image_url into v_prev
        from public.vp_questions q
       where q.set_id = v_tg.question_set_id and q.seq > v_q.seq
       order by q.seq asc limit 1;
      if found then v_preview := jsonb_build_object('qseq', v_prev.seq, 'text', v_prev.question,
        'options', case when jsonb_typeof(v_prev.options) = 'array' then v_prev.options else '[]'::jsonb end,
        'correct_index', v_prev.correct_index, 'image_url', v_prev.image_url); end if;
    end if;
  end if;

  -- HOST-ONLY reply: may carry correct_index for the console.
  return jsonb_build_object(
    'status', 'ok',
    'qseq', v_q.seq, 'qi', v_qi, 'qtotal', v_qtotal,
    'text', v_q.question, 'options', v_options, 'correct_index', v_q.correct_index,
    'ends_at', v_ends_txt, 'secs', v_secs, 'image_url', v_q.image_url,
    'next_preview', v_preview
  );
end;
$$;

-- ---------------------------------------------------------------------
-- POST /host/reveal in one trip.
-- Returns jsonb with status:
--   ok            {qseq, correct_index, split, leaderboard, already}  (event emitted)
--   no_game | not_trivia | no_session | not_staff | venue_missing | venue_paused
--   not_running | session_closed | no_question | no_question_row
-- The phase flips to 'revealed' with a compare-and-set BEFORE the answers are
-- read, so nothing can be accepted after the reveal has begun. Unscored rows are
-- scored whoever calls; already-scored rows are never touched again.
-- ---------------------------------------------------------------------
create or replace function public.vp_host_reveal(p_game_id uuid, p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- Score every UNSCORED answer in one statement. The loser of the compare-and-set above
  -- scores nothing: the winner is scoring this same set at this moment.
  if not v_raced then
    update public.vp_trivia_answers a
       set is_correct = (a.answer_index = v_q.correct_index),
           points_awarded = case
             when a.answer_index <> v_q.correct_index then 0
             else v_base + case
               when v_bonus and v_tg.question_ends_at is not null and v_secs > 0 then
                 round((v_base * 0.5 * (
                   least(v_secs::numeric, greatest(0::numeric,
                     extract(epoch from (v_tg.question_ends_at - a.answered_at))::numeric))
                   / v_secs::numeric))::numeric)::int
               else 0 end
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

  -- PUBLIC broadcast: now it is safe to send correct_index.
  perform public.vp_emit_event(v_session.id, 'trivia.reveal', jsonb_build_object(
    'qseq', v_tg.current_seq, 'correct_index', v_q.correct_index,
    'options', v_options, 'split', v_split, 'leaderboard', v_board
  ), v_who->>'actor');

  return jsonb_build_object(
    'status', 'ok',
    'qseq', v_tg.current_seq, 'correct_index', v_q.correct_index,
    'split', v_split, 'leaderboard', v_board, 'already', v_already
  );
end;
$$;

revoke all on function public.vp_host_staff(uuid, uuid)    from public, anon, authenticated;
revoke all on function public.vp_host_question(uuid, uuid) from public, anon, authenticated;
revoke all on function public.vp_host_reveal(uuid, uuid)   from public, anon, authenticated;
grant execute on function public.vp_host_staff(uuid, uuid)    to service_role;
grant execute on function public.vp_host_question(uuid, uuid) to service_role;
grant execute on function public.vp_host_reveal(uuid, uuid)   to service_role;

comment on function public.vp_host_question(uuid, uuid) is
  'POST /host/question in one round trip: the same checks in the same order, the compare-and-set advance, the public event, and the host-only reply with the next preview.';
comment on function public.vp_host_reveal(uuid, uuid) is
  'POST /host/reveal in one round trip: flip the phase first, score every unscored answer in one update, split + leaderboard, public event.';

commit;
