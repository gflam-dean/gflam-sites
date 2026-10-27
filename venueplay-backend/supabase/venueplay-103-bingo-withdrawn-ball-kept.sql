-- =====================================================================
-- Migration 103: a ball taken back on a real-balls night stays on the
--                record, marked withdrawn
-- ---------------------------------------------------------------------
--   Safe to run any number of times. Either order with the game Worker
--   is safe:
--     Worker first: the Undo tries to mark the row, PostgREST says the
--       column is not there, and the Worker takes the ball off the record
--       exactly as it did before (the old behaviour, only while this has
--       not been run).
--     This first: the old Worker still deletes the row on an Undo, which
--       this table allows, and nothing else it does changes.
--   Run it BEFORE the Worker if you can, so the first Undo after the
--   deploy is already kept.
--
-- WHY. Caller mode (17 Oct 2026): the operator taps the number a real ball
-- showed, and Undo takes back a mis-tap. Until now the Undo DELETED the
-- ball's row, so the night's draw record had no trace that a number was
-- ever called and withdrawn. A record a regulator reads must show the
-- mistake as well as the correction (certification review, 17 Oct 2026).
--
-- WHAT CHANGES on public.vp_bingo_draw_balls, and nothing else:
--   withdrawn_at  timestamptz, NULL = the ball stands (every row today)
--   The two keys that said "a ball is called once" and "one ball per
--   place" now hold for the balls that STAND (withdrawn_at is null). They
--   have to: after an Undo the console calls the next ball into the same
--   place, and a withdrawn number may be called again later, while the
--   withdrawn row stays put beside them. Two partial unique indexes keep
--   both rules for every standing ball, exactly as strict as before.
--   A server-drawn ball can never be marked withdrawn (check below), and
--   the Worker only ever marks the LAST standing ball of a caller-mode draw.
--   replica identity full: the primary key was the table's replica
--   identity; without one, an UPDATE would be refused if the table were
--   ever added to a publication. Harmless if it never is.
-- No RLS change: the table stays service-role only (migration 70), so
-- RLS-BASELINE.json does not move.
--
-- CHECK AFTERWARDS (read-only):
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'vp_bingo_draw_balls' and column_name = 'withdrawn_at';
--   select indexname, indexdef from pg_indexes
--    where tablename = 'vp_bingo_draw_balls' order by indexname;
--   select conname, contype from pg_constraint
--    where conrelid = 'public.vp_bingo_draw_balls'::regclass;
--   expect: withdrawn_at YES; vp_bingo_draw_balls_live_number and
--   vp_bingo_draw_balls_live_ordinal (unique, where withdrawn_at is null)
--   and vp_bingo_draw_balls_draw_ordinal; no 'p' or 'u' constraint, and
--   the check vp_bingo_draw_balls_withdrawn_local.
--
-- ROLLBACK (only while no row is withdrawn, or after deleting those rows):
--   begin;
--   drop index if exists public.vp_bingo_draw_balls_live_number;
--   drop index if exists public.vp_bingo_draw_balls_live_ordinal;
--   drop index if exists public.vp_bingo_draw_balls_draw_ordinal;
--   alter table public.vp_bingo_draw_balls drop constraint if exists vp_bingo_draw_balls_withdrawn_local;
--   alter table public.vp_bingo_draw_balls add primary key (draw_id, ordinal);
--   alter table public.vp_bingo_draw_balls add unique (draw_id, number);
--   alter table public.vp_bingo_draw_balls replica identity default;
--   alter table public.vp_bingo_draw_balls drop column withdrawn_at;
--   commit;
-- =====================================================================

begin;

alter table public.vp_bingo_draw_balls add column if not exists withdrawn_at timestamptz;

comment on column public.vp_bingo_draw_balls.withdrawn_at is
  'Set when a caller-mode Undo took this ball back. The row stays on the record; NULL means the ball stands.';

-- The keys for STANDING balls first, so there is never a moment without them.
create unique index if not exists vp_bingo_draw_balls_live_number
  on public.vp_bingo_draw_balls (draw_id, number) where withdrawn_at is null;
create unique index if not exists vp_bingo_draw_balls_live_ordinal
  on public.vp_bingo_draw_balls (draw_id, ordinal) where withdrawn_at is null;
-- The reads that order by ordinal (the last ball, the double-request hold).
create index if not exists vp_bingo_draw_balls_draw_ordinal
  on public.vp_bingo_draw_balls (draw_id, ordinal);

alter table public.vp_bingo_draw_balls replica identity full;

-- Then the old whole-table keys, found by kind rather than by name (the
-- Sydney copy was restored from a dump, so a name is not a promise).
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.vp_bingo_draw_balls'::regclass
       and contype in ('p', 'u')
  loop
    execute format('alter table public.vp_bingo_draw_balls drop constraint %I', c.conname);
  end loop;
end;
$$;

-- Only a tablet ball (caller mode) can ever be withdrawn.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.vp_bingo_draw_balls'::regclass
                    and conname = 'vp_bingo_draw_balls_withdrawn_local') then
    alter table public.vp_bingo_draw_balls
      add constraint vp_bingo_draw_balls_withdrawn_local
      check (withdrawn_at is null or source = 'local');
  end if;
end;
$$;

comment on table public.vp_bingo_draw_balls is
  'Every ball called, when, and whether the server or the tablet picked it. A caller-mode Undo marks the row withdrawn (withdrawn_at) and keeps it.';

commit;
