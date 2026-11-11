-- =====================================================================
-- Migration 186: musical bingo "Any line", and every venue's pattern kept
-- ---------------------------------------------------------------------
-- Dean, 11 November 2026 (INBOX 256): on The Mini Bar he finished the
-- right-hand COLUMN on "One line across" and expected a win. "One line"
-- is rows only. He chose a new pattern, "Any line" (a full row, column
-- or diagonal), and made it the DEFAULT FOR NEW VENUES. Existing venues
-- keep the pattern they have now (feedback_defaults_never_move_existing:
-- store each venue's value explicitly, snapshot first).
--
-- 1. SNAPSHOT. vp_backup_186_game_prefs keeps every venue's game_prefs as
--    it was, and whether it had a vp_venue_settings row at all, before
--    anything below runs. Service role only (RLS on, nothing granted).
-- 2. EXPLICIT PATTERN. Every venue whose game_prefs has no musical pattern
--    gets game_prefs.musical.pattern = 'one', the pattern the console has
--    started on until now (its dropdown's first choice). The same merge as
--    vp_set_game_prefs (migration 121): only that one key is added, every
--    other game and every other musical setting is left alone. A venue that
--    already saved a pattern is not touched. A venue with no settings row
--    gets a row holding only that (vp_set_game_prefs makes the same row).
-- 3. vp_music_games.pattern accepts 'any_line'. The column's rule is not in
--    the repo, so this finds it: a CHECK naming pattern is replaced by one
--    with 'any_line' added; an enum type gets the value added. Neither: no
--    change (any text is already accepted).
--
-- ORDER: RUN THIS BEFORE deploying the game Worker and the musical pages
-- from fix/any-line-15nov. The new console starts on "Any line" for a venue
-- with no saved pattern, so before this runs every existing venue that never
-- saved one would move to "Any line"; and if the column has a CHECK, the new
-- Worker cannot start an "Any line" game until 'any_line' is allowed.
-- Running it early is safe: the live Worker and console never send
-- 'any_line', and 'one' is what they already use.
--
-- NUMBER: 181, 184, 185 (and 160, 162, 164) are taken, 183 was spoken for;
-- checked every branch and worktree 11 Nov 2026, so 186.
-- Branch fix/any-line-15nov. NOT RUN.
--
-- RLS-BASELINE.json: ONE new table (vp_backup_186_game_prefs, RLS on, no
-- policy, no grant to anon or authenticated). Re-dump it after this runs.
-- Safe to run more than once: the snapshot is taken only once, and the
-- explicit pattern only goes where there is none.
-- =====================================================================

-- 1. Snapshot (first run only).
create table if not exists public.vp_backup_186_game_prefs (
  venue_id    uuid primary key,
  had_row     boolean not null,
  game_prefs  jsonb,
  taken_at    timestamptz not null default now()
);
alter table public.vp_backup_186_game_prefs enable row level security;
revoke all on public.vp_backup_186_game_prefs from public;
revoke all on public.vp_backup_186_game_prefs from anon, authenticated;

insert into public.vp_backup_186_game_prefs (venue_id, had_row, game_prefs)
select v.id, (s.venue_id is not null), s.game_prefs
  from public.vp_venues v
  left join public.vp_venue_settings s on s.venue_id = v.id
on conflict (venue_id) do nothing;

-- 2. The pattern each existing venue plays now, stored explicitly.
update public.vp_venue_settings s
   set game_prefs = jsonb_set(coalesce(s.game_prefs, '{}'::jsonb), array['musical'],
                              coalesce(s.game_prefs -> 'musical', '{}'::jsonb) || '{"pattern":"one"}'::jsonb, true),
       updated_at = now()
 where coalesce(s.game_prefs -> 'musical' ->> 'pattern', '') = '';

insert into public.vp_venue_settings (venue_id, game_prefs, updated_at)
select v.id, '{"musical":{"pattern":"one"}}'::jsonb, now()
  from public.vp_venues v
 where not exists (select 1 from public.vp_venue_settings s where s.venue_id = v.id)
on conflict (venue_id) do nothing;

-- 3. vp_music_games.pattern accepts 'any_line'.
do $$
declare
  c record;
  t text;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.vp_music_games'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%pattern%'
  loop
    execute format('alter table public.vp_music_games drop constraint %I', c.conname);
  end loop;
  if found then
    alter table public.vp_music_games add constraint vp_music_games_pattern_check
      check (pattern in ('any_line', 'one_line', 'two_lines', 'four_corners', 'full_house'));
  end if;

  select format('%I.%I', n.nspname, ty.typname) into t
    from pg_attribute a
    join pg_type ty on ty.oid = a.atttypid
    join pg_namespace n on n.oid = ty.typnamespace
   where a.attrelid = 'public.vp_music_games'::regclass
     and a.attname = 'pattern'
     and ty.typtype = 'e';
  if t is not null then
    execute format('alter type %s add value if not exists %L', t, 'any_line');
  end if;
end $$;

-- Read back:
--   select count(*) from public.vp_venues v
--     left join public.vp_venue_settings s on s.venue_id = v.id
--    where coalesce(s.game_prefs -> 'musical' ->> 'pattern', '') = '';
-- expects: 0 (every venue has its pattern stored)
--   select count(*) from public.vp_venue_settings s
--     join public.vp_backup_186_game_prefs b using (venue_id)
--    where b.game_prefs -> 'musical' ->> 'pattern' is not null
--      and s.game_prefs -> 'musical' ->> 'pattern' is distinct from b.game_prefs -> 'musical' ->> 'pattern';
-- expects: 0 (no venue's saved pattern moved; a venue that changed it since on the console is the only exception)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.vp_music_games'::regclass and contype = 'c';
-- expects: any pattern rule includes 'any_line' (or there is none)
--   select relrowsecurity from pg_class where oid = 'public.vp_backup_186_game_prefs'::regclass;
-- expects: true

-- Rollback (puts back only what this added: a 'one' it wrote that nobody has changed since).
--   update public.vp_venue_settings s
--      set game_prefs = jsonb_set(s.game_prefs, array['musical'], (s.game_prefs -> 'musical') - 'pattern', true)
--     from public.vp_backup_186_game_prefs b
--    where b.venue_id = s.venue_id
--      and b.had_row
--      and coalesce(b.game_prefs -> 'musical' ->> 'pattern', '') = ''
--      and s.game_prefs -> 'musical' ->> 'pattern' = 'one';
--   delete from public.vp_venue_settings s
--    using public.vp_backup_186_game_prefs b
--    where b.venue_id = s.venue_id and not b.had_row
--      and s.game_prefs = '{"musical":{"pattern":"one"}}'::jsonb;
--   -- vp_music_games: put the old rule back only once no game row says 'any_line':
--   --   alter table public.vp_music_games drop constraint if exists vp_music_games_pattern_check;
--   --   (then the rule read back before running, from pg_get_constraintdef)
--   -- An enum value cannot be removed; it does no harm left in.
--   drop table if exists public.vp_backup_186_game_prefs;   -- only once the rollback is no longer wanted
