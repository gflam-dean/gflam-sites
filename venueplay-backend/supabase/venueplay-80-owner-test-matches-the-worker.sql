-- venueplay-80-owner-test-matches-the-worker.sql
-- NOT RUN. Read this note first: it changes who may change a venue's privacy settings.
--
-- WHAT IS WRONG TODAY, measured against live data on 12 Sep 2026, not assumed.
--
-- Migration 77 stops anyone but an OWNER changing the owner-only columns on
-- vp_venue_settings: name_display and the six collect_* toggles, which are the opt-in
-- and privacy half of the product. It decides who an owner is by the role word:
--
--     and s.role = 'owner'
--
-- and its own note admits the trap in the next breath: "a real owner's row can be stored
-- with role 'manager' at a group, which is why the Worker uses perms rather than the role
-- word. Here the role word IS the question being asked, so it is used directly."
--
-- On live data that is the difference between three venues and sixteen:
--
--     active venues                                              17
--     with a row whose role is literally 'owner'                  3
--     with an unrestricted owner-side row (what the Worker uses) 16
--
-- So at THIRTEEN venues the real owner's row says 'manager', the trigger silently refuses
-- them, and the page has already said "Saved." The value goes back on reload. An owner
-- turning OFF the collection of a player's email or mobile is the one setting here where
-- "it said saved and it did not save" is a privacy problem rather than an annoyance.
--
-- The thirteen: connie-is-a-cuntry-club, gflam-group-pty-ltd, hoads-haus-of-fun,
-- karina-bay-surf-club, lizard-lounge-sports-bar, mclinglings-irish-bar,
-- praze-the-roof-sports-bar, the-average-joe, the-gothic-arms-hotel,
-- the-indypendent-hotel, the-jolly-jess, the-mini-bar, wellshot-hotel.
--
-- WHAT THIS CHANGES: one condition, nothing else. The function below is migration 77's,
-- copied verbatim, with the owner test replaced. A manager who HAS been given a
-- permissions object is restricted and stays restricted, which is the whole point of 77
-- and is not being undone.
--
-- WHO IS STILL LOCKED OUT, on purpose: tugun-bowls, which has no owner-side staff row at
-- all. That is a data question, not a policy one, and this does not invent an owner for a
-- venue that has none.
--
-- PROVE IT AFTERWARDS rather than trusting this file. On the-jolly-jess, which is a test
-- venue: sign in as its owner, Account page, turn OFF collecting a player's email, save,
-- reload. Before this it comes back ON. After it, it stays OFF.
--
-- SAFE TO RUN TWICE: it replaces a function body and leaves the trigger alone.

create or replace function public.vp_settings_owner_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
begin
  -- service_role (the Worker) and a platform admin are not restricted: the Worker is
  -- how HQ fixes a venue, and it does its own authorisation before it ever gets here.
  if auth.uid() is null or public.vp_is_platform_admin() then
    return new;
  end if;

  select exists (
    select 1 from public.vp_venue_staff s
    where s.venue_id = new.venue_id
      and s.auth_user_id = auth.uid()
      /* THE SAME QUESTION THE WORKER ASKS. See vpbOwnerOnly in venueplay-api-FULL.js:
         `o.perms` truthy means a RESTRICTED manager, and anything else is the owner. So
         an owner-side role AND nothing taken away.
         BOTH HALVES ARE NEEDED. A HOST also has no permissions object, so testing only
         "no permissions" would hand every host the ability to turn a venue's privacy
         settings back on. Two such rows exist live today. Both halves, or neither. */
      and s.role in ('owner', 'manager')
      and s.permissions is null
  ) into is_owner;

  if is_owner then
    return new;
  end if;

  -- Not an owner: the owner-only columns keep whatever they already were.
  -- These are exactly the toggles behind the .owneronly cards in settings.html plus
  -- the name display, which decides how a winner's name appears on the TV.
  new.name_display            := old.name_display;
  new.collect_first_name      := old.collect_first_name;
  new.collect_last_name       := old.collect_last_name;
  new.collect_postcode        := old.collect_postcode;
  new.collect_email           := old.collect_email;
  new.collect_mobile          := old.collect_mobile;
  new.collect_marketing_optin := old.collect_marketing_optin;
  return new;
end;
$$;


-- Check afterwards. Should be 16 of 17 rather than 3 of 17.
--
--   select v.slug,
--          exists (select 1 from vp_venue_staff s
--                   where s.venue_id = v.id
--                     and s.role in ('owner','manager')
--                     and s.permissions is null) as someone_can_change_settings
--     from vp_venues v
--    where v.status = 'active'
--    order by 2, 1;
