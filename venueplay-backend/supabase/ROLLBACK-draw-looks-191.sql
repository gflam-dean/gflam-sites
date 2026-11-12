-- =====================================================================
-- ROLLBACK for migration 191 (every venue on the new draw looks)
-- ---------------------------------------------------------------------
-- Puts each venue's raffle and members draw look back from the snapshot
-- migration 191 took (public.vp_backup_191_draw_looks). Only the two
-- draw_style keys move, and only where the value is still the one 191
-- wrote ('ticket' for a raffle, 'flip' for a members draw) and the
-- snapshot had something else: a look a venue chose on the console since
-- (the race plate, say) is kept, and every other setting saved since is
-- kept. A key the snapshot did not have is removed again; a settings row
-- 191 made (the venue had none) is removed if it still holds only the two
-- looks.
--
-- NOTE: this puts the STORED values back. With the site from
-- fix/draw-looks-switch-12nov live, a stored '' or nothing is still the
-- new look (VPDrawStyle.usual) and there is no "As now" chip: bringing
-- the old draw back to the TVs needs that site change reverted too.
--
-- Not numbered on purpose (two files numbered 191 would turn the gate red).
-- Run by Dean in the SQL editor only if he asks for the old looks back.
-- Safe to run more than once. Keep vp_backup_191_draw_looks until the
-- rollback is no longer wanted.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.vp_backup_191_draw_looks') is null then
    raise exception 'Rollback 191 stopped: there is no snapshot (public.vp_backup_191_draw_looks), nothing was changed';
  end if;
end $$;

-- Raffle look back.
update public.vp_venue_settings s
   set game_prefs = case
         when jsonb_typeof(b.game_prefs -> 'raffle') = 'object' and (b.game_prefs -> 'raffle') ? 'draw_style'
           then jsonb_set(s.game_prefs, array['raffle', 'draw_style'], b.game_prefs -> 'raffle' -> 'draw_style', true)
         else jsonb_set(s.game_prefs, array['raffle'], (s.game_prefs -> 'raffle') - 'draw_style', true)
       end,
       updated_at = now()
  from public.vp_backup_191_draw_looks b
 where b.venue_id = s.venue_id
   and b.had_row
   and s.game_prefs -> 'raffle' ->> 'draw_style' = 'ticket'
   and (b.game_prefs -> 'raffle' ->> 'draw_style') is distinct from 'ticket';

-- Members draw look back.
update public.vp_venue_settings s
   set game_prefs = case
         when jsonb_typeof(b.game_prefs -> 'members') = 'object' and (b.game_prefs -> 'members') ? 'draw_style'
           then jsonb_set(s.game_prefs, array['members', 'draw_style'], b.game_prefs -> 'members' -> 'draw_style', true)
         else jsonb_set(s.game_prefs, array['members'], (s.game_prefs -> 'members') - 'draw_style', true)
       end,
       updated_at = now()
  from public.vp_backup_191_draw_looks b
 where b.venue_id = s.venue_id
   and b.had_row
   and s.game_prefs -> 'members' ->> 'draw_style' = 'flip'
   and (b.game_prefs -> 'members' ->> 'draw_style') is distinct from 'flip';

-- A row 191 made, still holding only the two looks.
delete from public.vp_venue_settings s
 using public.vp_backup_191_draw_looks b
 where b.venue_id = s.venue_id
   and not b.had_row
   and s.game_prefs = '{"raffle":{"draw_style":"ticket"},"members":{"draw_style":"flip"}}'::jsonb;

commit;

-- Read back:
--   select count(*) from public.vp_venue_settings s
--     join public.vp_backup_191_draw_looks b using (venue_id)
--    where b.had_row
--      and ((s.game_prefs -> 'raffle' ->> 'draw_style') is distinct from (b.game_prefs -> 'raffle' ->> 'draw_style')
--        or (s.game_prefs -> 'members' ->> 'draw_style') is distinct from (b.game_prefs -> 'members' ->> 'draw_style'));
-- expects: 0, apart from venues that chose a look on the console after 191 ran
--
-- Only once the rollback is no longer wanted:
--   drop table if exists public.vp_backup_191_draw_looks;
