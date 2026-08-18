-- VenuePlay migration 37: tie a discount row to the thing Stripe actually created.
--
-- Until now vp_discounts was a note to ourselves. HQ wrote a row, HQ read it back and drew it on
-- the billing tab, and nothing else in the product ever looked at it. A discount agreed with a
-- venue was recorded, displayed as though it were live, and then every invoice went out at the
-- full rate. The screen that would tell you something was wrong is the same screen showing the
-- discount, so it looked right from the only place anyone would check.
--
-- The Worker now applies it for real: a percentage becomes a Stripe coupon on the subscription,
-- and a dollar amount becomes a credit on the customer balance (negative balance = credit, the
-- same mechanism the annual release credit already uses, so a venue sees one consistent figure).
--
-- Both of those have to be undoable, which is what these columns are for. Without them, removing
-- a discount would delete our row and leave the coupon on the subscription forever with nothing
-- left pointing at it: the screen would show no discount while Stripe kept taking it off every
-- invoice. That is a worse failure than the one being fixed, so the link is stored.
--
-- Exactly one of the two is set on any row. Both stay NULL for a group or any other venue
-- invoiced by hand through Xero, where there is no subscription to discount.
--
-- Safe to run more than once.

ALTER TABLE public.vp_discounts
  ADD COLUMN IF NOT EXISTS stripe_coupon_id text,
  ADD COLUMN IF NOT EXISTS stripe_txn_id    text;

COMMENT ON COLUMN public.vp_discounts.stripe_coupon_id IS
  'Stripe coupon created for a percentage discount and attached to the account subscription. Removing the discount clears it off the subscription and deletes the coupon. NULL for dollar discounts and for hand-invoiced targets.';

COMMENT ON COLUMN public.vp_discounts.stripe_txn_id IS
  'Stripe customer balance transaction created for a dollar discount (negative amount = credit). A balance entry cannot be deleted, so removing the discount posts an equal and opposite entry. NULL for percentage discounts and for hand-invoiced targets.';

-- Existing rows predate the discount being applied at all, so they have no Stripe object behind
-- them and correctly stay NULL. Worth knowing when reconciling: any discount created before this
-- migration was never charged, and if it was promised to a venue it still needs to be applied.
