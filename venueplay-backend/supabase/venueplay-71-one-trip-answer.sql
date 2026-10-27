-- =====================================================================
-- Migration 71: a trivia answer is one database trip, not eight
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the venueplay-game.js that goes with it. The
--   Worker checks the function is there and falls back to the old
--   eight-trip path if it is not, so the order is safe either way; only
--   the speed depends on it.
--
-- WHY. Measured on 8 Sep 2026 against an idle project in the same city
-- as the Worker: a TV lookup took 0.15 s, a phone answer took 1.25 s.
-- Same Worker, same database. The answer path made eight round trips one
-- after the other (player token, game, session, venue, group, trivia
-- state, question, insert) at about 0.13 s each, and they queue. Under a
-- hundred rooms it was 2 s. That is the difference between a phone that
-- feels instant and a room that thinks the game is broken.
--
-- vp_player_answer does every one of those checks in one call, in the
-- same order and with the same outcomes the Worker had, and the Worker
-- maps the returned status word to the exact HTTP reply it gave before.
-- Nothing a phone sees changes except the wait.
--
-- Two indexes that were missing:
--   vp_questions (set_id, seq)   every answer, every "next question" and
--                                every TV question fetch looks a question
--                                up by set and sequence. There was no index,
--                                so each one scanned the whole bank (10,000+
--                                rows and growing every Monday).
--   vp_players (session_id)      player counts, leaderboards and the cascade
--                                when a session is deleted all walk this.
--                                The only index was partial (device_id).
--
-- Service role only. The anon key is printed in every page and must not
-- be able to call this with a guessed token.
-- =====================================================================

begin;

create index if not exists vp_questions_set_seq_idx on public.vp_questions (set_id, seq);
create index if not exists vp_players_session_idx  on public.vp_players (session_id);

-- One trip. p_token_hash is the sha256 hex of the phone's X-Player-Token (the
-- Worker hashes it; the raw token never reaches the database). p_qseq may be
-- null: an older phone that does not tag its answer skips the moved-on guard,
-- exactly as before.
create or replace function public.vp_player_answer(
  p_token_hash   text,
  p_game_id      uuid,
  p_answer_index int,
  p_qseq         int
)
returns table(status text, player_id uuid, session_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player   public.vp_players%rowtype;
  v_game     record;
  v_session  record;
  v_venue    record;
  v_group    record;
  v_tg       record;
  v_q        record;
  v_opts     int;
begin
  player_id := null; session_id := null;

  -- 1. the phone: same as verifyPlayerToken
  select * into v_player from public.vp_players p where p.token_hash = p_token_hash;
  if not found then status := 'bad_token'; return next; return; end if;
  player_id := v_player.id; session_id := v_player.session_id;
  if v_player.kicked then status := 'kicked'; return next; return; end if;

  -- 2. the game
  select g.id, g.session_id, g.status, g.format into v_game from public.vp_games g where g.id = p_game_id;
  if not found then status := 'no_game'; return next; return; end if;
  if v_game.format <> 'trivia' then status := 'not_trivia'; return next; return; end if;
  if v_game.session_id <> v_player.session_id then status := 'wrong_game'; return next; return; end if;
  if v_game.status <> 'running' then status := 'not_running'; return next; return; end if;

  -- 3. the session and the venue kill-switch: same as getSession + assertVenueActive
  select s.status, s.venue_id into v_session from public.vp_sessions s where s.id = v_game.session_id;
  if not found then status := 'no_session'; return next; return; end if;
  if v_session.status in ('finished', 'cancelled') then status := 'session_closed'; return next; return; end if;
  select v.status, v.group_id into v_venue from public.vp_venues v where v.id = v_session.venue_id;
  if not found then status := 'venue_missing'; return next; return; end if;
  if v_venue.status <> 'active' then status := 'venue_paused'; return next; return; end if;
  if v_venue.group_id is not null then
    select gr.status into v_group from public.vp_venue_groups gr where gr.id = v_venue.group_id;
    if found and v_group.status <> 'active' then status := 'venue_paused'; return next; return; end if;
  end if;

  -- 4. is a question open, and is it the one the phone answered
  select t.question_set_id, t.current_seq, t.phase, t.question_ends_at into v_tg
    from public.vp_trivia_games t where t.game_id = p_game_id;
  if not found then status := 'not_trivia'; return next; return; end if;
  if v_tg.phase <> 'asking' or v_tg.current_seq is null or v_tg.current_seq = 0 then status := 'no_question'; return next; return; end if;
  if v_tg.question_ends_at is not null and now() > v_tg.question_ends_at then status := 'time_up'; return next; return; end if;
  if p_qseq is not null and p_qseq <> v_tg.current_seq then status := 'moved_on'; return next; return; end if;

  -- 5. the question and its option count
  select q.id, q.options into v_q from public.vp_questions q
   where q.set_id = v_tg.question_set_id and q.seq = v_tg.current_seq limit 1;
  if not found then status := 'no_question_row'; return next; return; end if;
  v_opts := case when jsonb_typeof(v_q.options) = 'array' then jsonb_array_length(v_q.options) else 0 end;
  if p_answer_index is null or p_answer_index < 0 or p_answer_index >= v_opts then status := 'bad_index'; return next; return; end if;

  -- 6. first answer is final: the unique constraint decides, same as before
  begin
    insert into public.vp_trivia_answers (game_id, question_id, player_id, answer_index, answered_at)
    values (p_game_id, v_q.id, v_player.id, p_answer_index, now());
  exception when unique_violation then
    status := 'already'; return next; return;
  end;
  status := 'recorded'; return next; return;
end;
$$;

revoke all on function public.vp_player_answer(text, uuid, int, int) from public, anon, authenticated;
grant execute on function public.vp_player_answer(text, uuid, int, int) to service_role;

comment on function public.vp_player_answer(text, uuid, int, int) is
  'POST /player/answer in one round trip: every check the Worker made, in the same order, returning a status word the Worker maps to the same HTTP reply.';

commit;
