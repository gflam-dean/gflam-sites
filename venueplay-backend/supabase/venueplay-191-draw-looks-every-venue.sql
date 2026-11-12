-- =====================================================================
-- Migration 191: every venue on the new draw looks
-- ---------------------------------------------------------------------
-- Dean, 12 November 2026 (INBOX 284; FINDINGS R4/R5/D5): The Mini Bar's
-- "Usual" draw look was the OLD draw (the '' that "As now" saved), so
-- after the release Dean saw the old raffle and members draw and heard the
-- old draw sound. His three agreed looks are TICKET ROLL (raffle), FLIP
-- BOARD (members draw) and RACE PLATE (an option for racing and footy
-- rooms). Switch every venue. This is Dean's EXPLICIT exception to
-- "defaults never move existing venues", for the draw look only.
--
-- 1. SNAPSHOT. vp_backup_191_draw_looks keeps every venue's game_prefs as
--    it was, and whether it had a vp_venue_settings row at all, before
--    anything below runs (the same pattern as migration 186's
--    vp_backup_186_game_prefs). Service role only (RLS on, nothing granted).
--    Taken once: a second run keeps the first snapshot.
-- 2. GUARD. Every venue must have its snapshot row before anything is
--    changed; if not, the whole migration stops (raise) and nothing changes.
-- 3. RAFFLE: game_prefs.raffle.draw_style = 'ticket' wherever it is not
--    already 'ticket' or 'race' ('' from "As now", missing, anything else).
--    A venue that chose the RACE PLATE explicitly keeps it.
-- 4. MEMBERS: game_prefs.members.draw_style = 'flip' wherever it is not
--    already 'flip' or 'race'. The race plate is kept the same way.
--    Only that one key per game changes (the same one-key merge as
--    vp_set_game_prefs, migration 121): draw_time, prizes, draw_id and
--    every other game's settings are left as they are.
-- 5. A venue with no settings row gets one holding only the two looks
--    (vp_set_game_prefs makes the same row on a first save).
--
-- ORDER: ANY ORDER with the site (fix/draw-looks-switch-12nov). The game
-- Worker does not change: its allowlist already accepts 'ticket', 'flip'
-- and 'race'. Before the site ships, the live consoles read 'ticket'/'flip'
-- and send that look with the draw (the TVs already draw it: Mini Bar,
-- 12 Nov). After the site ships, a stored '' (or nothing) is the new look
-- anyway (VPDrawStyle.usual), so this migration and the site each switch a
-- venue on their own and together they agree. Dean runs it EARLY in the
-- SQL editor; main reads it back.
--
-- NUMBER: 186 live; 187 (logo after leaving), 188 and 190 (screens list),
-- 189 (what's on) written on branches; checked every branch and worktree
-- 12 Nov 2026, so 191. Branch fix/draw-looks-switch-12nov. NOT RUN.
--
-- RLS-BASELINE.json: ONE new table (vp_backup_191_draw_looks, RLS on, no
-- policy, no grant to anon or authenticated). Re-dump it after this runs.
-- Safe to run more than once: the snapshot is taken only once and a venue
-- already on a new look is not touched.
-- Also: tools/draw-looks-snapshot.py writes the same snapshot to a dated
-- CSV + JSON under ~/venue-enrich/reports/draw-looks-snapshot/ (main runs
-- it BEFORE this), and ROLLBACK-draw-looks-191.sql puts it back.
-- =====================================================================

begin;

-- 1. Snapshot (first run only).
create table if not exists public.vp_backup_191_draw_looks (
  venue_id    uuid primary key,
  had_row     boolean not null,
  game_prefs  jsonb,
  taken_at    timestamptz not null default now()
);
alter table public.vp_backup_191_draw_looks enable row level security;
revoke all on public.vp_backup_191_draw_looks from public;
revoke all on public.vp_backup_191_draw_looks from anon, authenticated;

insert into public.vp_backup_191_draw_looks (venue_id, had_row, game_prefs)
select v.id, (s.venue_id is not null), s.game_prefs
  from public.vp_venues v
  left join public.vp_venue_settings s on s.venue_id = v.id
on conflict (venue_id) do nothing;

-- 2. Guard: no venue is changed without its snapshot.
do $$
declare
  missing integer;
begin
  select count(*) into missing
    from public.vp_venues v
   where not exists (select 1 from public.vp_backup_191_draw_looks b where b.venue_id = v.id);
  if missing > 0 then
    raise exception 'Migration 191 stopped: % venue(s) have no snapshot row, nothing was changed', missing;
  end if;
end $$;

-- 3. Raffle: the ticket roll, unless the venue chose the race plate.
update public.vp_venue_settings s
   set game_prefs = jsonb_set(coalesce(s.game_prefs, '{}'::jsonb), array['raffle'],
                              (case when jsonb_typeof(s.game_prefs -> 'raffle') = 'object' then s.game_prefs -> 'raffle' else '{}'::jsonb end)
                              || '{"draw_style":"ticket"}'::jsonb, true),
       updated_at = now()
 where coalesce(s.game_prefs -> 'raffle' ->> 'draw_style', '') not in ('ticket', 'race');

-- 4. Members draw: the flip board, unless the venue chose the race plate.
update public.vp_venue_settings s
   set game_prefs = jsonb_set(coalesce(s.game_prefs, '{}'::jsonb), array['members'],
                              (case when jsonb_typeof(s.game_prefs -> 'members') = 'object' then s.game_prefs -> 'members' else '{}'::jsonb end)
                              || '{"draw_style":"flip"}'::jsonb, true),
       updated_at = now()
 where coalesce(s.game_prefs -> 'members' ->> 'draw_style', '') not in ('flip', 'race');

-- 5. A venue with no settings row: a row holding only the two looks.
insert into public.vp_venue_settings (venue_id, game_prefs, updated_at)
select v.id, '{"raffle":{"draw_style":"ticket"},"members":{"draw_style":"flip"}}'::jsonb, now()
  from public.vp_venues v
 where not exists (select 1 from public.vp_venue_settings s where s.venue_id = v.id)
on conflict (venue_id) do nothing;

commit;

-- Read back:
--   select count(*) from public.vp_venues v
--     left join public.vp_venue_settings s on s.venue_id = v.id
--    where coalesce(s.game_prefs -> 'raffle' ->> 'draw_style', '') not in ('ticket', 'race')
--       or coalesce(s.game_prefs -> 'members' ->> 'draw_style', '') not in ('flip', 'race');
-- expects: 0 (every venue on a new look)
--   select count(*) from public.vp_venue_settings s
--     join public.vp_backup_191_draw_looks b using (venue_id)
--    where (b.game_prefs -> 'raffle' ->> 'draw_style' = 'race' and s.game_prefs -> 'raffle' ->> 'draw_style' <> 'race')
--       or (b.game_prefs -> 'members' ->> 'draw_style' = 'race' and s.game_prefs -> 'members' ->> 'draw_style' <> 'race');
-- expects: 0 (every race plate kept; a venue that changed it since on the console is the only exception)
--   select (select count(*) from public.vp_backup_191_draw_looks) as snapshot, (select count(*) from public.vp_venues) as venues;
-- expects: the two counts equal
--   select relrowsecurity from pg_class where oid = 'public.vp_backup_191_draw_looks'::regclass;
-- expects: true
--
-- Rollback: ROLLBACK-draw-looks-191.sql (puts each venue's two draw looks back from the snapshot).
