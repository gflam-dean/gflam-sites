-- ============================================================================
-- PartyPlay 06: the party album.
--
-- Guests take photos, the host takes them home. The FILES live in Cloudflare R2,
-- not here: Postgres is a bad place to keep a 300KB blob and a worse place to
-- keep ten thousand of them. This table is the index.
--
-- NOTE, because it changes what we hold: up to now a guest gave us a nickname
-- and nothing else, which is what the privacy policy says and what the lawyer was
-- told. A photograph of somebody IS personal information. So this table is
-- deliberately built to forget: every row has a delete_after, and the sweep is
-- part of the feature rather than a tidy-up nobody got round to writing.
-- ============================================================================

create table if not exists pp_photos (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references pp_licences(id) on delete cascade,
  -- the object key in R2. Never a URL: the bucket is private and everything is
  -- served through the Worker so we can check who is asking.
  object_key    text not null unique,
  -- the nickname they typed, so the host can see who took what. Not an identity.
  taken_by      text,
  bytes         integer not null default 0,
  content_type  text not null default 'image/jpeg',
  created_at    timestamptz not null default now(),
  -- Thirty days after the party finishes. Set on insert so a row can never be
  -- created without an expiry, which is how "we delete it" stops being a promise
  -- and starts being a column.
  delete_after  timestamptz not null
);
create index if not exists pp_photos_licence_idx on pp_photos (licence_id, created_at desc);
create index if not exists pp_photos_sweep_idx   on pp_photos (delete_after);

alter table pp_photos enable row level security;

-- A party cannot become a photo dump. 300 is far more than any real party
-- produces and still bounds what one licence can cost us.
create or replace function pp_enforce_photo_cap() returns trigger
language plpgsql as $$
declare n integer;
begin
  select count(*) into n from pp_photos where licence_id = new.licence_id;
  if n >= 300 then
    raise exception 'This party album is full at 300 photos' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists pp_photos_cap on pp_photos;
create trigger pp_photos_cap before insert on pp_photos
  for each row execute function pp_enforce_photo_cap();

comment on table pp_photos is
  'Index of party photos. Files live in R2. Every row carries its own delete_after: see partyplay-06-album.sql.';
