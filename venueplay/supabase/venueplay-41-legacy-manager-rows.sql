-- =====================================================================
-- Migration 41: hosts that were stored as managers, and can charge the card
-- ---------------------------------------------------------------------
-- HOW THE HOLE WORKS
--
-- vpbIsOwner(o) is `!o.perms`, and vpbOwnerOnly only blocks when permissions
-- is set. Migration 17 says it plainly: "NULL means all allowed." That is the
-- intended reading for the FIRST manager of a venue, who is the publican and
-- is meant to have everything.
--
-- The problem is that "Add host" used to insert role 'manager' with no
-- permissions object at all. The code is fixed (it inserts role 'host' now),
-- but no migration ever repaired the rows that were written before the fix.
-- Every one of those bartenders is, today, a full account owner: they can open
-- /account/players and charge the owner's card, or cancel the venue.
--
-- WHY THIS IS NOT A BLIND UPDATE
--
-- A real manager and a mis-stored host look identical in the data: both are
-- role 'manager' with permissions null. Demoting all of them would strip the
-- actual publican of their own account. So step 1 only LOOKS. Read the list,
-- decide, then run step 2 for the rows you have decided about.
--
-- The heuristic in step 2 is: the EARLIEST staff row for a venue is that
-- venue's owner and is left alone; later manager rows with no permissions are
-- the ones the old Add host button created. Check that against the list from
-- step 1 before you run it, because a venue that genuinely added a second
-- manager will also appear.
-- =====================================================================

-- ============================ STEP 1: LOOK ============================
-- Run this on its own first. Nothing is changed.
select
  s.venue_id,
  v.name                      as venue,
  s.auth_user_id,
  s.display_name,
  s.label,
  s.created_at,
  (s.created_at = min(s.created_at) over (partition by s.venue_id))
                              as is_first_staff_row_probably_the_owner
from vp_venue_staff s
left join vp_venues v on v.id = s.venue_id
where s.role = 'manager'
  and s.permissions is null
order by v.name, s.created_at;

-- ==================== STEP 2: FIX (uncomment to run) ==================
-- Gives every LATER no-permissions manager an EXPLICIT permission set. The
-- four keys are the real ones the code checks (migration 17): advertising,
-- draws_raffles, players_optin, add_hosts. All four are left ON, so nobody
-- loses anything they were actually using.
--
-- What changes is that the object EXISTS. Owner-only actions are gated by
-- vpbOwnerOnly, which is `o.perms ? deny : allow`, so a non-null permissions
-- object is exactly what stops them charging the owner's card or cancelling
-- the venue. Nothing is deleted and nobody is locked out. To put someone back
-- to full owner rights, set their permissions back to null.
--
-- update vp_venue_staff s
--    set permissions = jsonb_build_object(
--          'advertising',   true,
--          'draws_raffles', true,
--          'players_optin', true,
--          'add_hosts',     true
--        )
--  where s.role = 'manager'
--    and s.permissions is null
--    and s.created_at > (
--          select min(s2.created_at) from vp_venue_staff s2 where s2.venue_id = s.venue_id
--        );

-- ============================ STEP 3: CHECK ===========================
-- After step 2, this should return only one row per venue: the owner.
-- select venue_id, count(*) from vp_venue_staff
--  where role = 'manager' and permissions is null group by venue_id order by 2 desc;
