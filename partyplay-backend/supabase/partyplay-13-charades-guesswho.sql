/* CHARADES AND WHO AM I COULD NEVER BE SAVED ---------------------------------

   Both are offered on the Add a game grid with ready:true, both are named in
   the welcome email as part of "the eleven games", and the Worker's own
   allow-list accepts them. The database check constraint lists ten formats and
   not those two, so a host who wrote ten charades words and pressed Save got a
   PostgREST 400, which the Worker's error handler deliberately turns into a
   generic "Something went wrong" with a reference code. Nothing told them the
   game type was the problem, and it failed the same way every time they tried.

   It was never caught because the Worker's own test mocks the Supabase
   response, so the constraint is never exercised, and the only negative test
   uses a format the Worker rejects before the database sees it.

   WRITTEN TO BE SAFE EITHER WAY. If the live constraint was widened by hand in
   the SQL editor at some point, this replaces it with the same thing and
   changes nothing. If it was not, this is the fix. Re-runnable.
   ------------------------------------------------------------------------- */

do $$
declare
  con_name text;
begin
  -- Whatever the check is currently called, find it rather than assuming.
  select con.conname into con_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
   where rel.relname = 'pp_games'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%format%'
   limit 1;

  if con_name is not null then
    execute format('alter table pp_games drop constraint %I', con_name);
  end if;

  alter table pp_games add constraint pp_games_format_check check (format in (
    'bingo90', 'trivia', 'musical', 'draw', 'howwell', 'headstails',
    'whohere', 'photos', 'truths', 'playlist', 'charades', 'guesswho'
  ));
end $$;

/* Check it took:
     select pg_get_constraintdef(oid) from pg_constraint where conname = 'pp_games_format_check';
   The list should hold twelve formats, ending charades, guesswho. */
