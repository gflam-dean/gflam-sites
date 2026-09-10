-- =====================================================================
-- Migration 79: a record of which Stripe events have been handled
-- ---------------------------------------------------------------------
--   Run this BEFORE pasting the billing Worker that goes with it. The
--   Worker treats a missing table as "no ledger" and carries on exactly
--   as it does today, so the order is safe either way; only the
--   protection depends on it.
--
-- WHY. Stripe RETRIES a webhook it does not get a 2xx for, and can
-- deliver the same event more than once even when it did. Nothing in
-- this product has ever recorded which events it has already handled, so
-- every retry ran every branch again.
--
-- Today that is survivable by luck rather than design: no money-moving
-- Stripe call sits on the webhook path, and each branch happens to be
-- individually guarded (a suspension re-applied is the same suspension,
-- a provision is self-healing). What it costs today is duplicate emails
-- to a venue and duplicate audit rows. What it costs tomorrow is
-- whatever the next branch somebody adds happens to do, because that
-- branch inherits NO protection at all. This is the piece that makes the
-- guarantee structural instead of coincidental.
--
-- THE THREE STATES A DELIVERY CAN FIND, and why claiming is not enough:
--   nothing recorded      -> claim it and handle it.
--   claimed AND finished  -> a real duplicate. Answer 200 and do nothing,
--                            because 200 is what stops Stripe retrying.
--   claimed, NOT finished -> either another delivery is running RIGHT NOW
--                            (concurrent, so do nothing and let it finish)
--                            or a previous attempt died halfway. Those look
--                            identical, so age decides: inside the stale
--                            window, leave it alone; past it, take it over.
--                            Refusing forever would strand an event whose
--                            first attempt was killed mid-flight, which is
--                            the one case a ledger must not make worse.
-- =====================================================================

create table if not exists public.vp_stripe_events (
  event_id     text primary key,          -- Stripe's evt_..., the same on every delivery
  event_type   text,
  claimed_at   timestamptz not null default now(),
  completed_at timestamptz,
  attempts     integer not null default 1
);

comment on table public.vp_stripe_events is
  'One row per Stripe webhook event we have handled. completed_at null means a delivery claimed it and has not finished; see migration 79 for why age decides what a second delivery does.';

-- Finding the stale unfinished ones, which is the only query that is not by primary key.
create index if not exists vp_stripe_events_unfinished_idx
  on public.vp_stripe_events (claimed_at)
  where completed_at is null;

/* SERVICE ROLE ONLY. The Worker holds the service key; nothing else has any
   business reading which events we have processed. RLS on with NO policies is
   how that is said: the anon and authenticated keys match no policy and so see
   nothing, while service_role bypasses RLS entirely. */
alter table public.vp_stripe_events enable row level security;

/* Housekeeping. Stripe's own idempotency keys expire after 24 hours, and an
   event older than a couple of months will never be delivered again, so the
   table does not need to grow forever. Deliberately NOT a cron: it is one line
   to run if it ever gets big, and an automatic delete that runs unattended over
   a money-adjacent table is a worse risk than a few thousand rows.
     delete from public.vp_stripe_events where claimed_at < now() - interval '90 days'; */

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'vp_stripe_events') then
    raise notice 'ok: the Stripe event ledger is here. Paste the billing Worker next.';
  else
    raise exception 'the ledger is not there after running this.';
  end if;
end $$;
