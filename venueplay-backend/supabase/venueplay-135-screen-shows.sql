-- =====================================================================
-- Migration 135: how often each advert and slide was on a venue's TV
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times, and in any order with the
--   Workers and tv.html: until it is run the game Worker gets a 404 for
--   vp_screen_poll_shown, falls back to vp_screen_poll for the rest of that
--   isolate's life, and the counts are simply not kept (the TV keeps its own
--   running total for the night and sends it again, so a night is caught up
--   as soon as this is run). The monthly report says "not counted yet".
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
--   commit RLS-BASELINE.json (one new table, one new definer function).
--
-- WHY. Dean, 30 Oct 2026: "can we tell how much advertising is displayed",
-- then 31 Oct: yes, build it, with no extra database call at peak.
--
-- HOW, AND WHY IT COSTS NO EXTRA CALL. Every TV already polls GET /venue every
-- 30 seconds, and the game Worker answers it with ONE database call,
-- vp_screen_poll (migration 72), which also writes the heartbeat. The TV now
-- keeps a tally per slide for tonight (shows, and seconds on screen) and, every
-- few minutes, sends its RUNNING TOTAL on that same poll. The Worker then calls
-- vp_screen_poll_shown instead: the same answer from vp_screen_poll, and the
-- tally written inside the same call. No new request, no second round trip.
--
-- RUNNING TOTALS, NOT ADDITIONS. The TV sends "tonight, this screen, this
-- slide: 412 shows, 2,884 seconds", and the row keeps the GREATER of what it
-- had and what came. A retried or lost poll cannot double count or lose a
-- night. Each screen has its own id (per browser tab), so two TVs in one room
-- add up, and one TV reloading carries on from where it was.
--
-- BOUNDS, because GET /venue is public. A night must be tonight or last night
-- on the VENUE's clock (2am to 2am, the report's rule). At most 40 slides a
-- call, at most 12 screens a venue a night, shows <= 20,000 and seconds <=
-- 86,400 per row. A tally that is malformed is ignored; it never stops the
-- screen getting its answer (the tally sits in its own exception block).
--
-- LOCKED. Only the service role reaches the table and the function: RLS on,
-- no policies, anon/authenticated named in the revokes (migration 32).
-- =====================================================================

begin;

create table if not exists public.vp_screen_shows (
  venue_id    uuid not null references public.vp_venues(id) on delete cascade,
  night       date not null,
  screen_id   text not null check (screen_id ~ '^[A-Za-z0-9_-]{6,40}$'),
  slide_key   text not null check (char_length(slide_key) between 3 and 90),
  shows       integer not null default 0 check (shows between 0 and 20000),
  seconds     integer not null default 0 check (seconds between 0 and 86400),
  updated_at  timestamptz not null default now(),
  primary key (venue_id, night, screen_id, slide_key)
);
create index if not exists vp_screen_shows_venue_night_idx on public.vp_screen_shows (venue_id, night);

alter table public.vp_screen_shows enable row level security;
revoke all on public.vp_screen_shows from public, anon, authenticated;
grant select, insert, update, delete on public.vp_screen_shows to service_role;

create or replace function public.vp_screen_poll_shown(
  p_slug    text,
  p_code    text,
  p_version text,
  p_shown   jsonb
)
returns table(
  id                uuid,
  name              text,
  slug              text,
  status            text,
  screen_reload_at  timestamptz,
  screen_seen_at    timestamptz,
  screen_version    text,
  screen_command    text,
  screen_command_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_tz     text;
  v_night  date;
  v_n      date;
  v_sid    text;
  v_key    text;
  v_val    jsonb;
  v_shows  integer;
  v_secs   integer;
  v_count  integer := 0;
begin
  -- 1. exactly what the TV got before: the venue, the heartbeat, the screen fields
  return query select * from public.vp_screen_poll(p_slug, p_code, p_version);

  -- 2. the tally, in its own block, so nothing here can cost the screen its answer
  begin
    if p_shown is null or jsonb_typeof(p_shown) <> 'object' or jsonb_typeof(p_shown->'c') <> 'object' then return; end if;
    v_sid := p_shown->>'s';
    if v_sid is null or v_sid !~ '^[A-Za-z0-9_-]{6,40}$' then return; end if;
    if p_slug is not null and p_slug ~ '^[a-z0-9-]{1,80}$' then
      select x.id, x.timezone into v_id, v_tz from public.vp_venues x where x.slug = p_slug limit 1;
    end if;
    if v_id is null then return; end if;
    v_night := ((now() at time zone coalesce(nullif(v_tz, ''), 'Australia/Brisbane')) - interval '2 hours')::date;
    v_n := (p_shown->>'n')::date;
    if v_n is null or (v_n <> v_night and v_n <> v_night - 1) then return; end if;
    -- a new screen at a venue that already has twelve tonight is not believed
    if not exists (select 1 from public.vp_screen_shows s where s.venue_id = v_id and s.night = v_n and s.screen_id = v_sid)
       and (select count(distinct s.screen_id) from public.vp_screen_shows s where s.venue_id = v_id and s.night = v_n) >= 12 then
      return;
    end if;
    for v_key, v_val in select e.key, e.value from jsonb_each(p_shown->'c') e loop
      v_count := v_count + 1;
      exit when v_count > 40;
      continue when v_key !~ '^(i|t|auto):.{1,80}$' or jsonb_typeof(v_val) <> 'array';
      v_shows := least(greatest(coalesce((v_val->>0)::integer, 0), 0), 20000);
      v_secs  := least(greatest(coalesce((v_val->>1)::integer, 0), 0), 86400);
      continue when v_shows = 0;
      insert into public.vp_screen_shows as s (venue_id, night, screen_id, slide_key, shows, seconds, updated_at)
        values (v_id, v_n, v_sid, v_key, v_shows, v_secs, now())
        on conflict (venue_id, night, screen_id, slide_key) do update
          set shows = greatest(s.shows, excluded.shows), seconds = greatest(s.seconds, excluded.seconds), updated_at = now()
          where excluded.shows > s.shows or excluded.seconds > s.seconds;
    end loop;
  exception when others then
    return;   -- a bad tally is dropped; the screen's answer above has already gone
  end;
end;
$$;

revoke all on function public.vp_screen_poll_shown(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.vp_screen_poll_shown(text, text, text, jsonb) to service_role;
comment on function public.vp_screen_poll_shown(text, text, text, jsonb) is
  'GET /venue for a television that is also sending tonight''s slide tally: vp_screen_poll''s answer, and the running totals kept in vp_screen_shows, in the same call.';

commit;

-- Read back (service role): POST /rest/v1/rpc/vp_screen_poll_shown with
--   {"p_slug":"test-alpha","p_code":"","p_version":"readback","p_shown":null}
-- answers Test Alpha's row, and GET /rest/v1/vp_screen_shows?select=venue_id&limit=1 answers 200.
-- With the anon key both are refused.

-- Rollback:
--   drop function if exists public.vp_screen_poll_shown(text, text, text, jsonb);
--   drop table if exists public.vp_screen_shows;
