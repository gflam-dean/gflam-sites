-- 90: ONE MEMBERS DRAW AT A TIME. Audit 25 Sep 2026 (confirmed by a sceptic, rated low).
--
-- vp_members_draw read the draw row with a plain SELECT, then checked the double-tap hold and the
-- unresolved 'drawn' row, and only locked the row at the UPDATE in step 8. Two consoles pressing
-- Draw in the same instant (READ COMMITTED) both passed steps 3 and 4 and each named a DIFFERENT
-- member, and resolve then only found the later one, so the room could be told a member won who
-- can never be paid through the normal flow.
--
-- The only change from the live definition (read back from Sydney with pg_get_functiondef on
-- 25 Sep 2026) is FOR UPDATE on the step 1 read. The lock is held to the end of the RPC's
-- transaction, so a second call waits there and then sees last_drawn_at and the pending row,
-- and answers 'hold' or hands back the SAME member. Signature, SECURITY DEFINER, search_path and
-- grants are unchanged (CREATE OR REPLACE keeps grants).
--
-- Rollback: re-run the vp_members_draw definition from venueplay-76-one-trip-host-draws.sql.

CREATE OR REPLACE FUNCTION public.vp_members_draw(p_draw_id uuid, p_auth_user_id uuid, p_rand bigint[], p_hold_default integer, p_hold_lo integer, p_hold_hi integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from public.vp_member_draws d where d.id = p_draw_id
     for update;   -- 90: one draw at a time. A second press waits here, then sees the first one's stamp.
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
$function$;
