-- ============================================================================
-- PartyPlay 07: sharing the album, without handing out the keys to the party.
--
-- Two separate secrets already exist: the CODE lets you play, the HOST KEY lets
-- you change things. Sharing needs a third, because neither works:
--   - the host key would let any guest delete the host's games
--   - the code is not a secret at all, it was on the television all night
--
-- So: a share key. It shows the album and does nothing else.
-- ============================================================================

alter table pp_licences
  add column if not exists share_key text;

update pp_licences
   set share_key = encode(gen_random_bytes(12), 'hex')
 where share_key is null;

alter table pp_licences alter column share_key set not null;
alter table pp_licences alter column share_key set default encode(gen_random_bytes(12), 'hex');
create unique index if not exists pp_licences_share_key_idx on pp_licences (share_key);

-- ---------------------------------------------------------------------------
-- A guest asking to be sent the album link tomorrow.
--
-- Deliberately NOT pp_subscribers. This is a one-off request about one party,
-- given at that party, and it is not permission to market at them forever. Two
-- different things with two different consents, kept in two different tables so
-- nobody can quietly treat one as the other.
-- ---------------------------------------------------------------------------
create table if not exists pp_album_requests (
  id            uuid primary key default gen_random_uuid(),
  licence_id    uuid not null references pp_licences(id) on delete cascade,
  email         text not null,
  nickname      text,
  asked_at      timestamptz not null default now(),
  sent_at       timestamptz,
  -- If they also ticked the separate box, that is recorded here AND in
  -- pp_subscribers. Without the tick this is single use and then it is over.
  marketing_ok  boolean not null default false,
  unique (licence_id, email)
);
create index if not exists pp_album_req_pending_idx on pp_album_requests (licence_id)
  where sent_at is null;

alter table pp_album_requests enable row level security;

comment on table pp_album_requests is
  'A guest asked to be sent this party''s album link. One party, one email, not a mailing list. See partyplay-07-album-sharing.sql.';
