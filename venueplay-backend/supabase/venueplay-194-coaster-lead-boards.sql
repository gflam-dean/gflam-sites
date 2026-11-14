-- =====================================================================
-- Migration 194: an added coaster venue is a free lead that can play (INBOX 396, backend)
-- ---------------------------------------------------------------------
-- Dean, 14 November 2026: "an added venue is a free lead. Auto-check it is real (licence
-- list / website); if NOT real, keep it as a trivia-only board for 30 days then delete it; any
-- name with rude words is flagged to Dean (HQ ticket) and not shown. Never cold-emailed."
--
-- NOT FOR SUNDAY'S RELEASE UNLESS DEAN RUNS IT FIRST. NOT RUN. The game Worker that reads these
-- columns degrades safely before it runs (an added venue plays with no board, as today).
--
-- vp_coaster_venues (kind 'lead' rows, the venues players add) gets four columns:
--   lead_status  'unchecked'  how every lead is today (migration 153): no board, HQ's review list only
--                'verified'   found on our licensed list (vp_licensed_venues) or its website names it:
--                             a real venue, a free lead for HQ, with a board that stays
--                'unverified' could not be confirmed: a trivia-only board for 30 days, then the sweep
--                             deletes the row (board_until). Not in anyone's search; the adder's
--                             phone and the challenge links reach it
--                'flagged'    a rude word in the name: no board, never shown or searchable, and an HQ
--                             help-desk ticket for Dean (the ticket is written by the game Worker)
--   board_until  when an unverified board ends (set to 30 days after it was added)
--   checked_at / checked_by  when, and how it was checked ('licence list', 'website', 'none', 'name guard')
-- Nothing here ever creates a vp_venues, vp_prospects or vp_venue_staff row, and no email, SMS,
-- welcome, nudge or monthly path starts from vp_coaster_venues: a lead is never cold-emailed.
--
-- Safe to run twice (add column if not exists). Service role only, as the table already is.
-- RLS-BASELINE.json: no new table and no new policy or grant: nothing to dump.
-- =====================================================================

alter table public.vp_coaster_venues
  add column if not exists lead_status text not null default 'unchecked',
  add column if not exists board_until timestamptz,
  add column if not exists checked_at  timestamptz,
  add column if not exists checked_by  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vp_coaster_venues_lead_status_chk') then
    alter table public.vp_coaster_venues
      add constraint vp_coaster_venues_lead_status_chk
      check (lead_status in ('unchecked', 'verified', 'unverified', 'flagged'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vp_coaster_venues_checked_by_chk') then
    alter table public.vp_coaster_venues
      add constraint vp_coaster_venues_checked_by_chk
      check (checked_by is null or char_length(checked_by) <= 40);
  end if;
end $$;

-- The nightly sweep finds expired unverified boards by this.
create index if not exists vp_coaster_venues_lead_expiry_idx
  on public.vp_coaster_venues (board_until) where kind = 'lead' and lead_status = 'unverified';

comment on column public.vp_coaster_venues.lead_status is
  'Lead rows only: unchecked (no board, as migration 153), verified (real: board stays, a free lead), unverified (trivia-only board for 30 days, then deleted), flagged (rude name: hidden, HQ ticket). Migration 194.';

-- Read back (read-only):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'vp_coaster_venues'
--      and column_name in ('lead_status', 'board_until', 'checked_at', 'checked_by') order by 1;
--   expects four rows.
