-- =====================================================================
-- Migration 138: what kind of TV each venue screen is
-- ---------------------------------------------------------------------
--   NOT RUN. Numbered 138 on 1 Nov 2026 after checking every branch: 136 was the highest
--   anywhere, and feature/lowercase-legal-2nov was writing one the same day (likely 137).
--   If 138 is taken by the time this ships, renumber this file and its MIGRATIONS.md line.
--
--   Safe to run any number of times, and in any order with the game Worker and tv.html:
--   until it is run the Worker gets a 404 for vp_screen_poll_kind, answers the screen from
--   vp_screen_poll in the same request, and stops asking for the rest of that isolate's
--   life. HQ says "TV types start when migration 138 is run". Nothing else changes.
--   After running: python3 venueplay-backend/tools/dump-rls-baseline.py and commit
--   RLS-BASELINE.json (one new table with one admin-only read policy, one definer function).
--
-- WHY. Dean, 1 Nov 2026: we do not know what TVs our venues use, so we cannot say whether a
-- Samsung or LG app is worth building. Each screen works out a coarse TYPE from its own
-- browser (venueplay/app/vp-tvtype.js, the one list of types) and says it once per page load.
--
-- WHAT IS KEPT. A short type code (for example 'samsung'), a random id the TV made for itself
-- (localStorage, nothing about a person), and when it was first and last seen. NEVER the user
-- agent string, never a model number, never an address.
--
-- NO EXTRA CALL. The TV adds &tvk=&tvd= to the /venue poll it already makes every 30 seconds,
-- once per page load (an idle screen reloads every four hours, so about six times a day). The
-- game Worker then calls vp_screen_poll_kind instead of vp_screen_poll: the same answer, and
-- the type kept in the same call. Never on the same poll as the slide tally (migration 135).
--
-- BOUNDS, because GET /venue is public. Code ^[a-z]{2,12}$, id ^[A-Za-z0-9_-]{6,40}$. A NEW id
-- at a venue that already has 20 screens seen in the last 60 days is not believed. Rows not
-- seen for 180 days are cleared for that venue when it next reports. The type block sits in
-- its own exception block, so nothing here can cost a screen its answer.
--
-- LOCKED. RLS on. anon: nothing. authenticated: SELECT only, and the one policy lets only an
-- HQ admin (vp_is_platform_admin()) see a row, so a venue login reads nothing. Writes only
-- through the definer function, which only the service role (the game Worker) may call.
-- =====================================================================

begin;

create table if not exists public.vp_screen_devices (
  venue_id       uuid not null references public.vp_venues(id) on delete cascade,
  device_id      text not null check (device_id ~ '^[A-Za-z0-9_-]{6,40}$'),
  kind           text not null check (kind ~ '^[a-z]{2,12}$'),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (venue_id, device_id)
);
create index if not exists vp_screen_devices_seen_idx on public.vp_screen_devices (last_seen_at desc);

alter table public.vp_screen_devices enable row level security;
revoke all on public.vp_screen_devices from public, anon, authenticated;
grant select on public.vp_screen_devices to authenticated;
grant select, insert, update, delete on public.vp_screen_devices to service_role;

drop policy if exists "HQ reads screen devices" on public.vp_screen_devices;
create policy "HQ reads screen devices" on public.vp_screen_devices
  for select to authenticated
  using (public.vp_is_platform_admin());

create or replace function public.vp_screen_poll_kind(
  p_slug    text,
  p_code    text,
  p_version text,
  p_kind    text,
  p_device  text
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
  v_id uuid;
begin
  -- 1. exactly what the TV got before: the venue, the heartbeat, the screen fields
  return query select * from public.vp_screen_poll(p_slug, p_code, p_version);

  -- 2. the TV's type, in its own block, so nothing here can cost the screen its answer
  begin
    if p_kind is null or p_kind !~ '^[a-z]{2,12}$' then return; end if;
    if p_device is null or p_device !~ '^[A-Za-z0-9_-]{6,40}$' then return; end if;
    if p_slug is not null and p_slug ~ '^[a-z0-9-]{1,80}$' then
      select x.id into v_id from public.vp_venues x where x.slug = p_slug limit 1;
    end if;
    if v_id is null then return; end if;
    -- a new screen at a venue that already has twenty recent ones is not believed
    if not exists (select 1 from public.vp_screen_devices s where s.venue_id = v_id and s.device_id = p_device)
       and (select count(*) from public.vp_screen_devices s
             where s.venue_id = v_id and s.last_seen_at > now() - interval '60 days') >= 20 then
      return;
    end if;
    insert into public.vp_screen_devices as s (venue_id, device_id, kind, first_seen_at, last_seen_at)
      values (v_id, p_device, p_kind, now(), now())
      on conflict (venue_id, device_id) do update
        set kind = excluded.kind, last_seen_at = now();
    delete from public.vp_screen_devices s
     where s.venue_id = v_id and s.last_seen_at < now() - interval '180 days';
  exception when others then
    return;   -- a bad type is dropped; the screen's answer above has already gone
  end;
end;
$$;

revoke all on function public.vp_screen_poll_kind(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vp_screen_poll_kind(text, text, text, text, text) to service_role;
comment on function public.vp_screen_poll_kind(text, text, text, text, text) is
  'GET /venue for a television that is also saying what kind of TV it is: vp_screen_poll''s answer, and the type kept in vp_screen_devices, in the same call.';

-- SELF-CHECK: refuse to commit if a venue login or the public key could read or write it.
do $check$
begin
  if has_table_privilege('anon', 'public.vp_screen_devices', 'select')
     or has_table_privilege('anon', 'public.vp_screen_devices', 'insert')
     or has_table_privilege('authenticated', 'public.vp_screen_devices', 'insert')
     or has_table_privilege('authenticated', 'public.vp_screen_devices', 'update')
     or has_table_privilege('authenticated', 'public.vp_screen_devices', 'delete')
     or has_function_privilege('anon', 'public.vp_screen_poll_kind(text, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.vp_screen_poll_kind(text, text, text, text, text)', 'execute') then
    raise exception 'Migration 138 self-check: the public key or a venue login can reach vp_screen_devices or vp_screen_poll_kind';
  end if;
end;
$check$;

commit;

-- Read back (service role): POST /rest/v1/rpc/vp_screen_poll_kind with
--   {"p_slug":"test-alpha","p_code":"","p_version":"readback","p_kind":"pc","p_device":"dreadback0000000000"}
-- answers Test Alpha's row, and GET /rest/v1/vp_screen_devices?select=kind&venue_id=eq.<test alpha id>
-- shows kind 'pc'. Then delete that one row:
--   delete from public.vp_screen_devices where device_id = 'dreadback0000000000';
-- With the anon key: GET /rest/v1/vp_screen_devices answers 401/permission denied, and the RPC is refused.

-- Rollback:
--   drop function if exists public.vp_screen_poll_kind(text, text, text, text, text);
--   drop table if exists public.vp_screen_devices;
