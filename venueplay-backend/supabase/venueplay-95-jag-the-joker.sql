-- 95: JAG THE JOKER. Built 27 Sep 2026 on branch feature/jag-joker. NOT RUN.
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
-- The secret table is never updated after insert: there is no function here that writes
-- to it except vp_jag_start, and a trigger refuses any UPDATE outright.
--
-- LICENSING: a jackpotting game of chance. Same footing as raffles and the members draw
-- (per-state rules; Queensland needs OLGR approval and is parked). The Worker refuses
-- Queensland venues and every route is OFF unless the Worker has JAG_ON=1. Do not switch it
-- on until the per-state position is confirmed.
--
-- Run once on Sydney, then python3 venueplay-backend/tools/dump-rls-baseline.py and commit
-- RLS-BASELINE.json (three new tables and five functions, all locked to service_role).

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
  revealed_salt   text
);
create unique index if not exists vp_jag_one_active on public.vp_jag_games (venue_id) where status = 'active';
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
  winner_name    text check (winner_name is null or length(winner_name) <= 60),
  jackpot_cents  int  not null default 0,
  is_joker       boolean not null default false,
  turned_at      timestamptz not null default now(),
  turned_by      uuid,
  unique (jag_id, card)
);

alter table public.vp_jag_games   enable row level security;
alter table public.vp_jag_secrets enable row level security;
alter table public.vp_jag_turns   enable row level security;
revoke all on public.vp_jag_games, public.vp_jag_secrets, public.vp_jag_turns from anon, authenticated;
-- No policies: every read and write goes through the Worker with the service key.

-- The spot does not move. Not by a function, not by hand in the dashboard by mistake.
create or replace function public.vp_jag_secret_frozen() returns trigger
language plpgsql as $$
begin
  raise exception 'A Jag the Joker spot never changes once it is set';
end $$;
drop trigger if exists vp_jag_secret_frozen on public.vp_jag_secrets;
create trigger vp_jag_secret_frozen before update on public.vp_jag_secrets
  for each row execute function public.vp_jag_secret_frozen();

-- ---------------------------------------------------------------------------------------
-- The board as anyone may see it: never the spot or salt of a game still being played.
create or replace function public.vp_jag_board(p_jag_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'venue_id', g.venue_id, 'name', g.name, 'deck_size', g.deck_size,
    'jackpot_cents', g.jackpot_cents, 'commitment', g.commitment, 'status', g.status,
    'created_at', g.created_at, 'ended_at', g.ended_at,
    'revealed_spot', case when g.status <> 'active' then g.revealed_spot end,
    'revealed_salt', case when g.status <> 'active' then g.revealed_salt end,
    'turns', coalesce((select jsonb_agg(jsonb_build_object(
                'card', t.card, 'is_joker', t.is_joker, 'jackpot_cents', t.jackpot_cents,
                'winner_name', t.winner_name, 'turned_at', t.turned_at) order by t.turned_at)
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

-- START. The Worker has already picked the spot, minted the id and salt, and hashed them.
create or replace function public.vp_jag_start(p_auth_user_id uuid, p_venue_id uuid, p_jag_id uuid,
    p_name text, p_deck_size int, p_jackpot_cents int, p_commitment text, p_spot int, p_salt text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_who jsonb;
begin
  v_who := public.vp_host_staff(p_auth_user_id, p_venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if p_spot < 1 or p_spot > p_deck_size then return jsonb_build_object('status', 'bad_spot'); end if;
  perform pg_advisory_xact_lock(hashtext('vp_jag:' || p_venue_id::text));
  if exists (select 1 from public.vp_jag_games where venue_id = p_venue_id and status = 'active') then
    return jsonb_build_object('status', 'already_running');
  end if;
  insert into public.vp_jag_games (id, venue_id, name, deck_size, jackpot_cents, commitment, created_by)
  values (p_jag_id, p_venue_id, coalesce(nullif(trim(p_name), ''), 'Jag the Joker'), p_deck_size,
          greatest(0, p_jackpot_cents), p_commitment, p_auth_user_id);
  insert into public.vp_jag_secrets (jag_id, spot, salt) values (p_jag_id, p_spot, p_salt);
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

-- TURN A CARD. One at a time per game (FOR UPDATE), each card once (unique), and the answer
-- is decided here against the stored spot, which the caller never sees unless it is the Joker.
create or replace function public.vp_jag_turn(p_auth_user_id uuid, p_jag_id uuid, p_card int,
    p_winner_name text, p_jackpot_cents int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_s record; v_who jsonb; v_joker boolean;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_host_staff(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  if p_card < 1 or p_card > v_g.deck_size then return jsonb_build_object('status', 'bad_card'); end if;
  if exists (select 1 from public.vp_jag_turns where jag_id = p_jag_id and card = p_card) then
    return jsonb_build_object('status', 'already_turned');
  end if;
  select * into v_s from public.vp_jag_secrets where jag_id = p_jag_id;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_joker := (p_card = v_s.spot);
  if p_jackpot_cents is not null and p_jackpot_cents >= 0 then
    update public.vp_jag_games set jackpot_cents = p_jackpot_cents where id = p_jag_id;
    v_g.jackpot_cents := p_jackpot_cents;
  end if;
  insert into public.vp_jag_turns (jag_id, card, winner_name, jackpot_cents, is_joker, turned_by)
  values (p_jag_id, p_card, nullif(left(trim(coalesce(p_winner_name, '')), 60), ''), v_g.jackpot_cents, v_joker, p_auth_user_id);
  if v_joker then
    update public.vp_jag_games
       set status = 'won', ended_at = now(), revealed_spot = v_s.spot, revealed_salt = v_s.salt
     where id = p_jag_id;
  end if;
  return jsonb_build_object('status', 'ok', 'is_joker', v_joker, 'board', public.vp_jag_board(p_jag_id));
end $$;

-- THE JACKPOT between turns (it grows as tickets sell). Never on a finished game.
create or replace function public.vp_jag_jackpot(p_auth_user_id uuid, p_jag_id uuid, p_jackpot_cents int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_who jsonb;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_host_staff(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  update public.vp_jag_games set jackpot_cents = greatest(0, p_jackpot_cents) where id = p_jag_id;
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

-- CLOSE without a winner (the venue stops running it). The spot is revealed, so the room can
-- still check it was never moved. Owners and managers only.
create or replace function public.vp_jag_close(p_auth_user_id uuid, p_jag_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_s record; v_who jsonb;
begin
  select * into v_g from public.vp_jag_games where id = p_jag_id for update;
  if not found then return jsonb_build_object('status', 'no_game'); end if;
  v_who := public.vp_host_staff(p_auth_user_id, v_g.venue_id);
  if v_who->>'status' <> 'ok' then return jsonb_build_object('status', v_who->>'status'); end if;
  if v_who->>'role' not in ('owner', 'manager') then return jsonb_build_object('status', 'not_manager'); end if;
  if v_g.status <> 'active' then return jsonb_build_object('status', 'finished'); end if;
  select * into v_s from public.vp_jag_secrets where jag_id = p_jag_id;
  update public.vp_jag_games
     set status = 'closed', ended_at = now(), revealed_spot = v_s.spot, revealed_salt = v_s.salt
   where id = p_jag_id;
  return jsonb_build_object('status', 'ok', 'board', public.vp_jag_board(p_jag_id));
end $$;

revoke all on function public.vp_jag_board(uuid)   from public, anon, authenticated;
revoke all on function public.vp_jag_current(uuid) from public, anon, authenticated;
revoke all on function public.vp_jag_start(uuid, uuid, uuid, text, int, int, text, int, text) from public, anon, authenticated;
revoke all on function public.vp_jag_turn(uuid, uuid, int, text, int) from public, anon, authenticated;
revoke all on function public.vp_jag_jackpot(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.vp_jag_close(uuid, uuid) from public, anon, authenticated;
revoke all on function public.vp_jag_secret_frozen() from public, anon, authenticated;
grant execute on function public.vp_jag_board(uuid)   to service_role;
grant execute on function public.vp_jag_current(uuid) to service_role;
grant execute on function public.vp_jag_start(uuid, uuid, uuid, text, int, int, text, int, text) to service_role;
grant execute on function public.vp_jag_turn(uuid, uuid, int, text, int) to service_role;
grant execute on function public.vp_jag_jackpot(uuid, uuid, int) to service_role;
grant execute on function public.vp_jag_close(uuid, uuid) to service_role;

-- READ BACK: all three should be true.
select
  (select relrowsecurity from pg_class where oid = 'public.vp_jag_secrets'::regclass) as secrets_locked,
  not has_table_privilege('anon', 'public.vp_jag_secrets', 'select')                 as anon_cannot_read_spot,
  not has_function_privilege('anon', 'public.vp_jag_turn(uuid, uuid, int, text, int)', 'execute') as anon_cannot_turn;
