-- =====================================================================
-- Migration 105: the server records its own failures, so the tablet's
--                fallbacks are allowed only when the server really failed
-- ---------------------------------------------------------------------
--   Run this BEFORE deploying the venueplay-game.js that goes with it.
--   The new Worker reads and writes these columns; against a database
--   without them its bingo routes answer errors. Safe to run any number
--   of times. No RLS change (the tables stay service-role only).
--
-- WHY. An OLGR-style audit of the 19 Oct 2026 build (a16446c) found that
-- the server took the tablet's word for an outage: any host could switch a
-- healthy server draw to "called on the tablet" and post any numbers, and
-- could record tablet tickets at any time and have claims judged on them.
-- From this migration the server keeps its own evidence:
--
--   vp_bingo_draws.ball_asked_ordinal, ball_asked_at
--       the place the console last asked the SERVER for a ball. If that
--       place still has no ball on the record, the server failed to serve
--       it, and only then will it accept balls the tablet called.
--   vp_bingo_draws.deal_failed_at, deal_fail_why
--       written by the server when a deal it received failed. Only then
--       will it accept tickets the tablet dealt, and only before the first
--       ball is on the record.
--   vp_bingo_tickets.balls_at_deal
--       how many balls were on the record when the ticket was recorded. A
--       claim is never judged on a tablet ticket recorded after a ball.
--   vp_bingo_tickets.tablet_dealt_at
--       when the tablet says it dealt it (the record keeps both times).
--
-- CHECK AFTERWARDS (read-only):
--   select table_name, column_name from information_schema.columns
--    where (table_name = 'vp_bingo_draws' and column_name in ('ball_asked_ordinal','ball_asked_at','deal_failed_at','deal_fail_why'))
--       or (table_name = 'vp_bingo_tickets' and column_name in ('balls_at_deal','tablet_dealt_at'));
--   expect six rows.
--
-- ROLLBACK (deploy the previous Worker first):
--   alter table public.vp_bingo_draws drop column if exists ball_asked_ordinal, drop column if exists ball_asked_at,
--     drop column if exists deal_failed_at, drop column if exists deal_fail_why;
--   alter table public.vp_bingo_tickets drop column if exists balls_at_deal, drop column if exists tablet_dealt_at;
-- =====================================================================

begin;

alter table public.vp_bingo_draws
  add column if not exists ball_asked_ordinal int check (ball_asked_ordinal is null or ball_asked_ordinal between 1 and 90),
  add column if not exists ball_asked_at      timestamptz,
  add column if not exists deal_failed_at     timestamptz,
  add column if not exists deal_fail_why      text;

alter table public.vp_bingo_tickets
  add column if not exists balls_at_deal   int check (balls_at_deal is null or balls_at_deal between 0 and 90),
  add column if not exists tablet_dealt_at timestamptz;

comment on column public.vp_bingo_draws.ball_asked_ordinal is
  'The place the console last asked the server for. A place asked for and never filled is the server''s own proof it failed to serve a ball.';
comment on column public.vp_bingo_draws.deal_failed_at is
  'Set by the server when a deal it received failed. Tablet tickets are accepted only after this, and only before the first ball.';
comment on column public.vp_bingo_tickets.balls_at_deal is
  'Balls on the record when this ticket was recorded. A claim never uses a tablet ticket recorded after a ball.';

commit;
