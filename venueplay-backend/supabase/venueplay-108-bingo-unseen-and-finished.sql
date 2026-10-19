-- =====================================================================
-- Migration 108: a ball or ticket the room never saw is kept on the record
--                as VOID, and a deal the server was asked for is recorded
-- ---------------------------------------------------------------------
--   Run this BEFORE deploying the VP-DRAW-1.1 game Worker. Safe to run any
--   number of times. No RLS change (the tables stay service-role only).
--
-- WHY (review of VP-DRAW-1.0, 19 Oct 2026). A SLOW server, not a dead one:
-- the console gives up on a ball after four seconds and calls it from the
-- tablet, while the server, a moment later, still records its own ball in
-- the same place. The room saw the tablet's ball, the record held the
-- server's. The same can happen to a deal. From 1.1, when the tablet's ball
-- or ticket arrives for that place, the server's unseen one is kept on the
-- record but marked VOID, with the reason, and the room's one stands.
--
--   vp_bingo_draw_balls.void_reason   why a SERVER ball was voided (the room
--       never saw it). A server ball may now be withdrawn ONLY with a reason;
--       a tablet ball may be withdrawn as before (caller mode's Undo).
--   vp_bingo_tickets.void_reason      why a ticket was voided (a sale taken
--       back, or a server ticket the phone never received in an outage).
--   vp_bingo_draws.deal_asked_at      the server was asked to deal on this
--       draw. With no ball yet on the record, that is the evidence that lets
--       tablet tickets on, when the console never got the answer.
--
-- CHECK AFTERWARDS (read-only):
--   select table_name, column_name from information_schema.columns
--    where (table_name = 'vp_bingo_draw_balls' and column_name = 'void_reason')
--       or (table_name = 'vp_bingo_tickets' and column_name = 'void_reason')
--       or (table_name = 'vp_bingo_draws' and column_name = 'deal_asked_at');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.vp_bingo_draw_balls'::regclass and conname like 'vp_bingo_draw_balls_withdrawn%';
--   expect three rows, then vp_bingo_draw_balls_withdrawn_why:
--   CHECK (withdrawn_at IS NULL OR source = 'local' OR void_reason IS NOT NULL)
--
-- ROLLBACK (deploy the VP-DRAW-1.0 Worker first; only while no server ball is voided):
--   alter table public.vp_bingo_draw_balls drop constraint if exists vp_bingo_draw_balls_withdrawn_why;
--   alter table public.vp_bingo_draw_balls add constraint vp_bingo_draw_balls_withdrawn_local check (withdrawn_at is null or source = 'local');
--   alter table public.vp_bingo_draw_balls drop column if exists void_reason;
--   alter table public.vp_bingo_tickets drop column if exists void_reason;
--   alter table public.vp_bingo_draws drop column if exists deal_asked_at;
-- =====================================================================

begin;

alter table public.vp_bingo_draw_balls add column if not exists void_reason text;
alter table public.vp_bingo_tickets   add column if not exists void_reason text;
alter table public.vp_bingo_draws     add column if not exists deal_asked_at timestamptz;

alter table public.vp_bingo_draw_balls drop constraint if exists vp_bingo_draw_balls_withdrawn_local;
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.vp_bingo_draw_balls'::regclass
                    and conname = 'vp_bingo_draw_balls_withdrawn_why') then
    alter table public.vp_bingo_draw_balls
      add constraint vp_bingo_draw_balls_withdrawn_why
      check (withdrawn_at is null or source = 'local' or void_reason is not null);
  end if;
end;
$do$;

comment on column public.vp_bingo_draw_balls.void_reason is
  'Why a server ball was voided: the room never saw it (the tablet called that place in an outage). The row stays on the record.';
comment on column public.vp_bingo_draws.deal_asked_at is
  'The server was asked to deal on this draw. With no ball on the record, it lets tablet tickets on when the console never got the answer.';

commit;
