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
-- but no migration ever repaired the rows written before the fix. Every one of
-- those bartenders is a full account owner today: they can open
-- /account/players and charge the owner's card, or cancel the venue.
--
-- WHY THIS IS NOT A BLIND UPDATE
--
-- A real manager and a mis-stored host look identical in the data: both are
-- role 'manager' with permissions null. Demoting all of them would strip the
-- actual publican of their own account. So step 1 only LOOKS. You read the
-- list, decide who should not be an owner, and step 2 changes only those.
--
-- Run each step on its own. Nothing here deletes anything.
-- =====================================================================


-- ==================== STEP 0: what columns exist ======================
-- Run this first. It tells you what vp_venue_staff actually has, so the
-- queries below can be trusted. (An earlier version of this file guessed at a
-- "label" column that does not exist.)

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'vp_venue_staff'
order by ordinal_position;


-- ============================ STEP 1: LOOK ============================
-- Everyone who is currently a full owner by virtue of having no permissions
-- set. `s.*` avoids naming any column, so this runs whatever the table holds.
-- Expect ONE row per venue (the publican). Extra rows are the ones to look at.

select v.name as venue, s.*
from vp_venue_staff s
left join vp_venues v on v.id = s.venue_id
where s.role = 'manager'
  and s.permissions is null
order by v.name;


-- ==================== STEP 2: FIX (edit, then run) ====================
-- Take the auth_user_id values from step 1 for the people who should NOT be
-- able to charge the card, put them in the list below, and run it.
--
-- Doing it by explicit id rather than by a rule is the point: you are looking
-- at the names, and nothing gets demoted that you did not choose.
--
-- The four keys are the real ones the code checks (migration 17), all left ON,
-- so nobody loses anything they were using. What removes the owner rights is
-- that the permissions object EXISTS at all: vpbOwnerOnly is
-- `o.perms ? deny : allow`.
--
-- To put someone back to full owner rights later, set permissions back to null.

-- update vp_venue_staff
--    set permissions = jsonb_build_object(
--          'advertising',   true,
--          'draws_raffles', true,
--          'players_optin', true,
--          'add_hosts',     true
--        )
--  where role = 'manager'
--    and permissions is null
--    and auth_user_id in (
--      -- paste the ids from step 1 here, one per line, comma separated:
--      -- '00000000-0000-0000-0000-000000000000',
--      -- '11111111-1111-1111-1111-111111111111'
--    );


-- ============================ STEP 3: CHECK ===========================
-- Re-run step 1. What is left should be one row per venue: the owner.
