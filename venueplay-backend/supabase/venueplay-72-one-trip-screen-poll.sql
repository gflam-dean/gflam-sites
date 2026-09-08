-- =====================================================================
-- Migration 72: a television's thirty-second poll is one database trip, not three
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the venueplay-game.js that goes with it. The
--   Worker asks for the function and falls back to the old three-trip path
--   if PostgREST says it is not there, so the order is safe either way.
--
-- WHY. Every screen in the country asks GET /venue?code= (or ?venue=slug)
-- every thirty seconds. On 8 Sep 2026 the load test measured the Supabase
-- gateway at about fifty REST calls a second on the compute we have, and a
-- poll cost three of them one after the other: find the venue, read its
-- row, write the heartbeat. Four thousand screens is 133 polls a second,
-- which is 400 calls a second before a single phone has answered anything.
--
-- vp_screen_poll does the three in one call, in the same order, with the
-- same 25-second heartbeat rule, and returns the same fields the Worker
-- read. A screen sees nothing different but the wait.
--
-- It answers NOTHING (no row) when the code is not stored on any venue, and
-- the Worker then takes the old path, because that path still knows how to
-- reach a venue whose join_code is null from before migration 68 (the
-- derived-code map). Two venues holding the same code is impossible by the
-- unique index, and this returns nothing in that case as well rather than
-- guess, exactly as venueByCode does.
--
-- Service role only. The publishable key is printed in every page and must
-- not be able to write a heartbeat into any venue it names.
-- =====================================================================

begin;

-- p_slug: the screen's own slug (tv.html sends it; older screens send '').
-- p_code: the six-character join code shown on the console.
-- p_version: the build the screen says it is running ('' if it says nothing).
create or replace function public.vp_screen_poll(
  p_slug    text,
  p_code    text,
  p_version text
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
  v_id    uuid;
  v_ver   text := coalesce(nullif(p_version, ''), 'pre-5-sep');
  v_seen  timestamptz;
  v_prev  text;
begin
  -- 1. the slug first, as the Worker does: one indexed row that cannot drift
  if p_slug is not null and p_slug ~ '^[a-z0-9-]{1,80}$' then
    select v.id into v_id from public.vp_venues v where v.slug = p_slug limit 1;
  end if;
  -- 2. then the code; a suspended venue still exists to its own television
  if v_id is null and p_code is not null and p_code ~ '^[ACDEFGHJKMNPQRSTUVWXYZ2345679]{6}$' then
    select v.id into v_id from public.vp_venues v where v.join_code = p_code;
    if (select count(*) from public.vp_venues v where v.join_code = p_code) > 1 then v_id := null; end if;
  end if;
  if v_id is null then return; end if;

  -- 3. the heartbeat: at most one write every 25 seconds per venue, or when the
  --    screen's build changed. Same rule as the Worker had.
  select v.screen_seen_at, v.screen_version into v_seen, v_prev from public.vp_venues v where v.id = v_id;
  if v_seen is null or now() - v_seen > interval '25 seconds' or v_prev is distinct from v_ver then
    update public.vp_venues v set screen_seen_at = now(), screen_version = v_ver where v.id = v_id;
  end if;

  return query
    select v.id, v.name, v.slug, v.status, v.screen_reload_at, v.screen_seen_at, v.screen_version,
           v.screen_command, v.screen_command_at
      from public.vp_venues v where v.id = v_id;
end;
$$;

revoke all on function public.vp_screen_poll(text, text, text) from public, anon, authenticated;
grant execute on function public.vp_screen_poll(text, text, text) to service_role;

comment on function public.vp_screen_poll(text, text, text) is
  'GET /venue for a television in one round trip: find the venue by slug then code, record the 25-second heartbeat, return the screen fields.';

commit;
