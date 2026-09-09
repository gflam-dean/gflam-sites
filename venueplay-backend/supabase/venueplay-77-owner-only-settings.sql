-- venueplay-77-owner-only-settings.sql
-- NOT RUN. Read the whole note before running it: it changes who may change what.
--
-- WHAT THIS FIXES, proved rather than assumed. On 10 Sep 2026 Dean ran the read-only
-- check in venueplay-75 and it showed vp_venue_settings carries these two policies:
--
--   vp_venue_settings_manager_insert   insert   role in ('owner','manager')
--   vp_venue_settings_manager_update   update   role in ('owner','manager')
--
-- So a MANAGER may write EVERY column of that row. The account page hides the
-- owner-only cards from a manager (the name display, and what players are asked for,
-- which is the opt-in and privacy half), but the page does not save through the Worker:
-- VP.saveSettings upserts this table straight from the browser with the signed-in
-- person's own token. Hiding a card is a door. The policy is the bolt, and there wasn't
-- one. A manager could turn on collecting a player's email and mobile at a venue whose
-- owner had deliberately turned it off, and nothing would have stopped them.
--
-- WHY A TRIGGER AND NOT A POLICY. A row-level policy cannot see the OLD row on an
-- UPDATE (USING sees the old, WITH CHECK sees the new, and neither can compare them),
-- so "a manager may change these columns but not those" cannot be written as a policy.
-- Column-level GRANTs cannot express it either, because the same person may write the
-- rest of the row. A BEFORE UPDATE trigger can, and this table already carries one
-- (vp_venue_settings_gate, migrations 21 and 28), so this is the shape that is already
-- here rather than a new idea.
--
-- IT KEEPS, IT DOES NOT REFUSE. A manager saving the page still saves: the columns they
-- are allowed to change are written, and the owner-only ones silently keep the values
-- they already had. Raising an error instead would break their whole save and teach
-- them that the settings page is broken. The page already reads back what actually
-- landed and says so (that read-back was added when a database trigger was quietly
-- rewriting the marketing toggles), so a manager who tries will be told.
--
-- WHO IS AN OWNER, for this purpose: a vp_venue_staff row for this venue with role
-- 'owner', or a platform admin. Note the roles model: a real owner's row can be stored
-- with role 'manager' at a group, which is why the Worker uses perms rather than the
-- role word. Here the role word IS the question being asked, so it is used directly.
--
-- Safe to run twice.

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
      and s.role = 'owner'
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

drop trigger if exists vp_venue_settings_owner_only on public.vp_venue_settings;
create trigger vp_venue_settings_owner_only
  before update on public.vp_venue_settings
  for each row execute function public.vp_settings_owner_only_guard();

-- HOW TO PROVE IT WORKED, rather than assuming. As a manager (not an owner) at a
-- venue, open Your account, turn Email collection on, and save. The page will report
-- that it did not take. As the owner, the same tap works.
