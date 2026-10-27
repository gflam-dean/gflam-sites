-- 95: JAG THE JOKER. Built 27 Sep 2026 on branch feature/jag-joker. NOT RUN.
-- Reworked 30 Sep 2026 after two reviews (still NOT RUN, so edited in place, not a 98).
--
-- The game: a weekly pub jackpot. A ticket is drawn (the venue's own raffle, done however
-- it already does it), that person picks one face-down card from the board, and if it is
-- the Joker they win the jackpot. If not, the card stays turned and the jackpot carries.
--
-- WHAT DEAN ASKED FOR (25 Sep 2026): "As long as we can prove the joker is in a random
-- spot where it stays." So:
--   * The Worker picks the Joker's card with its own CSPRNG (crypto.getRandomValues, the
--     same RNG and rejection rule as every other VenuePlay draw). The database never makes
--     the pick.
--   * The spot and a random secret are stored in vp_jag_secrets, which nothing but the
--     service role can read: no page, no console, no screen, not the venue's owner.
--   * At the start the Worker publishes a COMMITMENT: sha256('jag:' || id || ':' || spot
--     || ':' || salt), shown on the TV and on the public check page from the first week.
--   * When the Joker is found (or the game is closed) the spot and salt are copied onto the
--     game row, and anyone can recompute the hash and see it is the one shown on day one.
--     The spot cannot have moved without the fingerprint changing.
--
-- WHAT THE REVIEWS ADDED (30 Sep 2026):
--   * The evidence cannot be edited or deleted. Triggers refuse any UPDATE or DELETE of a
--     secret, a turn or a log row, and any change to a game's id, venue, deck size,
--     commitment or revealed card. The ONE delete let through is the cascade when a whole
--     venue is removed (the parent row is already gone when the child's trigger runs), because
--     refusing that would stop a venue ever being deleted and the evidence is meaningless
--     without the venue it belongs to.
--   * The state rule is enforced on every play, not only on start, inside the same
--     transaction, against the GAME's venue: a null au_state or Queensland is refused. The
--     staff check comes first, so somebody who is not staff learns nothing about the venue.
--   * One card per game per trading night (2am to 2am Brisbane, the same clock bingo metering
--     uses), unless an owner or manager overrides it, and every turn names who it was for.
--   * The jackpot only goes DOWN by an owner or manager, and every change is logged.
--   * Ending a jackpot early is owner (or HQ) only, needs a typed reason, is logged and shown
--     on the public check page, and its jackpot carries into the next game by default.
--
-- LICENSING: a jackpotting game of chance. Same footing as raffles and the members draw
-- (per-state rules; Queensland needs OLGR approval and is parked). Every route is OFF unless
-- the Worker has JAG_ON=1. Do not switch it on until the per-state position is confirmed.
--
-- Run once on Sydney, then python3 venueplay-backend/tools/dump-rls-baseline.py and commit
-- RLS-BASELINE.json (four new tables and eight functions, all locked to service_role).

create table if not exists public.vp_jag_games (
  id              uuid primary key,                       -- minted by the Worker: it is inside the commitment
  venue_id        uuid not null references public.vp_venues(id) on delete cascade,
  name            text not null default 'Jag the Joker' check (length(name) between 1 and 60),
  deck_size       int  not null check (deck_size between 10 and 100),
  jackpot_cents   int  not null default 0 check (jackpot_cents between 0 and 100000000),
  commitment      text not null check (commitment ~ '^[0-9a-f]{64}$'),
  status          text not null default 'active' check (status in ('active', 'won', 'closed')),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  ended_at        timestamptz,
  revealed_spot   int,                                    -- filled ONLY when won or closed
  revealed_salt   text,
  closed_reason   text check (closed_reason is null or length(closed_reason) between 5 and 200),
  closed_by       uuid,
  carried_from    uuid references public.vp_jag_games(id) -- the ended jackpot this one's pot came from
);
create unique index if not exists vp_jag_one_active on public.vp_jag_games (venue_id) where status = 'active';
create unique index if not exists vp_jag_carried_once on public.vp_jag_games (carried_from) where carried_from is not null;
create index if not exists vp_jag_games_venue on public.vp_jag_games (venue_id, created_at desc);

create table if not exists public.vp_jag_secrets (
  jag_id  uuid primary key references public.vp_jag_games(id) on delete cascade,
  spot    int  not null,
  salt    text not null check (salt ~ '^[0-9a-f]{32,}$')
);

create table if not exists public.vp_jag_turns (
  id             uuid primary key default gen_random_uuid(),
  jag_id         uuid not null references public.vp_jag_games(id) on delete cascade,
  card           int  not null,
  winner_name    text not null check (length(winner_name) between 1 and 60),   -- a name or a ticket number
  jackpot_cents  int  not null default 0,
  is_joker       boolean not null default false,
  night          date not null,                          -- the trading night, 2am to 2am Brisbane
  overridden     boolean not null default false,         -- a second card that night, by an owner or manager
  turned_at      timestamptz not null default now(),
  turned_by      uuid,
  unique (jag_id, card)
);
create index if not exists vp_jag_turns_night on public.vp_jag_turns (jag_id, night);

-- Every change of money or state, by whom. Append only (trigger below).
create table if not exists public.vp_jag_log (
  id          bigint generated always as identity primary key,
  jag_id      uuid not null references public.vp_jag_games(id) on delete cascade,
  at          timestamptz not null default now(),
  by_user     uuid,
  actor       text,                                      -- vp_host_staff's actor: host:<staff id> or vpadmin:<user>
  what        text not null check (what in ('start', 'carry', 'turn', 'override', 'jackpot', 'close')),
  from_cents  int,
  to_cents    int,
  card        int,
  note        text check (note is null or length(note) <= 200)
);
create index if not exists vp_jag_log_game on public.vp_jag_log (jag_id, at);

alter table public.vp_jag_games   enable row level security;
alter table public.vp_jag_secrets enable row level security;
alter table public.vp_jag_turns   enable row level security;
alter table public.vp_jag_log     enable row level security;
revoke all on public.vp_jag_games, public.vp_jag_secrets, public.vp_jag_turns, public.vp_jag_log from anon, authenticated;
-- No policies: every read and write goes through the Worker with the service key.

-- ---------------------------------------------------------------------------------------
-- THE EVIDENCE DOES NOT CHANGE. Not by a function, not by hand in the dashboard by mistake.
--
-- A child row may be deleted only when its parent is already gone, which is exactly the
-- ON DELETE CASCADE from removing a venue: Postgres runs the cascade after the parent row is
-- deleted, so the parent is no longer visible to the child's trigger. A direct DELETE of a
-- secret, turn or log row while its game still exists is refused, and so is a direct DELETE of
-- a game while its venue still exists.
create or replace function public.vp_jag_secret_frozen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.vp_jag_games where id = old.jag_id) then
    return old;                                           -- the game went with its venue
  end if;
  raise exception 'A Jag the Joker spot never changes once it is set';
end $$;
drop trigger if exists vp_jag_secret_frozen on public.vp_jag_secrets;
create trigger vp_jag_secret_frozen before update or delete on public.vp_jag_secrets
  for each row execute function public.vp_jag_secret_frozen();

create or replace function public.vp_jag_record_frozen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.vp_jag_games where id = old.jag_id) then
    return old;
  end if;
  raise exception 'Jag the Joker turns and log entries are a permanent record';
end $$;
drop trigger if exists vp_jag_turns_frozen on public.vp_jag_turns;
create trigger vp_jag_turns_frozen before update or delete on public.vp_jag_turns
  for each row execute function public.vp_jag_record_frozen();
drop trigger if exists vp_jag_log_frozen on public.vp_jag_log;
create trigger vp_jag_log_frozen before update or delete on public.vp_jag_log
  for each row execute function public.vp_jag_record_frozen();

-- The game row: the jackpot, status, end time and closure may move; what the commitment was
-- made over may not, a finished game stays finished, and a revealed card stays revealed.
create or replace function public.vp_jag_game_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.vp_venues where id = old.venue_id) then return old; end if;
    raise exception 'A Jag the Joker game is a permanent record: end it, do not delete it';
  end if;
  if new.id is distinct from old.id or new.venue_id is distinct from old.venue_id
     or new.deck_size is distinct from old.deck_size or new.commitment is distinct from old.commitment
     or new.created_at is distinct from old.created_at or new.carried_from is distinct from old.carried_from then
    raise exception 'The game, venue, deck size and fingerprint of a Jag the Joker game never change';
  end if;
  if old.status <> 'active' and (new.status is distinct from old.status or new.jackpot_cents is distinct from old.jackpot_cents
     or new.revealed_spot is distinct from old.revealed_spot or new.revealed_salt is distinct from old.revealed_salt
     or new.closed_reason is distinct from old.closed_reason) then
    raise exception 'A finished Jag the Joker game stays finished';
  end if;
  return new;
end $$;
drop trigger if exists vp_jag_game_guard on public.vp_jag_games;
create trigger vp_jag_game_guard before update or delete on public.vp_jag_games
  for each row execute function public.vp_jag_game_guard();

-- ---------------------------------------------------------------------------------------
-- The trading night, the same 2am-to-2am Brisbane clock as brisbaneNightKey() in the game Worker.
create or replace function public.vp_jag_night(p_at timestamptz) returns date
language sql stable as $$
  select ((p_at at time zone 'Australia/Brisbane') - interval '2 hours')::date;
$$;

-- Staff FIRST, then the state. Somebody who is not staff at the venue is told only that.
-- A null au_state means the rules for that venue have not been confirmed (migration 44), and an
-- owner can blank the postcode to get exactly that, so no state is refused as firmly as QLD.
create or replace function public.vp_jag_gate(p_auth_user_id uuid, p_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_who jsonb; v_state text;
begin
  v_who := public.vp_host_staff(p_auth_user_id, p_venue_id);
  if v_who->>'status' <> 'ok' then return v_who; end if;
  select upper(coalesce(au_state, '')) into v_state from public.vp_venues where id = p_venue_id;
  if coalesce(v_state, '') = '' then return jsonb_build_object('status', 'no_state'); end if;
  if v_state = 'QLD' then return jsonb_build_object('status', 'state_refused'); end if;
  return v_who;
end $$;

-- The board as anyone may see it: never the spot or salt of a game still being played.
-- winner_name is in here for the console; the Worker strips it before anything public.
create or replace function public.vp_jag_board(p_jag_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'venue_id', g.venue_id, 'name', g.name, 'deck_size', g.deck_size,
    'jackpot_cents', g.jackpot_cents, 'commitment', g.commitment, 'status', g.status,
    'created_at', g.created_at, 'ended_at', g.ended_at,
    'revealed_spot', case when g.status <> 'active' then g.revealed_spot end,
    'revealed_salt', case when g.status <> 'active' then g.revealed_salt end,
    'closed_reason', g.closed_reason,
    'carried_from', g.carried_from,
    'carried_into', (select c.id from public.vp_jag_games c where c.carried_from = g.id),
    'turns', coalesce((select jsonb_agg(jsonb_build_object(
                'card', t.card, 'is_joker', t.is_joker, 'jackpot_cents', t.jackpot_cents,
                'winner_name', t.winner_name, 'overridden', t.overridden, 'turned_at', t.turned_at) order by t.turned_at)
              from public.vp_jag_turns t where t.jag_id = g.id), '[]'::jsonb))
  from public.vp_jag_games g where g.id = p_jag_id;
$$;

-- The game a venue is playing now, or the last one it finished.
create or replace function public.vp_jag_current(p_venue_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.vp_jag_board(g.id)
    from public.vp_jag_games g
   where g.venue_id = p_venue_id
   order by (g.status = 'active') desc, g.created_at desc
   limit 1;
$$;

-- THE PUBLIC VIEW IN ONE TRIP: the venue by slug, the board (current, or one past game by id,
-- which must be this venue's), and the last twenty games so last week's reveal is still
-- checkable after a new jackpot starts. The Worker caches this for a few seconds per venue.
create or replace function public.vp_jag_public(p_slug text, p_jag_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_v record; v_board jsonb;
begin
  select id, name, status into v_v from public.vp_venues where slug = p_slug limit 1;
  if not found or v_v.status <> 'active' then return jsonb_build_object('status', 'no_venue'); end if;
  if p_jag_id is null then
    v_board := public.vp_jag_current(v_v.id);
  elsif exists (select 1 from public.vp_jag_games where id = p_jag_id and venue_id = v_v.id) then
    v_board := public.vp_jag_board(p_jag_id);
  else
    return jsonb_build_object('status', 'no_game');
  end if;
  return jsonb_build_object('status', 'ok', 'venue', v_v.name, 'board', v_board,
    'history', coalesce((select jsonb_agg(h order by h.created_at desc) from (
        select g.id, g.name, g.status, g.created_at, g.ended_at, g.jackpot_cents, g.closed_reason
          from public.vp_jag_games g where g.venue_id = v_v.id order by g.created_at desc limit 20) h), '[]'::jsonb));
end $$;

-- START. The Worker has already picked the spot, minted the id and salt, and hashed them.
-- An ended (not won) jackpot's pot CARRIES into the new one by default: the new jackpot is at
-- least what the old one had reached. Only an owner (or HQ) may start without carrying it.
create or replace function public.vp_jag_start(p_auth_user_id uuid, p_venue_id uuid, p_jag_id uuid,
    p_name text, p_deck_size int, p_jackpot_cents int, p_commitment text, p_spot int, p_salt text, p_carry boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_who jsonb; v_prev record; v_pot int; v_from uuid;
begin
  v_who := public.vp_jag_gate(p_auth_user_id, p_venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if p_spot < 1 or p_spot > p_deck_size then return jsonb_build_object('status', 'bad_spot'); end if;
  perform pg_advisory_xact_lock(hashtext('vp_jag:' || p_venue_id::text));
  if exists (select 1 from public.vp_jag_games where venue_id = p_venue_id and status = 'active') then
    return jsonb_build_object('status', 'already_running');
  end if;
  v_pot := greatest(0, p_jackpot_cents);
  select g.id, g.jackpot_cents into v_prev
    from public.vp_jag_games g
   where g.venue_id = p_venue_id
   order by g.created_at desc limit 1;
  if found and exists (select 1 from public.vp_jag_games where id = v_prev.id and status = 'closed')
     and not exists (select 1 from public.vp_jag_games where carried_from = v_prev.id) then
    if p_carry is false then
      if v_who->>'role' <> 'owner' then return jsonb_build_object('status', 'not_owner_carry'); end if;
    else
      v_from := v_prev.id;
      v_pot := greatest(v_pot, v_prev.jackpot_cents);
    end if;
  end if;
  insert into public.vp_jag_games (id, venue_id, name, deck_size, jackpot_cents, commitment, created_by, carried_from)
  values (p_jag_id, p_venue_id, coalesce(nullif(trim(p_name), ''), 'Jag the Joker'), p_deck_size,
          v_pot, p_commitment, p_auth_user_id, v_from);
  insert into public.vp_jag_secrets (jag_id, spot, salt) values (p_jag_id, p_spot, p_salt);
  insert into public.vp_jag_log (jag_id, by_user, actor, what, to_cents, note)
  values (p_jag_id, p_auth_user_id, v_who->>'actor', 'start', v_pot, p_deck_size || ' cards');
  if v_from is not null then
    insert into public.vp_jag_log (jag_id, by_user, actor, what, from_cents, to_cents, note)
    values (p_jag_id, p_auth_user_id, v_who->>'actor', 'carry', v_prev.jackpot_cents, v_pot, 'carried from ' || v_from::text);
  end if;
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

-- TURN A CARD. One at a time per game (FOR UPDATE), each card once (unique), one a night unless
-- an owner or manager overrides, and the answer is decided here against the stored spot, which
-- the caller never sees unless it is the Joker. The jackpot recorded is the SAVED one: a turn
-- never changes the jackpot (that is vp_jag_jackpot's job, and it is logged there).
create or replace function public.vp_jag_turn(p_auth_user_id uuid, p_jag_id uuid, p_card int,
    p_winner_name text, p_override boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_s record; v_who jsonb; v_joker boolean; v_night date; v_who_name text; v_over boolean := false;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_jag_gate(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  if p_card < 1 or p_card > v_g.deck_size then return jsonb_build_object('status', 'bad_card'); end if;
  v_who_name := nullif(left(trim(coalesce(p_winner_name, '')), 60), '');
  if v_who_name is null then return jsonb_build_object('status', 'no_winner'); end if;
  if exists (select 1 from public.vp_jag_turns where jag_id = p_jag_id and card = p_card) then
    return jsonb_build_object('status', 'already_turned');
  end if;
  v_night := public.vp_jag_night(now());
  if exists (select 1 from public.vp_jag_turns where jag_id = p_jag_id and night = v_night) then
    if not coalesce(p_override, false) then return jsonb_build_object('status', 'turned_tonight'); end if;
    if v_who->>'role' not in ('owner', 'manager') then return jsonb_build_object('status', 'not_manager_override'); end if;
    v_over := true;
  end if;
  select * into v_s from public.vp_jag_secrets where jag_id = p_jag_id;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_joker := (p_card = v_s.spot);
  insert into public.vp_jag_turns (jag_id, card, winner_name, jackpot_cents, is_joker, night, overridden, turned_by)
  values (p_jag_id, p_card, v_who_name, v_g.jackpot_cents, v_joker, v_night, v_over, p_auth_user_id);
  insert into public.vp_jag_log (jag_id, by_user, actor, what, from_cents, to_cents, card, note)
  values (p_jag_id, p_auth_user_id, v_who->>'actor', case when v_over then 'override' else 'turn' end,
          v_g.jackpot_cents, v_g.jackpot_cents, p_card, case when v_joker then 'JOKER' else 'no joker' end);
  if v_joker then
    update public.vp_jag_games
       set status = 'won', ended_at = now(), revealed_spot = v_s.spot, revealed_salt = v_s.salt
     where id = p_jag_id;
  end if;
  return jsonb_build_object('status', 'ok', 'is_joker', v_joker, 'board', public.vp_jag_board(p_jag_id));
end $$;

-- THE JACKPOT between turns (it grows as tickets sell). Never on a finished game. Up by any
-- host, DOWN only by an owner or manager, and every change is logged with who made it.
create or replace function public.vp_jag_jackpot(p_auth_user_id uuid, p_jag_id uuid, p_jackpot_cents int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_who jsonb; v_new int;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_jag_gate(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  v_new := greatest(0, p_jackpot_cents);
  if v_new < v_g.jackpot_cents and v_who->>'role' not in ('owner', 'manager') then
    return jsonb_build_object('status', 'not_manager_lower');
  end if;
  if v_new <> v_g.jackpot_cents then
    update public.vp_jag_games set jackpot_cents = v_new where id = p_jag_id;
    insert into public.vp_jag_log (jag_id, by_user, actor, what, from_cents, to_cents)
    values (p_jag_id, p_auth_user_id, v_who->>'actor', 'jackpot', v_g.jackpot_cents, v_new);
  end if;
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

-- END A JACKPOT without a winner. OWNER (or HQ) only, with a reason that goes on the public
-- check page. The spot is revealed so the room can check it never moved, and the pot is not
-- the venue's to keep: vp_jag_start carries it into the next game by default. Not state-gated
-- on purpose, so a game can always be wound up.
create or replace function public.vp_jag_close(p_auth_user_id uuid, p_jag_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_s record; v_who jsonb; v_reason text;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_host_staff(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_who->>'role' <> 'owner' then return jsonb_build_object('status', 'not_owner'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  v_reason := left(trim(coalesce(p_reason, '')), 200);
  if length(v_reason) < 5 then return jsonb_build_object('status', 'no_reason'); end if;
  select * into v_s from public.vp_jag_secrets where jag_id = p_jag_id;
  update public.vp_jag_games
     set status = 'closed', ended_at = now(), revealed_spot = v_s.spot, revealed_salt = v_s.salt,
         closed_reason = v_reason, closed_by = p_auth_user_id
   where id = p_jag_id;
  insert into public.vp_jag_log (jag_id, by_user, actor, what, from_cents, to_cents, note)
  values (p_jag_id, p_auth_user_id, v_who->>'actor', 'close', v_g.jackpot_cents, v_g.jackpot_cents, v_reason);
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

revoke all on function public.vp_jag_night(timestamptz) from public, anon, authenticated;
revoke all on function public.vp_jag_gate(uuid, uuid)  from public, anon, authenticated;
revoke all on function public.vp_jag_board(uuid)   from public, anon, authenticated;
revoke all on function public.vp_jag_current(uuid) from public, anon, authenticated;
revoke all on function public.vp_jag_public(text, uuid) from public, anon, authenticated;
revoke all on function public.vp_jag_start(uuid, uuid, uuid, text, int, int, text, int, text, boolean) from public, anon, authenticated;
revoke all on function public.vp_jag_turn(uuid, uuid, int, text, boolean) from public, anon, authenticated;
revoke all on function public.vp_jag_jackpot(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.vp_jag_close(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.vp_jag_secret_frozen() from public, anon, authenticated;
revoke all on function public.vp_jag_record_frozen() from public, anon, authenticated;
revoke all on function public.vp_jag_game_guard() from public, anon, authenticated;
grant execute on function public.vp_jag_night(timestamptz) to service_role;
grant execute on function public.vp_jag_gate(uuid, uuid)  to service_role;
grant execute on function public.vp_jag_board(uuid)   to service_role;
grant execute on function public.vp_jag_current(uuid) to service_role;
grant execute on function public.vp_jag_public(text, uuid) to service_role;
grant execute on function public.vp_jag_start(uuid, uuid, uuid, text, int, int, text, int, text, boolean) to service_role;
grant execute on function public.vp_jag_turn(uuid, uuid, int, text, boolean) to service_role;
grant execute on function public.vp_jag_jackpot(uuid, uuid, int) to service_role;
grant execute on function public.vp_jag_close(uuid, uuid, text) to service_role;

-- READ BACK: all six should be true.
select
  (select relrowsecurity from pg_class where oid = 'public.vp_jag_secrets'::regclass) as secrets_locked,
  not has_table_privilege('anon', 'public.vp_jag_secrets', 'select')                 as anon_cannot_read_spot,
  not has_function_privilege('anon', 'public.vp_jag_turn(uuid, uuid, int, text, boolean)', 'execute') as anon_cannot_turn,
  (select count(*) = 1 from pg_trigger where tgname = 'vp_jag_secret_frozen'
      and tgrelid = 'public.vp_jag_secrets'::regclass and (tgtype & 8) = 8)            as secret_delete_refused,
  (select count(*) = 1 from pg_trigger where tgname = 'vp_jag_game_guard'
      and tgrelid = 'public.vp_jag_games'::regclass)                                  as game_fingerprint_frozen,
  public.vp_jag_night('2026-10-03 01:30:00+10') = date '2026-10-02'                   as night_rolls_at_2am;
