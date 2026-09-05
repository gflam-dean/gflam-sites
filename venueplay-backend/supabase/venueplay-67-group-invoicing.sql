-- =====================================================================
-- Migration 67: bill a big group by invoice, not by card
-- ---------------------------------------------------------------------
--   ****  RUN THIS *BEFORE* PASTING venueplay-game.js.  ****
--
-- WHY. Everything today is charged to a card automatically. That is right for a
-- single pub paying a few hundred dollars a month, and wrong for a group: a
-- fifteen-venue account can run past what a business card will take in one hit,
-- the charge declines, and nothing is wrong except the payment method. Groups also
-- generally will not pay by card at all - they want an invoice, a PO number on it,
-- and terms.
--
-- So an ACCOUNT (venueplay_founding, which is what carries the Stripe customer and
-- subscription) can be marked as billed by invoice. When it is:
--
--   * the subscription's collection_method becomes send_invoice with terms, so
--     Stripe issues an invoice instead of taking the card, and
--   * anything we raise ourselves - a big-night overage, a plan uplift pro rata -
--     goes onto an invoice with the same terms rather than being collected now.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not chase payment. An unpaid invoice
-- is a conversation, not an automation, and the existing suspension path already
-- handles a subscription Stripe has given up on. Turning this on is a decision
-- about how a customer pays, not a change to what they owe.
--
-- invoice_email is separate from the owner's login on purpose: accounts payable is
-- almost never the person who runs the trivia night.
--
-- Safe to run more than once.

ALTER TABLE public.venueplay_founding
  ADD COLUMN IF NOT EXISTS bill_by_invoice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_terms_days integer,
  ADD COLUMN IF NOT EXISTS invoice_email text,
  ADD COLUMN IF NOT EXISTS invoice_reference text,
  ADD COLUMN IF NOT EXISTS invoice_set_at timestamptz;

COMMENT ON COLUMN public.venueplay_founding.bill_by_invoice IS
  'True when this account is billed by Stripe invoice with terms instead of an automatic card charge. Set from HQ, which also switches the live subscription''s collection_method. Groups want an invoice with a PO number, and a fifteen-venue total can exceed what a business card will take in one charge.';
COMMENT ON COLUMN public.venueplay_founding.invoice_terms_days IS
  'Payment terms in days for this account''s invoices (Stripe days_until_due). Null means the default of 14 is used.';
COMMENT ON COLUMN public.venueplay_founding.invoice_email IS
  'Where invoices go. Deliberately separate from the owner''s login: accounts payable is almost never the person running the trivia night. Null means Stripe uses the customer''s own email.';
COMMENT ON COLUMN public.venueplay_founding.invoice_reference IS
  'A purchase order or supplier reference the group needs printed on every invoice. Goes on the invoice as a custom field; many groups will not pay one without it.';
