-- =====================================================================
-- Migration 100: what the venue says it is, the tick that puts gaming
--                compliance on the venue, and the permits it holds
-- ---------------------------------------------------------------------
--   Safe to run any number of times. Run it BEFORE the billing Worker
--   and the site that go with it: vp-session.js names the three new
--   columns in its venue select, and PostgREST rejects a whole select
--   when one name is unknown (the 19 Aug 2026 entity_type lesson).
--
-- WHY. Anisimoff Legal, ref 9380, two letters:
--   * 1 Oct 2026 (NSW + general), point 3: the venue, not VenuePlay, is
--     responsible for compliance, and "it would also be prudent to ensure
--     Customers actively tick a check box or sign an agreement confirming
--     that they will be responsible for compliance". Point 5: keeping
--     records of any licences/permits/authorities the venue holds, so a
--     manual check is possible, is prudent (not mandatory). Point 7: a
--     NSW pub running a paid raffle for a charity does so under the
--     charity's authority, with the charity's written authorisation.
--   * 8 Oct 2026 (QLD/VIC/ACT/TAS), point 1(a): in Victoria s8.4.4 of the
--     Gambling Regulation Act 2003 bans supplying bingo tickets or a
--     random number generator to anyone without a minor gaming permit,
--     so recording the venue's permit (and warranting it in the terms)
--     is what keeps us on the right side of that line. Point 4: "prudent
--     to verify VIC permit numbers before providing the platform".
-- Dean, 15 Oct 2026: build everything the lawyer called prudent.
--
-- WHAT CHANGES. Four columns on vp_venues, nothing else:
--   venue_kind               the venue's own description of itself (pub,
--                            hotel, club, rsl, charity, association,
--                            other). It is a SUGGESTION for HQ when
--                            setting entity_type, never the answer: HQ
--                            still sets entity_type and paid_entry_enabled
--                            by hand (migration 44 stands).
--   compliance_accepted_at   when the compliance tick was accepted
--   compliance_accepted_by   who accepted it, in their words (a name)
--   permits                  jsonb keyed by game kind, see below
--
-- RLS. These ride on vp_venues, whose policies already scope reads to the
-- venue's own staff and HQ, and whose writes go through the Workers with
-- the service key. No new policy, no new grant: RLS-BASELINE.json should
-- not move.
--
-- CHECK AFTERWARDS (read-only):
--   select column_name, data_type from information_schema.columns
--    where table_name = 'vp_venues'
--      and column_name in ('venue_kind','permits','compliance_accepted_at','compliance_accepted_by');
--   -> four rows
-- =====================================================================

begin;

-- What the venue IS, in its own words. The CNPG Act (QLD), the Community
-- Gaming Act (NSW) and the Gambling Regulation Act (VIC) all turn on
-- whether the conductor is a club, charity or association (non-profit) or
-- a business (for-profit). This column records what the venue told us so
-- HQ can confirm the category from it. Anisimoff, 1 Oct 2026, point 3.
alter table vp_venues
  add column if not exists venue_kind text;

comment on column vp_venues.venue_kind is
  'The venue''s own description of itself at onboarding: pub | hotel | club | rsl | charity | association | other. A suggestion for HQ when setting entity_type (club, rsl, charity and association suggest non_profit), never auto-applied. Anisimoff Legal 9380, 1 Oct 2026, point 3.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vp_venues_venue_kind_chk'
  ) then
    alter table vp_venues
      add constraint vp_venues_venue_kind_chk
      check (venue_kind is null or venue_kind in ('pub', 'hotel', 'club', 'rsl', 'charity', 'association', 'other'))
      not valid;
  end if;
end $$;

-- The active tick. "We are responsible for complying with the gaming laws
-- that apply to our venue, including any permit, licence or authority,
-- age limits and attendance rules. VenuePlay supplies the software only."
-- Recorded with who said it, because an acknowledgement nobody can
-- attribute is not much of a record. Anisimoff, 1 Oct 2026, points 3 and 5.
alter table vp_venues
  add column if not exists compliance_accepted_at timestamptz;
alter table vp_venues
  add column if not exists compliance_accepted_by text;

comment on column vp_venues.compliance_accepted_at is
  'When the venue (or HQ, on the onboarding call, in the venue''s words) accepted that the venue is responsible for gaming compliance and VenuePlay supplies software only. Anisimoff Legal 9380, 1 Oct 2026, point 3: an active tick box.';
comment on column vp_venues.compliance_accepted_by is
  'Who accepted the compliance tick, as a name typed at the time. Free text on purpose: it is a record, not a login.';

-- The permits, licences and authorities the venue says it holds, keyed by
-- game kind. Shape (shared with vp-gaming.js permitRecorded and the
-- settings page; change all three together):
--   { "bingo":   { "number": "", "holder": "venue"|"npo", "npo_name": "",
--                  "authorised_on": "YYYY-MM-DD", "expires": "YYYY-MM-DD"|null, "note": "" },
--     "raffle":  { ...same... },
--     "members": { ...same... } }
-- A kind with a non-empty number, OR holder "npo" with a non-empty
-- npo_name and an authorised_on date, counts as RECORDED. The NPO form is
-- the NSW letter's point 7: a pub runs the raffle under the charity's
-- authority with the charity's written authorisation, so what the pub can
-- record is the charity and the date it authorised them.
-- Recording it is the venue's choice; nothing here is verified by us
-- (Anisimoff, 1 Oct 2026, point 5: prudent, not mandatory; 8 Oct 2026,
-- point 4: a warranty and indemnity suffice where checking is impractical).
alter table vp_venues
  add column if not exists permits jsonb not null default '{}'::jsonb;

comment on column vp_venues.permits is
  'Permits, licences and authorities the venue has recorded, keyed by game kind (bingo, raffle, members). Each: {number, holder (venue|npo), npo_name, authorised_on, expires, note}. Written by the billing Worker (/account/permits) for an owner or a manager with the draws_raffles right. Anisimoff Legal 9380, 1 Oct 2026 point 5 and 8 Oct 2026 point 1(a).';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vp_venues_permits_is_object_chk'
  ) then
    alter table vp_venues
      add constraint vp_venues_permits_is_object_chk
      check (jsonb_typeof(permits) = 'object')
      not valid;
  end if;
end $$;

commit;
