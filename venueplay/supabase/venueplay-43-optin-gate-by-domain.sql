-- =====================================================================
-- Migration 43: the marketing gate matched a substring of the whole email
-- ---------------------------------------------------------------------
-- Migration 28 auto-approves an account to collect player contact details
-- (email, mobile, postcode, marketing consent) when the contact email "looks
-- like a venue". It matched the pattern against the WHOLE address, so the
-- local part counted:
--
--     myclub.trivia@gmail.com     -> approved
--     golf.host@outlook.com       -> approved
--     dave.pubquiz@hotmail.com    -> approved
--
-- That is exactly the case the gate exists to stop: a travelling host or a
-- third party collecting a venue's customers under their own account. Anyone
-- could self-approve by choosing an address.
--
-- This anchors the check to the DOMAIN, and refuses the common free providers
-- outright. A venue on its own domain (sandsrsl.com.au, eatonshillhotel.com.au)
-- still auto-approves exactly as before. Anyone else stays locked until an
-- admin approves them through HQ, which is the intended path.
--
-- Safe to run more than once. Nothing already approved is revoked: this only
-- changes what auto-approves from here on.
-- =====================================================================

create or replace function vp_gate_marketing_collect()
returns trigger
language plpgsql
security definer
set search_path = public          -- pinned: migration 32 sets this correctly, 21 and 28 did not
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
     -- and the DOMAIN reads like a venue
     and edomain ~ '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality|inn|arms|brewery|brewhouse|sportsclub)'
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

-- Re-assert the trigger. Migration 42 only checks columns and tables, so it cannot tell whether
-- migration 21 or 28 ever ran, and without the trigger the gate does not exist at all: every
-- account could switch on player contact collection freely.
drop trigger if exists vp_venue_settings_gate on vp_venue_settings;
create trigger vp_venue_settings_gate
  before insert or update on vp_venue_settings
  for each row execute function vp_gate_marketing_collect();


-- Who is currently auto-approved, and would they still be under the new rule?
-- Run this after, to see if anyone needs approving by hand in HQ:
--
--   select f.id, f.contact_email, f.optin_release_approved
--     from venueplay_founding f
--    where f.optin_release_approved is not true
--      and lower(split_part(coalesce(f.contact_email,''),'@',2)) ~
--          '(hotel|tavern|rsl|club|pub|bowls|bowlo|bowling|leagues|surf|golf|hospitality|inn|arms)';
