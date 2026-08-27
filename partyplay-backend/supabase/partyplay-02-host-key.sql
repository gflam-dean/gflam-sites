-- ============================================================================
-- PartyPlay 02: separate the HOST from the GUESTS.
--
-- Migration 01 had a hole. The join code is printed on the television for every
-- guest to read, and it was also the only thing needed to move the party date
-- and, once the builder existed, to edit the host's games. So any guest could
-- have moved somebody's party or deleted their questions.
--
-- Two secrets, two audiences:
--   code      short, shouted across a room, read by everyone. Lets you PLAY.
--   host_key  long, only ever in the buyer's email. Lets you CHANGE things.
--
-- Idempotent, so it is safe whether or not 01 has already been run.
-- ============================================================================

alter table pp_licences
  add column if not exists host_key text;

-- Backfill anything created before this migration, then make it required.
update pp_licences
   set host_key = encode(gen_random_bytes(18), 'hex')
 where host_key is null;

alter table pp_licences
  alter column host_key set not null;

create unique index if not exists pp_licences_host_key_idx on pp_licences (host_key);

-- A default for anything the Worker forgets to set. Belt and braces: the Worker
-- generates its own, but a NOT NULL with no default would fail the insert rather
-- than quietly working, and a party that cannot be bought is worse than a key
-- generated in two places.
alter table pp_licences
  alter column host_key set default encode(gen_random_bytes(18), 'hex');
