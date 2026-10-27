/* PARTYPLAY 15: Great Minds (format 'topanswers').

   The Punters Reckon engine from VenuePlay, played at parties with family boards. The game needs
   nothing stored: the boards ship with the page and the host's tablet referees. The only thing
   the database has to know is that the format exists, because pp_games.format is checked.

   Safe to run twice. Written 30 Sep 2026. */
do $$
declare con_name text;
begin
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
    'whohere', 'photos', 'truths', 'playlist', 'charades', 'guesswho', 'topanswers'
  ));
end $$;

/* Check it took:
     select pg_get_constraintdef(oid) from pg_constraint where conname = 'pp_games_format_check';
   The list should hold thirteen formats, ending charades, guesswho, topanswers. */
