-- =====================================================================
-- Migration 68: every venue owns its join code, instead of it being a
--               hash of the slug and a fresh random one per session
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--
-- WHY. There were two codes and they were both wrong in different ways.
--
--   * The SCREEN code was fnvVenueCode(slug): a hash. Two unrelated slugs can
--     land on the same six characters, and the Worker's only defence is to mark
--     the code AMBIGUOUS and refuse BOTH venues until somebody re-slugs one. At
--     3,000 venues the chance of a clash somewhere is about 0.75%; at 6,000 it is
--     3%; at 10,000 it is 8%. That is a coin the business should not be flipping.
--     It is also tied to the slug, so correcting a venue's slug silently changes
--     the code printed on their table talkers.
--
--   * The PLAYER join code was genCode(6) at session creation: random, and NEW
--     EVERY SESSION. So the code on the wall changed from the screen code to the
--     session code the moment a host opened a lobby, which is fault 8 on the
--     live-test list ("ONE code on the wall, and it is the one the console
--     shows"), and nothing printable could ever be right for long.
--
-- So a venue now OWNS one code. Assigned once, unique by constraint rather than
-- by luck, independent of the slug, printable, and the same code the screen
-- shows, the console shows and a player types.
--
-- THE BACKFILL KEEPS EXISTING CODES. A venue trading today already has a code in
-- the room, possibly on a table talker: The Average Joe is 4XYWJM. So every
-- existing venue is given the code it ALREADY had, computed here by the same FNV
-- hash the Worker uses, rather than a fresh random one. Nothing changes for
-- anybody already running. Only new venues get a random code.
--
-- Safe to run more than once.
-- =====================================================================

-- The Worker's fnvVenueCode(slug), exactly. 32-bit FNV-1a over the slug with
-- every non-alphanumeric stripped, then six characters drawn from the
-- ambiguity-free alphabet with an LCG. Kept here ONLY to reproduce the codes
-- venues already have; new codes are random, not hashed.
create or replace function vp_legacy_venue_code(p_slug text)
returns text
language plpgsql
immutable
as $$
declare
  s      text := lower(regexp_replace(coalesce(p_slug, ''), '[^a-zA-Z0-9]', '', 'g'));
  h      bigint := 2166136261;
  x      bigint;
  alpha  text := 'ACDEFGHJKMNPQRSTUVWXYZ2345679';
  out    text := '';
  i      int;
begin
  for i in 1 .. length(s) loop
    h := (h # ascii(substr(s, i, 1)))::bigint;          -- xor
    h := (h * 16777619) % 4294967296;                   -- imul, wrapped to uint32
  end loop;
  x := case when h = 0 then 1 else h end;
  for i in 1 .. 6 loop
    x := (x * 1103515245 + 12345) % 4294967296;
    out := out || substr(alpha, (x % 29)::int + 1, 1);
  end loop;
  return out;
end;
$$;

alter table public.vp_venues
  add column if not exists join_code text,
  add column if not exists join_code_set_at timestamptz;

comment on column public.vp_venues.join_code is
  'The venue''s one code: shown on the screen, shown on the host console, and typed by players to join. Assigned once and stable, so it can be printed. Unique across venues by constraint. Owners and managers can refresh it (a host cannot), which is the path for a leaked or clashing code.';
comment on column public.vp_venues.join_code_set_at is
  'When the code was last assigned or refreshed. An owner refreshing a code invalidates whatever is printed in the room, so it is worth being able to see when that happened.';

-- Existing venues keep the code they already have in the room.
update public.vp_venues
   set join_code = vp_legacy_venue_code(slug),
       join_code_set_at = now()
 where join_code is null
   and slug is not null;

-- If the legacy hash collided for two venues, the unique index below would fail
-- and take the whole migration with it. Break the tie rather than block: the
-- OLDER venue keeps the code it has been using, the newer one is re-coded.
with dupes as (
  select id,
         row_number() over (partition by join_code order by created_at asc, id asc) as rn
    from public.vp_venues
   where join_code is not null
)
update public.vp_venues v
   set join_code = null
  from dupes d
 where v.id = d.id and d.rn > 1;

create unique index if not exists vp_venues_join_code_uniq
  on public.vp_venues (join_code)
  where join_code is not null;
