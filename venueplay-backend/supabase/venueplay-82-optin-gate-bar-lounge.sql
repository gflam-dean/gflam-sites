-- =====================================================================
-- Migration 82: "bar" is a venue word, and the gate did not think so
-- ---------------------------------------------------------------------
-- Migration 43 auto-approves an account to collect player contact details when
-- its contact email is on a domain that reads like a venue. The word list was
--
--   hotel tavern rsl club pub bowls bowlo bowling leagues surf golf
--   hospitality inn arms brewery brewhouse sportsclub
--
-- which has no "bar" in it. So The Mini Bar, on theminibar.com.au, its own
-- domain and not a free mailbox, was refused. Found on 17 September 2026 when
-- Dean tried to switch marketing opt-in on for it and was told to email us.
-- Lizard Lounge Sports Bar and Praze The Roof Sports Bar would hit the same
-- wall the day they move off Gmail.
--
-- WHY THESE WORDS ARE MATCHED DIFFERENTLY TO THE OLD ONES
--
-- sites/CLAUDE.md, under "Never do these":
--
--   Never match a word inside a domain with `word in domain`. "pub" is inside
--   publicsydney, "bar" inside barossa, "inn" inside innisfail. 21 correct
--   addresses were flagged wrong that way.
--
-- In THIS function a false positive is not a nuisance, it is an account
-- auto-approving itself to collect a room full of people's contact details.
-- barossavalleywines.com.au is not a venue and must not let itself through.
--
-- So the new words are anchored: the word has to be followed by a non-letter
-- or be the end of the domain. That is true of the real cases and false of the
-- traps:
--
--   theminibar.com.au        bar + "."   -> approved
--   lizardloungesportsbar... bar + "."   -> approved
--   sports-bar.com.au        bar + "."   -> approved
--   barossavalleywines...    bar + "o"   -> NOT approved
--   barbershopquartet...     bar + "b"   -> NOT approved
--
-- KNOWN, AND DELIBERATELY NOT CHANGED HERE. The ORIGINAL words are still
-- unanchored, so "inn" still matches innisfailrealestate.com.au and "pub" still
-- matches publicsydney.com.au. Tightening them could revoke an account that is
-- auto-approved today and collecting data legitimately, which is not a change to
-- make in the same migration as a widening, and not one to make without looking
-- at who it would hit. It is written up rather than quietly fixed.
--
-- Safe to run more than once. Nothing already approved is revoked, and nothing
-- an admin has decided by hand is touched: optin_release_approved still wins.
-- =====================================================================

create or replace function vp_gate_marketing_collect()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  fid       uuid;
  approved  boolean;
  cemail    text;
  edomain   text;
begin
  select founding_id into fid from vp_venues where id = new.venue_id;
  if fid is null then
    return new;                   -- operator-group venue (Gflam-created): not gated here
  end if;

  select optin_release_approved, contact_email into approved, cemail
    from venueplay_founding where id = fid;

  -- Everything after the LAST @, lowercased. No @ means no domain to trust.
  edomain := lower(split_part(coalesce(cemail, ''), '@', 2));

  if approved is not true
     and edomain <> ''
     -- not a free mailbox: those say nothing about who owns the customers
     and edomain !~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|bigpond|optusnet|tpg|iinet|internode|westnet|dodo|exemail)\.'
     and edomain !~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx)\.com$'
     and (
       -- the DOMAIN reads like a venue (unchanged from migration 43)
       edomain ~ '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality|inn|arms|brewery|brewhouse|sportsclub)'
       -- ...or ends a label with one of the words that needs anchoring, so
       -- barossa and barbershop do not let themselves in
       or edomain ~ '(bar|lounge|bistro|cellars?|winery|taphouse|alehouse)([^a-z]|$)'
     )
  then
    approved := true;
  end if;

  if approved is not true then
    new.collect_email := false;
    new.collect_mobile := false;
    new.collect_postcode := false;
    new.collect_marketing_optin := false;
  end if;

  return new;
end;
$fn$;

-- Re-assert the trigger. Without it the gate does not exist at all and every
-- account could switch player contact collection on freely.
drop trigger if exists vp_venue_settings_gate on vp_venue_settings;
create trigger vp_venue_settings_gate
  before insert or update on vp_venue_settings
  for each row execute function vp_gate_marketing_collect();


-- =====================================================================
-- PROVE IT, rather than assuming. Run this after and read the three columns:
-- every row marked SHOULD PASS has to say t, and every TRAP has to say f.
-- A migration that silently matched nothing would otherwise look identical to
-- one that worked, because the only visible effect is a venue's checkbox.
-- =====================================================================
--
-- with cases(kind, edomain) as (values
--   ('SHOULD PASS','theminibar.com.au'),
--   ('SHOULD PASS','lizardloungesportsbar.com.au'),
--   ('SHOULD PASS','sports-bar.com.au'),
--   ('SHOULD PASS','thecellars.com.au'),
--   ('SHOULD PASS','wellshothotel.com.au'),
--   ('TRAP',       'barossavalleywines.com.au'),
--   ('TRAP',       'barbershopquartet.com.au'),
--   ('TRAP',       'loungefurniture.com.au'),
--   ('TRAP',       'gmail.com')
-- )
-- select kind, edomain,
--        (edomain !~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|bigpond|optusnet|tpg|iinet|internode|westnet|dodo|exemail)\.'
--         and edomain !~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx)\.com$'
--         and (edomain ~ '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality|inn|arms|brewery|brewhouse|sportsclub)'
--              or edomain ~ '(bar|lounge|bistro|cellars?|winery|taphouse|alehouse)([^a-z]|$)')) as auto_approves
--   from cases order by kind desc, edomain;
--
-- Note loungefurniture.com.au: "lounge" followed by "f", so it does not pass.
-- That is the anchoring doing its job.
