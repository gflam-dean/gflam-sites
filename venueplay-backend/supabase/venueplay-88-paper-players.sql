-- 88: PAPER PLAYERS. Printed musical bingo cards and trivia answer sheets for the regulars
-- who will not use a phone. Dean, 25 Sep 2026.
--
-- One column, on the NIGHT, because a printed card has to outlive any one game: the host
-- prints before the room arrives, and "New game" deals phones fresh cards while a card on a
-- table cannot change. Shape (written only by the game Worker, /host/paper/print):
--
--   { "musical": { "playlist_id": uuid, "playlist_name": text,
--                  "cards": [ { "no": 1, "cells": [ ...25, same shape as vp_cards.cells ] } ],
--                  "printed_at": iso },
--     "trivia":  { "teams": 4, "printed_at": iso } }
--
-- A paper card or team is NOT a player until it touches the console (declared at Start game,
-- checked by number, or scored onto the leaderboard). Then the Worker writes an ordinary
-- vp_players row with device_id 'paper-m-<n>' / 'paper-t-<n>', so countPlayers,
-- playerIdsWhoPlayed and the overage charge count it once, exactly like a phone.
--
-- Nothing else changes: no grant, no policy, no view. vp_sessions has RLS on and its only
-- SELECT policies are platform admins and that venue's own staff (RLS-BASELINE.json), so the
-- public key reads none of this. The cards are not secret anyway: a claim's card is broadcast.

alter table public.vp_sessions add column if not exists paper jsonb;

comment on column public.vp_sessions.paper is
  'Printed paper cards/sheets for this night (migration 88). Written by the game Worker only.';
-- Rollback: alter table public.vp_sessions drop column if exists paper;
