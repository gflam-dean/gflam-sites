-- =====================================================================
-- Migration 70: the bingo ball order lives on the server, and every ball
--               is recorded as it is called
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the venueplay-game.js that goes with it. If
--   the Worker is pasted first, the console notices the server draw is
--   not there and calls the night from the tablet, exactly as before, so
--   nothing breaks. But every night until then is recorded as a tablet
--   draw, and the point of this is the record.
--
-- WHY. Bingo has always been called from the host's tablet, one ball at
-- a time with a rejection-sampled CSPRNG, and no future ball ever sat in
-- the browser. That is fair. It is not PROVABLY fair: the pick happened
-- on a device the host controls, with nothing written down until the end
-- of game report, which the same device wrote.
--
-- OLGR's RNG minimum technical requirements (v1.5) want the generator's
-- state kept secret inside the RNG (4.2.2) and the scaled results
-- testable (4.7.3). The raffle and the members draw already draw inside
-- the Worker for that reason. This brings bingo level with them:
--
--   vp_bingo_draws        one row per game. The full Fisher-Yates order of
--                         1..90 is written at game start and NEVER sent to
--                         any client. draw_index says how many are out.
--   vp_bingo_draw_balls   one row per ball, with the time it was called and
--                         where the pick was made. A regulator asking "show
--                         me Thursday's draw" gets an answer.
--   vp_bingo_next_ball    advances draw_index and writes the ball row in one
--                         statement, so two consoles, or one double tap, can
--                         never both draw the same position.
--
-- THE FALLBACK IS DELIBERATE. A pub's wifi drops. If the Worker cannot be
-- reached inside a few seconds the console draws from its own remaining
-- pool for the rest of that game (the same CSPRNG it has always used) and
-- tells the server so, best effort. mode flips to 'local' and fallback_at
-- says which ball. A night never stops because a server did; the record
-- just says honestly which balls were called from where.
--
-- Nothing here is readable by the anon or authenticated keys. The Worker
-- holds the service_role key and is the only thing that touches these.
-- =====================================================================

begin;

create table if not exists public.vp_bingo_draws (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.vp_venues(id) on delete cascade,
  session_id   uuid references public.vp_sessions(id) on delete set null,
  draw_seed    text not null,                     -- random token stored beside the order, for audit
  draw_order   int[] not null,                    -- Fisher-Yates over 1..90; never leaves the server
  draw_index   int  not null default 0,           -- balls called so far = draw_order[1..draw_index]
  mode         text not null default 'server' check (mode in ('server', 'local')),
  fallback_at  int,                               -- the ordinal of the first ball called from the tablet
  fallback_why text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists vp_bingo_draws_venue_idx on public.vp_bingo_draws (venue_id, created_at desc);

create table if not exists public.vp_bingo_draw_balls (
  draw_id   uuid not null references public.vp_bingo_draws(id) on delete cascade,
  ordinal   int  not null,                        -- 1 = first ball called
  number    int  not null check (number between 1 and 90),
  source    text not null default 'server' check (source in ('server', 'local')),
  drawn_at  timestamptz not null default now(),
  primary key (draw_id, ordinal),
  unique (draw_id, number)                        -- a ball is called once, whoever called it
);

comment on table public.vp_bingo_draws is
  'One row per bingo game: the server-side ball order (never sent to a client) and how far through it the game is.';
comment on table public.vp_bingo_draw_balls is
  'Every ball called, when, and whether the server or (after a wifi failure) the tablet picked it.';

-- Draw the next ball atomically: bump draw_index and write the ball row in one
-- statement, returning what was drawn. No row back means every ball is out (or
-- the draw does not exist). Locking the draw row first means two requests that
-- arrive together are serialised rather than both reading the same index.
create or replace function public.vp_bingo_next_ball(p_draw uuid)
returns table(number int, new_index int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_len   int;
  v_idx   int;
  v_num   int;
begin
  select array_length(draw_order, 1), draw_index
    into v_len, v_idx
    from public.vp_bingo_draws
   where id = p_draw
   for update;

  if v_len is null or v_idx >= v_len then
    return;
  end if;

  update public.vp_bingo_draws
     set draw_index = draw_index + 1
   where id = p_draw
  returning draw_order[draw_index], draw_index into v_num, v_idx;

  insert into public.vp_bingo_draw_balls (draw_id, ordinal, number, source)
  values (p_draw, v_idx, v_num, 'server');

  number := v_num;
  new_index := v_idx;
  return next;
end;
$$;

-- Service role only. The anon key is printed in every page and the
-- authenticated key belongs to a host; neither may read the order.
alter table public.vp_bingo_draws enable row level security;
alter table public.vp_bingo_draw_balls enable row level security;
revoke all on public.vp_bingo_draws from public, anon, authenticated;
revoke all on public.vp_bingo_draw_balls from public, anon, authenticated;
revoke all on function public.vp_bingo_next_ball(uuid) from public, anon, authenticated;
grant execute on function public.vp_bingo_next_ball(uuid) to service_role;

commit;
