-- ============================================================================
-- PartyPlay 08: photos the HOST brings, as opposed to photos the party makes.
--
-- Guess the Photo was built to pick from the party album, which is clever but
-- wrong: the game people actually want is baby photos, or holiday photos, or
-- the bride at eighteen. Those come from the host's own phone, days earlier.
--
-- One column tells them apart, and it matters in three places:
--   - the album a host downloads should not contain their own game material
--   - a baby photo is not a party photo and should not go in the shared link
--   - game photos must survive until the game is played, so they are not swept
--     on the album's 30 day clock
-- ============================================================================

alter table pp_photos
  add column if not exists purpose text not null default 'album'
    check (purpose in ('album','game'));

-- Everything that exists today came from a guest at a party.
update pp_photos set purpose = 'album' where purpose is null;

create index if not exists pp_photos_purpose_idx on pp_photos (licence_id, purpose, created_at);

-- The album cap counts album photos. A host with forty baby photos should not
-- find the party album full before anybody arrives.
create or replace function pp_enforce_photo_cap() returns trigger
language plpgsql as $$
declare n integer;
begin
  select count(*) into n from pp_photos
   where licence_id = new.licence_id and purpose = new.purpose;
  if new.purpose = 'album' and n >= 300 then
    raise exception 'This party album is full at 300 photos' using errcode = 'check_violation';
  end if;
  if new.purpose = 'game' and n >= 60 then
    raise exception 'Sixty photos is plenty for one game' using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on column pp_photos.purpose is
  'album = taken by a guest at the party. game = brought by the host for Guess the Photo. See partyplay-08-game-photos.sql.';
