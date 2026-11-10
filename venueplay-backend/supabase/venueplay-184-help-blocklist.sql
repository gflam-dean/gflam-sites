-- =====================================================================
-- Migration 184: help desk block list (NOT RUN)
-- ---------------------------------------------------------------------
-- Dean, 10 November 2026: ticket #1027 "American Express | Non-Compliance
-- Issues" from donotreply_us@secure.net was phishing; he had closed three
-- like it. HQ > Help desk > a ticket > "Block sender" puts the address (or
-- the whole domain) here and closes the ticket. Mail from a blocked sender
-- is filed as spam: no ticket, no acknowledgement, no reply, no alert.
--
-- SAFE IN EITHER ORDER with the Worker. Without this table the Worker still
-- blocks secure.net (it is also written into the Worker as HELP_BLOCK_SEED)
-- and the Block sender button says the list is not set up yet and changes
-- nothing. Safe to run any number of times.
--
-- After running: python3 venueplay-backend/tools/dump-rls-baseline.py and
-- commit RLS-BASELINE.json (one new table, RLS on, no grants to anon or
-- authenticated).
--
-- LOCKED. Only the service role (the billing Worker) reaches a row.
-- =====================================================================

create table if not exists public.vp_help_blocklist (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('email', 'domain')),
  value          text not null check (char_length(value) between 3 and 255 and value = lower(value)),
  reason         text,
  blocked_by     text,
  from_ticket_no bigint,
  created_at     timestamptz not null default now(),
  unique (kind, value)
);

insert into public.vp_help_blocklist (kind, value, reason, blocked_by, from_ticket_no)
values ('domain', 'secure.net', 'Fake American Express phishing (ticket 1027)', 'Dean', 1027),
       ('email', 'donotreply_us@secure.net', 'Fake American Express phishing (ticket 1027)', 'Dean', 1027)
on conflict (kind, value) do nothing;

alter table public.vp_help_blocklist enable row level security;
revoke all on public.vp_help_blocklist from public, anon, authenticated;
grant select, insert, update, delete on public.vp_help_blocklist to service_role;

-- Check:  select kind, value from public.vp_help_blocklist;   -- 2 rows
-- Undo:   drop table if exists public.vp_help_blocklist;
