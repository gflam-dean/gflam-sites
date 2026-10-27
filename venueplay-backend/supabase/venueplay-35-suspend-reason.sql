-- VenuePlay migration 35: why a venue is suspended
--
-- Suspension is about to become automatic: when Stripe reports an invoice overdue, the venue's
-- games stop until it is paid. That is fine on its own, but it collides with the Suspend button
-- in HQ, which is used deliberately and for other reasons entirely.
--
-- Without knowing WHY a venue is off, the moment a payment lands we would have to choose between
-- two bad options: reactivate everything, which would quietly switch a venue back on that VenuePlay
-- had turned off on purpose, or reactivate nothing, which means a venue that has paid sits dark
-- until somebody notices.
--
-- So the reason is recorded. Only 'nonpayment' is ever reversed automatically by a payment.
-- Anything switched off by hand stays off until a person turns it back on.
--
-- Nullable, and existing suspended venues stay NULL, which reads as "switched off by a person".
-- That is the safe default: nothing already off gets turned back on by a passing invoice.
--
-- Safe to run more than once.

alter table public.vp_venues
  add column if not exists suspended_reason text;

comment on column public.vp_venues.suspended_reason is
  'Why this venue is suspended. ''nonpayment'' is set automatically when Stripe reports the invoice overdue, and is the ONLY value a successful payment will clear. NULL or ''manual'' means a person switched it off, and only a person switches it back on.';

-- A venue that is not suspended has no reason to hold one.
update public.vp_venues
   set suspended_reason = null
 where status <> 'suspended'
   and suspended_reason is not null;
