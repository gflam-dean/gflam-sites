-- 89: WHICH GAME THE HOST LAST OPENED A LOBBY FOR. Audit 25 Sep 2026, found by playing.
--
-- One night (one vp_sessions row) can run trivia, then bingo, then musical bingo. /join/info
-- worked out what a code is for from the LATEST GAME of the session, and a lobby writes no game
-- until it starts, so in the bingo lobby after a trivia round every phone that typed the code was
-- sent to a dead trivia page ("your questions will pop up here"), and after bingo a musical lobby
-- showed the bingo page. The console already says what it is opening (/session {format}); this
-- keeps it. Written by the game Worker on /session (create and reuse) and on /host/game.
--
-- Nothing else changes: no grant, no policy. vp_sessions is RLS-locked to admins and the venue's
-- own staff (RLS-BASELINE.json). The Worker tolerates the column being absent.

alter table public.vp_sessions add column if not exists lobby_format text;

comment on column public.vp_sessions.lobby_format is
  'The format the host last opened a lobby for or started (migration 89). Game Worker only.';
-- Rollback: alter table public.vp_sessions drop column if exists lobby_format;
