-- =====================================================================
-- Migration 172: the try-it demo's session flag (vp_sessions.is_demo)
-- ---------------------------------------------------------------------
-- Dean, 5 Nov 2026 (INBOX 82, 84b, 92c, 93): after the no-card start a new
-- venue plays a 5-question trivia round on THEIR OWN venue, through the
-- ONE trivia engine (the same /session, /join, /host/game, /host/question
-- and /host/reveal), with their own phone as the player.
--
-- 84b: the demo is NEVER billed. Whatever they type for "How many players
-- will join?" (even 50): no extras, no player-count uplift, no streak
-- change, no free-month clock change. Up to 10 joiners.
--
-- Before this there was no way to tell a demo from a real night: a demo
-- through the real engine would have been billed (chargeNightOverage),
-- reset or advanced overage_streak, stamped the once-a-week trivia rule,
-- burned 5 questions in vp_asked_questions for 12 months, written the
-- venue's trivia preferences, and shown up in stats, metering, quiet
-- venues, auto-archive and the nights list.
--
-- is_demo is written ONCE, by the game Worker, when POST /session is asked
-- for a demo (body demo:true) by staff of that venue. Nothing ever turns a
-- real night into a demo or a demo into a real night: a real /session at a
-- venue whose live session is a demo closes the demo first and opens a new
-- real one; a demo /session at a venue with a real night live is refused.
-- Every path above reads the flag (game Worker and billing Worker; tests in
-- tools/test-try-demo.js).
--
-- What a demo DOES keep, on purpose: its vp_players rows. A player who
-- ticked "Send me offers from {venue}. I'm 18 or over." in the demo is on
-- THAT venue's opt-in list (v_vp_player_optins joins vp_sessions by
-- venue_id, no filter on is_demo), exactly as a real player would be, and
-- the 90-day player-data deletion and "find a person" still see them.
--
-- DEPLOY ORDER: run this BEFORE deploying either Worker from this branch.
-- The Workers' reads filter is_demo=is.false, which PostgREST refuses
-- while the column does not exist. Additive and safe to run early: every
-- existing row reads false.
--
-- NUMBER: 166/167 prospect details, 168 reserved, 169 library questions,
-- 170/171 the no-card start (fix/signup-core-10nov), so 172.
-- Branch fix/try-demo-10nov. NOT RUN.
-- =====================================================================

alter table public.vp_sessions
  add column if not exists is_demo boolean not null default false;

comment on column public.vp_sessions.is_demo is
  'The try-it demo (INBOX 82/84b): set once by the game Worker at POST /session {demo:true}. Never billed, never metered, no weekly stamp, no asked-question memory, up to 10 joiners, one 5-question trivia round. Its players stay on the venue''s own opt-in list.';

-- The Worker counts a venue's demos today (at most 3 a day) and the reads
-- that leave demos out filter on it; a small partial index keeps the count
-- to one index probe.
create index if not exists vp_sessions_demo_by_venue
  on public.vp_sessions (venue_id, created_at)
  where is_demo;
