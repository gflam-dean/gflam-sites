-- =====================================================================
-- Migration 76: calling a bingo ball, and drawing a member, are one
--               database trip each
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the venueplay-game.js that goes with it. The
--   Worker checks the functions are there and falls back to the old
--   many-trip path if they are not, so the order is safe either way;
--   only the speed depends on it.
--
--   RUN MIGRATION 73 FIRST. Both functions here call vp_host_staff, which
--   73 creates. The check at the top of this file refuses to install them
--   without it, rather than leaving a function that answers 500 on the
--   first ball of the night. 73 is on the Sydney database and, as of
--   9 Sep 2026, not on live.
--
-- WHY. Measured from Dean's machine on 10 Sep 2026, three samples each:
-- a Cloudflare-only call (room presence) answers in 0.09 s, and a single
-- Supabase read through the same Worker takes 0.84 s, because the live
-- database is in Singapore and the Worker runs at an Australian edge.
-- Calling a ball made six of those reads one after another (the draw row,
-- the staff row, the venue, its group, the last ball, then the draw
-- itself), so the host waited two to three seconds while the room, which
-- gets the ball over the Cloudflare room in a tenth of a second, watched
-- the host's finger. The host was waiting on Singapore, nothing else.
-- The members draw made eight to ten in the same way.
--
--   vp_bingo_ball    does the same six checks, in the same order, with the
--                    same outcomes, and calls vp_bingo_next_ball itself.
--   vp_members_draw  does the same eight to ten, and writes the same two
--                    rows (the stamp, and the unresolved 'drawn' record).
--
-- THE RANDOMNESS HAS NOT MOVED, and this is the part that matters for
-- OLGR. Bingo's ball order is still the Fisher-Yates order written at game
-- start by migration 70 and still handed out one at a time by
-- vp_bingo_next_ball, which is called from inside vp_bingo_ball exactly as
-- the Worker called it: same statement, same lock, same
-- vp_bingo_draw_balls row. Nothing about the pick, the record or who can
-- see the order changes.
--
-- The members draw still picks with the WORKER's rejection-sampled CSPRNG.
-- The Worker mints its random values with crypto.getRandomValues before it
-- calls, and hands them in as p_rand; the function applies the same
-- rejection rule the Worker's randInt applies (discard anything at or above
-- floor(2^32 / n) * n, then take it modulo n), so the distribution is
-- identical and unbiased, and the entropy still comes from the Worker's
-- CSPRNG rather than from the database. If every supplied value were
-- rejected, which needs the count to divide 2^32 badly eight times over,
-- the function answers 'retry' and the Worker draws the old way.
--
-- THE STAFF CHECK IS DONE HERE, IN FULL. Saving a round trip by trusting
-- the Worker's word for it would be far worse than the wait: both
-- functions call vp_host_staff, which is the same staff row, the same
-- HQ View-as rule and the same venue and group kill-switch that
-- requireStaff walks in the Worker, in the same order.
--
-- Service role only. These act as a host; the anon key is printed in
-- every page and must never be able to call them.
--
-- Safe to run twice: everything here is create or replace.
-- =====================================================================

begin;

-- 73 is a hard dependency, not a nicety. Without vp_host_staff these two
-- functions would install cleanly and then fail at the first ball, which the
-- Worker cannot fall back from (it only falls back on a 404).
do $$
begin
  if to_regprocedure('public.vp_host_staff(uuid,uuid)') is null then
    raise exception 'Run venueplay-73-one-trip-host-trivia.sql first: vp_host_staff is missing, and 76 is built on it.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vp_member_draws' and column_name = 'last_drawn_at'
  ) then
    raise exception 'Run venueplay-69-members-draw-hold.sql first: vp_member_draws.last_drawn_at is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- POST /host/bingo/ball in one trip.
-- p_hold_ms is the Worker's BINGO_SERVER_HOLD_MS, passed in so the number
-- keeps living in one place.
-- Returns jsonb with status:
--   ok            {number, index}
--   hold          {wait_seconds}   the last ball is still going up
--   no_draw | not_staff | venue_missing | venue_paused
--   finished      the game is over
--   local_mode    the tablet has taken the calling over
--   all_drawn     all 90 are out
-- ---------------------------------------------------------------------
create or replace function public.vp_bingo_ball(
  p_draw_id      uuid,
  p_auth_user_id uuid,
  p_hold_ms      int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draw  record;
  v_who   jsonb;
  v_last  timestamptz;
  v_since numeric;
  v_ball  record;
begin
  -- 1. the draw
  select d.id, d.venue_id, d.draw_index, d.mode, d.finished_at into v_draw
    from public.vp_bingo_draws d where d.id = p_draw_id;
  if not found then return jsonb_build_object('status', 'no_draw'); end if;

  -- 2. may this person run games at THAT venue (the draw's venue, never one
  --    the caller named), and is the venue switched on
  v_who := public.vp_host_staff(p_auth_user_id, v_draw.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;

  -- 3. the game is over, or the tablet has taken over. Once the console is
  --    calling from its own pool, a server ball could repeat a number the room
  --    has already daubed.
  if v_draw.finished_at is not null then return jsonb_build_object('status', 'finished'); end if;
  if v_draw.mode = 'local' then return jsonb_build_object('status', 'local_mode'); end if;

  -- 4. double-request guard, read from the ball log so it is the time the LAST
  --    ball was actually written. Same window the Worker used.
  if v_draw.draw_index > 0 and p_hold_ms > 0 then
    select b.drawn_at into v_last from public.vp_bingo_draw_balls b
     where b.draw_id = p_draw_id order by b.ordinal desc limit 1;
    if v_last is not null then
      v_since := extract(epoch from (now() - v_last)) * 1000;
      if v_since >= 0 and v_since < p_hold_ms then
        return jsonb_build_object('status', 'hold',
                                  'wait_seconds', ceil((p_hold_ms - v_since) / 1000.0)::int);
      end if;
    end if;
  end if;

  -- 5. the ball itself. Unchanged: same function, same lock, same record.
  select n.number, n.new_index into v_ball from public.vp_bingo_next_ball(p_draw_id) n;
  if not found then return jsonb_build_object('status', 'all_drawn'); end if;
  if v_ball.number is null then return jsonb_build_object('status', 'all_drawn'); end if;
  return jsonb_build_object('status', 'ok', 'number', v_ball.number, 'index', v_ball.new_index);
end;
$$;

-- ---------------------------------------------------------------------
-- A member's name as the venue asks for it. A faithful port of
-- formatMemberName in the Worker, including the split it does when a member
-- was imported with the whole name in first_name.
--   full          -> "John Smith"
--   abbrev_first  -> "J Smith"
--   anything else -> "John S"   (the default, abbrev_last)
-- ---------------------------------------------------------------------
create or replace function public.vp_member_name(p_first text, p_last text, p_mode text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  f     text := btrim(coalesce(p_first, ''));
  l     text := btrim(coalesce(p_last, ''));
  parts text[];
begin
  if l = '' and f ~ '\s' then
    parts := regexp_split_to_array(f, '\s+');
    l := parts[array_length(parts, 1)];
    f := array_to_string(parts[1:array_length(parts, 1) - 1], ' ');
  end if;
  if p_mode = 'full' then
    return btrim(f || ' ' || l);
  elsif p_mode = 'abbrev_first' then
    return btrim(case when f <> '' then left(f, 1) || ' ' else '' end || l);
  end if;
  return btrim(f || ' ' || case when l <> '' then left(l, 1) else '' end);
end;
$$;

-- ---------------------------------------------------------------------
-- POST /host/members/draw in one trip.
-- p_rand is a handful of uint32 values from the Worker's CSPRNG (see the
-- note at the top); p_hold_* are drawHoldMs's own numbers, passed in so
-- they keep living in the Worker.
-- Returns jsonb with status:
--   ok        {draw_name, member_id, member_number, first_name, last_name,
--              winner_name, name_display, jackpot_cents,
--              time_to_claim_seconds, draw_length_seconds, valid_count}
--   pending   the same member as the draw that was lost on bad wifi, from an
--             unresolved 'drawn' row less than 30 minutes old
--   hold      {wait_seconds}   the draw is still spinning on the wall
--   no_draw | not_staff | venue_missing | venue_paused
--   no_members   nobody valid to draw from
--   retry        every random value was rejected (astronomically unlikely);
--                the Worker draws the old way
-- ---------------------------------------------------------------------
create or replace function public.vp_members_draw(
  p_draw_id      uuid,
  p_auth_user_id uuid,
  p_rand         bigint[],
  p_hold_default int,
  p_hold_lo      int,
  p_hold_hi      int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draw    record;
  v_who     jsonb;
  v_spin    int;
  v_hold    int;
  v_since   numeric;
  v_pending record;
  v_ids     uuid[];
  v_count   int;
  v_limit   bigint;
  v_pick    int := -1;
  v_i       int;
  v_x       bigint;
  v_win     record;
  v_mode    text;
  v_name    text;
  v_amount  int;
begin
  -- 1. the draw
  select d.id, d.venue_id, d.roster_id, d.name, d.current_jackpot_cents,
         d.starting_amount_cents, d.increment_cents, d.draw_length_seconds,
         d.time_to_claim_seconds, d.last_drawn_at
    into v_draw
    from public.vp_member_draws d where d.id = p_draw_id;
  if not found then return jsonb_build_object('status', 'no_draw'); end if;

  -- 2. staff at the DRAW's venue, and the kill-switch
  v_who := public.vp_host_staff(p_auth_user_id, v_draw.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;

  -- 3. double-tap guard, sized to the spin the room is watching. Same rule as
  --    drawHoldMs: the draw's own length, clamped to what the consoles offer,
  --    plus two seconds.
  v_spin := coalesce(v_draw.draw_length_seconds, p_hold_default);
  if v_spin < 0 then v_spin := p_hold_default; end if;
  v_spin := greatest(p_hold_lo, least(p_hold_hi, v_spin));
  v_hold := (v_spin + 2) * 1000;
  if v_draw.last_drawn_at is not null then
    v_since := extract(epoch from (now() - v_draw.last_drawn_at)) * 1000;
    if v_since >= 0 and v_since < v_hold then
      return jsonb_build_object('status', 'hold',
                                'wait_seconds', ceil((v_hold - v_since) / 1000.0)::int);
    end if;
  end if;

  -- 4. tonight's draw may already have happened and been lost on bad wifi. An
  --    unresolved 'drawn' row from the last 30 minutes hands back the SAME
  --    member rather than naming a second one.
  select r.member_id, r.member_number, r.winner_name, r.amount_cents, r.drawn_at
    into v_pending
    from public.vp_member_draw_results r
   where r.draw_id = p_draw_id and r.outcome = 'drawn'
   order by r.drawn_at desc limit 1;
  if found and v_pending.drawn_at is not null and (now() - v_pending.drawn_at) < interval '30 minutes' then
    return jsonb_build_object(
      'status', 'pending',
      'draw_name', v_draw.name,
      'member_id', v_pending.member_id,
      'member_number', v_pending.member_number,
      'winner_name', v_pending.winner_name,
      'jackpot_cents', coalesce(v_pending.amount_cents, v_draw.current_jackpot_cents, 0),
      'time_to_claim_seconds', v_draw.time_to_claim_seconds,
      'draw_length_seconds', v_draw.draw_length_seconds);
  end if;

  -- 5. who is in the draw: the named list, or every list at the venue. Same rule
  --    as validMembers in the Worker, ordered so the pick is repeatable.
  select array_agg(m.id order by m.id) into v_ids
    from public.vp_members m
   where m.status = 'valid'
     and (
       (v_draw.roster_id is not null and m.roster_id = v_draw.roster_id)
       or
       (v_draw.roster_id is null and m.roster_id in (
          select r.id from public.vp_member_rosters r where r.venue_id = v_draw.venue_id))
     );
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then return jsonb_build_object('status', 'no_members'); end if;

  -- 6. the pick: the Worker's CSPRNG values, the Worker's rejection rule
  v_limit := (4294967296::bigint / v_count) * v_count;
  for v_i in 1 .. coalesce(array_length(p_rand, 1), 0) loop
    v_x := p_rand[v_i];
    if v_x is not null and v_x >= 0 and v_x < v_limit then
      v_pick := (v_x % v_count)::int + 1;
      exit;
    end if;
  end loop;
  if v_pick < 1 then return jsonb_build_object('status', 'retry'); end if;
  select m.id, m.member_number, m.first_name, m.last_name into v_win
    from public.vp_members m where m.id = v_ids[v_pick];
  if not found then return jsonb_build_object('status', 'no_members'); end if;

  -- 7. the name, as the venue shows it
  select s.name_display into v_mode from public.vp_venue_settings s where s.venue_id = v_draw.venue_id limit 1;
  v_mode := coalesce(v_mode, 'abbrev_last');
  v_name := public.vp_member_name(v_win.first_name, v_win.last_name, v_mode);
  v_amount := coalesce(v_draw.current_jackpot_cents, 0);

  -- 8. the audit stamp. Written before the winner is handed back, so the guard
  --    above is armed before any second request can arrive.
  update public.vp_member_draws
     set last_drawn_date = (now() at time zone 'utc')::date,
         last_drawn_at   = now()
   where id = p_draw_id;

  -- 9. the durable record starts here, not at resolve. Resolve updates this row
  --    to claimed or jackpot_rolled. Forgiven if the outcome constraint has not
  --    been widened yet (migration 74), exactly as the Worker forgives it.
  begin
    insert into public.vp_member_draw_results
      (draw_id, outcome, amount_cents, member_id, member_number, winner_name)
    values (p_draw_id, 'drawn', v_amount, v_win.id, v_win.member_number, v_name);
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'status', 'ok',
    'draw_name', v_draw.name,
    'member_id', v_win.id,
    'member_number', v_win.member_number,
    'first_name', v_win.first_name,
    'last_name', v_win.last_name,
    'winner_name', v_name,
    'name_display', v_mode,
    'jackpot_cents', v_amount,
    'time_to_claim_seconds', v_draw.time_to_claim_seconds,
    'draw_length_seconds', v_draw.draw_length_seconds,
    'valid_count', v_count);
end;
$$;

-- Service role only. The anon key is printed in every page and the
-- authenticated key belongs to a host; neither may call a draw.
revoke all on function public.vp_bingo_ball(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.vp_bingo_ball(uuid, uuid, int) to service_role;
revoke all on function public.vp_members_draw(uuid, uuid, bigint[], int, int, int) from public, anon, authenticated;
grant execute on function public.vp_members_draw(uuid, uuid, bigint[], int, int, int) to service_role;
revoke all on function public.vp_member_name(text, text, text) from public, anon, authenticated;
grant execute on function public.vp_member_name(text, text, text) to service_role;

comment on function public.vp_bingo_ball(uuid, uuid, int) is
  'POST /host/bingo/ball in one round trip: the same checks in the same order, then vp_bingo_next_ball. The ball order and the pick are unchanged.';
comment on function public.vp_members_draw(uuid, uuid, bigint[], int, int, int) is
  'POST /host/members/draw in one round trip. The pick uses the random values the Worker mints with its own CSPRNG, under the same rejection rule.';

commit;
