-- =====================================================================
-- Migration 199: the yearly credit ledger (one row per cut, held for the payer's next yearly bill)
-- ---------------------------------------------------------------------
-- Dean, 16 November 2026 (INBOX 419 DECISION + add-on; Terms line 122 stays): a YEARLY venue or group that cuts players mid-year,
-- or a pub a yearly group sells or removes, keeps the value of the released players as CREDIT on the NEXT YEAR's bill, never a
-- refund. THE CREDIT BELONGS TO THE PAYER:
--   - payer_type 'founding': a card account (venueplay_founding.id). Stripe's customer balance is what the renewal really takes off;
--     this row records which pub and which cut each dollar came from. A cut at any of the account's pubs lands on the account.
--   - payer_type 'group': a vp_venue_groups group (invoiced by hand). The row IS the credit; HQ takes it off the group's next yearly
--     invoice. A cut at, or the sale or removal of, one of its pubs lands on the GROUP, never on the pub and never on a new owner.
-- value (cents) = players released x yearly rate (cents) x 12 x the fraction of the paid year still to run (months_left / 12).
-- status: held (waiting for the renewal), applied (the renewal invoice took it), void (HQ reversed it, with a note).
--
-- Also two columns on vp_venue_groups so a hand-invoiced group can say it is yearly: billing_term ('monthly' default, or 'yearly')
-- and term_renewal (the date the paid year ends). Existing groups stay 'monthly', so nothing changes for them.
--
-- Additive only: one new table, three indexes, two columns. Safe to run twice. Service role only (RLS on, no policies, no grants):
-- the billing Worker writes it and the billing page and HQ read it through the Worker. Until it has run, the Worker logs and
-- carries on (the cut and the Stripe balance are unaffected; only the record is missing), and the HQ group route answers 409 for
-- a yearly group only if the two group columns are missing.
-- RLS-BASELINE.json: one new table with RLS on and no grants; dump the baseline after it runs on live.
-- =====================================================================

create table if not exists public.vp_billing_credits (
  id               uuid primary key default gen_random_uuid(),
  payer_type       text not null check (payer_type in ('founding', 'group')),
  payer_id         text not null,                                            -- venueplay_founding.id or vp_venue_groups.id
  venue_id         uuid,                                                     -- the pub it came from (information only, never the owner of the credit)
  venue_name       text,
  reason           text not null default 'yearly_cut' check (reason in ('yearly_cut', 'yearly_removed')),
  players_released integer not null check (players_released > 0),
  rate_cents       integer,                                                  -- per player per month, as it was when the credit was sized
  months_left      numeric(5,1),
  cents            integer not null check (cents > 0),
  status           text not null default 'held' check (status in ('held', 'applied', 'void')),
  idem_key         text,                                                     -- the Stripe idempotency tag (founding) or the group key; one row per move
  term_end         timestamptz,                                              -- the end of the year the released players were paid to
  applied_at       timestamptz,
  applied_invoice  text,
  note             text,
  created_at       timestamptz not null default now()
);

create unique index if not exists vp_billing_credits_idem_uq on public.vp_billing_credits (idem_key) where idem_key is not null;
create index if not exists vp_billing_credits_payer_idx on public.vp_billing_credits (payer_type, payer_id, status);
create index if not exists vp_billing_credits_venue_idx on public.vp_billing_credits (venue_id) where venue_id is not null;

alter table public.vp_billing_credits enable row level security;
revoke all on public.vp_billing_credits from public, anon, authenticated;

alter table public.vp_venue_groups add column if not exists billing_term text not null default 'monthly';
alter table public.vp_venue_groups add column if not exists term_renewal date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vp_venue_groups_billing_term_chk') then
    alter table public.vp_venue_groups add constraint vp_venue_groups_billing_term_chk check (billing_term in ('monthly', 'yearly'));
  end if;
end $$;

comment on table public.vp_billing_credits is
  'Yearly credit ledger. A yearly cut (or a pub a yearly group sells or removes) holds the released players value for the PAYER (a card account or a vp_venue_groups group) for the next yearly bill. Never a refund, never follows a pub to a new owner. Service role only. Migration 199.';

-- Read back (read-only):
--   select relrowsecurity from pg_class where oid = 'public.vp_billing_credits'::regclass;   expects true
--   select count(*) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'vp_billing_credits' and grantee in ('anon', 'authenticated');   expects 0
--   select billing_term, count(*) from public.vp_venue_groups group by 1;   expects every existing group on 'monthly'

-- Rollback (nothing else reads it): drop table public.vp_billing_credits;
--   alter table public.vp_venue_groups drop constraint if exists vp_venue_groups_billing_term_chk,
--     drop column if exists billing_term, drop column if exists term_renewal;
