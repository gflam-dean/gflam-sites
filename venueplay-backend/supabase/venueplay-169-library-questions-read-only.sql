-- =====================================================================
-- Migration 169: a venue cannot edit library questions, or make its own set a library set
-- ---------------------------------------------------------------------
-- Dean, 5 November 2026 (item 45c, answered in 75d). Library questions stay as
-- we wrote them until someone reports one bad. A venue's "Add from the library"
-- COPIES a library question into its own night, and until now the venue's
-- row-level rule (vp_questions_host_write: ALL on every row of its own sets)
-- let a signed-in venue change that copy, or delete it, straight through the
-- database API, past the game Worker's refusal. And the same kind of rule on
-- vp_question_sets (vp_question_sets_host_write) let a venue set
-- visibility = 'library' on ITS OWN set, which would have put its questions in
-- front of every other venue through "From the library" and search.
--
-- This closes both, in the database:
--   1. vp_questions.from_library (boolean, default false): true on a venue's
--      copy of a library question. Set by the game Worker whenever it copies
--      one in (from-library, search, an Undo). Backfilled here for every copy
--      that already exists (a venue-owned set's question whose exact words are
--      in a library set: the same rule the Worker has always used).
--   2. vp_questions_host_write is replaced: a venue may still write (insert,
--      update, delete) the questions IT created, but never a row with
--      from_library = true. Library copies change only through the Worker
--      (swap, remove), which uses the service key. Reads are unchanged.
--   3. vp_question_sets_host_write is replaced: a venue's own set is always
--      visibility 'private' (the check values are 'private' and 'library'); a
--      venue can never write a set into the library. Library sets have no
--      owner and are written only by us.
--
-- A question a venue writes stays at that venue: nothing here or in the Worker
-- serves it to another venue. It goes to vp_question_submissions for the Monday
-- review and reaches the library only when we approve it.
--
-- Either order with the Worker: the Worker writes from_library on copies only
-- when the column exists (it retries without it), and judges a copy by its
-- words either way. Before this runs the old database rules are the only gap.
--
-- RLS-BASELINE.json: two policies change TEXT (not names or grants). Re-dump it
-- after this runs (python3 venueplay-backend/tools/dump-rls-baseline.py) and
-- commit the diff.
--
-- NUMBER: 160 to 164 are taken on other branches, 169 is Dean's. Branch
-- fix/trivia-library-swap-10nov. NOT RUN.
-- =====================================================================

alter table vp_questions add column if not exists from_library boolean not null default false;
comment on column vp_questions.from_library is
  'True on a venue''s copy of a library question: the venue cannot edit or delete it through the database (vp_questions_host_write); swap and remove go through the game Worker.';

-- Backfill: every copy that exists today.
update vp_questions q
   set from_library = true
 where q.from_library = false
   and q.set_id in (select id from vp_question_sets where owner_venue_id is not null)
   and exists (
     select 1
       from vp_questions l
       join vp_question_sets ls on ls.id = l.set_id
      where ls.visibility = 'library' and ls.owner_venue_id is null
        and l.question = q.question);

drop policy if exists vp_questions_host_write on vp_questions;
create policy vp_questions_host_write on vp_questions
  for all to authenticated
  using (
    from_library = false
    and set_id in (select s.id from vp_question_sets s
                    where s.owner_venue_id in (select vp_staff_venue_ids()))
  )
  with check (
    from_library = false
    and set_id in (select s.id from vp_question_sets s
                    where s.owner_venue_id in (select vp_staff_venue_ids()))
  );

drop policy if exists vp_question_sets_host_write on vp_question_sets;
create policy vp_question_sets_host_write on vp_question_sets
  for all to authenticated
  using (owner_venue_id in (select vp_staff_venue_ids()))
  with check (owner_venue_id in (select vp_staff_venue_ids()) and visibility = 'private');

-- Read back (read-only):
--   select count(*) from vp_questions where from_library;                      -- the copies found
--   select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--     from pg_policy where polname in ('vp_questions_host_write','vp_question_sets_host_write');
--   -- as a venue login (not the service key): update vp_questions set question='x' where from_library;  -> 0 rows
--   --                                         update vp_question_sets set visibility='library' where owner_venue_id is not null;  -> RLS error
-- Rollback: drop both new policies and recreate them as in RLS-BASELINE.json (host_write: ALL, the set's owner in vp_staff_venue_ids()); the column can stay.
