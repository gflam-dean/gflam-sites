-- VenuePlay migration 52: allow a 'comp' status on venueplay_founding.
--
-- A comp/demo venue added from HQ is written with founding status 'comp' so it runs games (the kill
-- switch reads vp_venues.status, not this) WITHOUT eating one of the 100 founding spots -- the counter
-- venueplay_spots_taken() only counts founding rows with status in ('card_on_file','active').
--
-- venueplay_founding predates the vp_ schema and may carry an enum-style CHECK on status that would
-- reject 'comp'. This drops that CHECK if (and only if) it exists, so 'comp' is accepted. Status
-- values are controlled by the app, so dropping the DB-level enum is safe; existing rows are
-- untouched (a DROP validates nothing). If there is no such constraint this is a no-op.
--
-- Safe to run more than once.

do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.venueplay_founding'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table public.venueplay_founding drop constraint %I', c);
  end if;
end $$;
