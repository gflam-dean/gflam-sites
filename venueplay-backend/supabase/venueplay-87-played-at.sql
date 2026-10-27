-- 87: WHEN A PLAYER ACTUALLY ENTERED THE GAME, so a phone that only opened the join page is
-- not a billable player.
--
-- Dean, 22 Sep 2026: "a player only bills once they've shown life". A vp_players row is
-- minted the moment a phone loads /play, and for broadcast bingo the server never hears from
-- that phone again, so every joined row was billed and a stranger with the join code could
-- inflate a venue's head count from anywhere. The phone now calls /player/alive the moment
-- it is in the game with a card or a question, and the Worker stamps this column once.
-- Billing and the overage count read it; a session where no row carries it (phones on the
-- old page) is counted the old way, so nothing changes until the phones do.
--
-- Safe to run more than once. The Worker tolerates the column being absent.

alter table public.vp_players add column if not exists played_at timestamptz;

create index if not exists vp_players_session_played_idx
  on public.vp_players (session_id) where played_at is not null;

-- readback
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'vp_players' and column_name = 'played_at';

-- rollback, if ever needed:
--   drop index if exists public.vp_players_session_played_idx;
--   alter table public.vp_players drop column if exists played_at;
