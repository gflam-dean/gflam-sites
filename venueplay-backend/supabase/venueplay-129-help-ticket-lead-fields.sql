-- =====================================================================
-- Migration 129: a sales enquiry's venue as fields, and how a public ticket found its venue
-- ---------------------------------------------------------------------
-- Dean's phone test, 29 Oct 2026. The website's "Bring VenuePlay to your venue" form (a help desk
-- ticket, kind sales) asked for a name, an email and a message and nothing else, so a later job
-- could not set the venue up as a prospect without reading the message. It now asks for the venue
-- name and its suburb or postcode (required) and its website (optional), and the billing Worker
-- keeps them in their own columns:
--
--   lead_venue_name    the venue the enquiry is for, as typed        (sales tickets)
--   lead_locality      its suburb or postcode, as typed              (sales tickets)
--   lead_website       its website, as typed, optional               (sales tickets)
--   venue_matched_by   how a PUBLIC ticket's venue_id was found, when it was: 'room' (the
--                      patron's phone had the room code or the venue's link), 'code' (a join
--                      code typed into the form) or 'name' (the typed name, with the suburb or
--                      postcode when one was given, matched one venue and only one). Null when
--                      no venue was matched, and on every ticket HQ or a signed-in venue raised.
--
-- Nothing reads them back to the public: the help desk's read routes are HQ only (helpAdmin).
--
-- Run BEFORE deploying the billing Worker from branch fix/site-mobile-sales-29oct. If the Worker
-- goes first it still works: a ticket insert that the database refuses for an unknown column is
-- retried without these four fields (the venue name, suburb and website are also written into the
-- message), so no enquiry is lost. Safe to run twice. No new table, policy or grant, so
-- RLS-BASELINE.json does not change. Rollback at the bottom.
-- =====================================================================

begin;

alter table public.vp_help_tickets
  add column if not exists lead_venue_name  text,
  add column if not exists lead_locality    text,
  add column if not exists lead_website     text,
  add column if not exists venue_matched_by text;

alter table public.vp_help_tickets drop constraint if exists vp_help_tickets_lead_venue_name_len;
alter table public.vp_help_tickets add constraint vp_help_tickets_lead_venue_name_len
  check (lead_venue_name is null or char_length(lead_venue_name) <= 120);
alter table public.vp_help_tickets drop constraint if exists vp_help_tickets_lead_locality_len;
alter table public.vp_help_tickets add constraint vp_help_tickets_lead_locality_len
  check (lead_locality is null or char_length(lead_locality) <= 80);
alter table public.vp_help_tickets drop constraint if exists vp_help_tickets_lead_website_len;
alter table public.vp_help_tickets add constraint vp_help_tickets_lead_website_len
  check (lead_website is null or char_length(lead_website) <= 200);
alter table public.vp_help_tickets drop constraint if exists vp_help_tickets_venue_matched_by_chk;
alter table public.vp_help_tickets add constraint vp_help_tickets_venue_matched_by_chk
  check (venue_matched_by is null or venue_matched_by in ('room', 'code', 'name'));

-- The job that turns sales enquiries into prospects reads the newest first.
create index if not exists vp_help_tickets_sales_leads_idx
  on public.vp_help_tickets (created_at desc) where category = 'sales' and lead_venue_name is not null;

commit;

-- ---------------------------------------------------------------------
-- Rollback (the Worker keeps working without these columns: see above):
--   begin;
--   drop index if exists public.vp_help_tickets_sales_leads_idx;
--   alter table public.vp_help_tickets
--     drop column if exists lead_venue_name, drop column if exists lead_locality,
--     drop column if exists lead_website, drop column if exists venue_matched_by;
--   commit;
-- ---------------------------------------------------------------------
