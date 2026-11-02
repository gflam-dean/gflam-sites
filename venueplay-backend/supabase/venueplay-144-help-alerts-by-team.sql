-- =====================================================================
-- Migration 144: help desk alerts by team and by brand (Dean, 2 Nov 2026)
-- ---------------------------------------------------------------------
--   NOT RUN. Safe to run any number of times. Run it AFTER 137 (137 sets
--   the same check more narrowly; running 137 again after this one would
--   fail while any device holds a list of ticks).
--
--   Dean: "every different email needs its own notifications for different
--   teams", then "split notifications by brand too". HQ > Help desk > Alerts
--   on this device becomes a tick per kind per brand (venueplay and PartyPlay),
--   urgent ones per brand, and bad player feedback. The choice is kept in the
--   column it always lived in, vp_help_push_subs.filter, as text:
--     'all', 'urgent_sales', 'bad_feedback'   the three named sets, as before
--     'venueplay:sales,partyplay:venue_support,...'   any other choice
--   The column's check (106, widened by 137) allows only the three words, so
--   this widens it to the comma list too. Nothing else changes: no new table,
--   column, policy or grant, so RLS-BASELINE.json does not change.
--
--   Any order with the billing Worker: until this runs, a device whose choice
--   is a list is kept on every ticket and HQ says "choosing teams needs
--   migration 144 run first", so no device is left without alerts.
-- =====================================================================

alter table public.vp_help_push_subs drop constraint if exists vp_help_push_subs_filter_check;
alter table public.vp_help_push_subs add constraint vp_help_push_subs_filter_check check (
  filter in ('all', 'urgent_sales', 'bad_feedback')
  or (length(filter) <= 400
      and filter ~ '^(venueplay|partyplay):[a-z_]{3,20}(,(venueplay|partyplay):[a-z_]{3,20}){0,19}$')
);

-- Read back (read only):
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'vp_help_push_subs_filter_check';
--   should name the comma list pattern above.

-- Rollback (puts every list back to every ticket, then the 137 check):
--   update public.vp_help_push_subs set filter = 'all' where filter not in ('all', 'urgent_sales', 'bad_feedback');
--   alter table public.vp_help_push_subs drop constraint if exists vp_help_push_subs_filter_check;
--   alter table public.vp_help_push_subs add constraint vp_help_push_subs_filter_check check (filter in ('all', 'urgent_sales', 'bad_feedback'));
